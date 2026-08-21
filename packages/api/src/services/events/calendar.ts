/**
 * Calendar reads — the occurrence-expanded view of stored events, plus
 * per-date overrides (cancelling one night of a weekly series).
 */
import type { EventOccurrence, } from '@sitesurge/types';
import { NotFoundError, } from '../../core/errors';
import * as repo from '../../repositories/events.repo';
import { logAudit, } from '../audit';
import type { AuditContext, } from '../types';
import { expandEvents, } from './occurrences';

/**
 * The calendar view: every occurrence falling inside the window, with recurring
 * series expanded and per-date overrides applied.
 *
 * `admin` controls two things at once — visibility of drafts, and whether
 * cancelled dates are retained (so the admin can see a cancellation) or
 * filtered (so the public never does).
 */
export async function listOccurrences(opts: {
    from: string;
    to: string;
    admin?: boolean;
    search?: string;
},): Promise<EventOccurrence[]> {
    const from = new Date(opts.from,);
    const to = new Date(opts.to,);

    // Pull candidate events with a generous lower bound: a series that STARTED
    // long before the window can still produce occurrences inside it, so the
    // usual `starts_at >= from` filter would wrongly exclude it.
    const { data, } = await repo.findEvents({
        status: opts.admin ? undefined : 'published',
        to: opts.to,
        search: opts.search,
    }, { page: 1, limit: 500, },);

    const overrides = await repo.findOverridesForEvents(data.map((e,) => e.id),);
    return expandEvents(data, overrides, { from, to, }, { includeCancelled: opts.admin, },);
}

/** Cancel (or un-cancel) a single date of a recurring series. */
export async function setOccurrenceStatus(
    eventId: string,
    occurrenceDate: string,
    status: 'cancelled' | null,
    ctx: AuditContext,
): Promise<void> {
    const event = await repo.findById(eventId,);
    if (!event) throw new NotFoundError('Event',);

    if (status === null) await repo.deleteOverride(eventId, occurrenceDate,);
    else await repo.upsertOverride({ eventId, occurrenceDate, status, },);

    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'event',
        entityId: eventId,
        newValues: { occurrenceDate, status, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}
