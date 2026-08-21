/**
 * Event records: reads, writes and the validation around them.
 *
 * Publishing side-effects (announcing a new event) are fired here but IMPLEMENTED
 * in `notifications.ts` — this module decides *when* the world should hear about
 * an event, not *how* it is told.
 */
import type { CalendarEvent, CalendarEventInput, EventStatus, } from '@sitesurge/types';
import { generateSlug, } from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../../core/errors';
import * as repo from '../../repositories/events.repo';
import { logAudit, } from '../audit';
import type { AuditContext, ListResult, } from '../types';
import { notifyForEvent, } from './notifications';

export interface ListOpts extends repo.EventFilters {
    page?: number;
    limit?: number;
    /** Staff see drafts; anonymous callers are pinned to `published`. */
    admin?: boolean;
}

// ─── Reads ────────────────────────────────────────────────────────

export async function list(opts: ListOpts = {},): Promise<ListResult<CalendarEvent>> {
    const { page = 1, limit = 100, admin, ...filters } = opts;
    // A non-admin must never see drafts, whatever `status` they asked for.
    const status = admin ? filters.status : 'published';
    const { data, total, } = await repo.findEvents({ ...filters, status, }, { page, limit, },);
    return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit,), },
    };
}

export async function getByIdOrSlug(
    idOrSlug: string,
    opts: { admin?: boolean; } = {},
): Promise<CalendarEvent> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug,);
    const found = isUuid ? await repo.findById(idOrSlug,) : await repo.findBySlug(idOrSlug,);
    if (!found) throw new NotFoundError('Event',);
    if (!opts.admin && found.status !== 'published') throw new NotFoundError('Event',);
    return found;
}

// ─── Validation ───────────────────────────────────────────────────

function assertValid(input: Partial<CalendarEventInput>,): void {
    if (input.title !== undefined && !input.title.trim()) {
        throw new ValidationError('Title is required',);
    }
    if (input.startsAt !== undefined && Number.isNaN(Date.parse(input.startsAt,),)) {
        throw new ValidationError('startsAt must be a valid date',);
    }
    if (input.endsAt) {
        if (Number.isNaN(Date.parse(input.endsAt,),)) {
            throw new ValidationError('endsAt must be a valid date',);
        }
        if (input.startsAt && Date.parse(input.endsAt,) < Date.parse(input.startsAt,)) {
            throw new ValidationError('endsAt cannot be before startsAt',);
        }
    }
}

/**
 * A registration form ALWAYS collects an email, whatever the caller asked for.
 *
 * The admin UI enforces this by disabling the `email` checkbox, but a direct
 * `PUT` could omit it — and then the public form would not collect an address
 * while `register()` still requires one, leaving a form that cannot be
 * submitted. The invariant belongs on the server, not in the checkbox.
 *
 * Order is preserved and duplicates are dropped, so an admin's chosen field
 * order survives; `email` is appended only when genuinely absent.
 */
export function normalizeRegistrationFields(fields: string[],): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of fields) {
        const f = (raw || '').trim();
        if (!f || seen.has(f.toLowerCase(),)) continue;
        seen.add(f.toLowerCase(),);
        out.push(f,);
    }
    if (!seen.has('email',)) out.push('email',);
    return out;
}

/** A unique slug derived from the title, suffixed only if it collides. */
async function uniqueSlug(base: string, exceptId?: string,): Promise<string> {
    const root = generateSlug(base,) || 'event';
    let candidate = root;
    let n = 1;
    while (await repo.slugExists(candidate, exceptId,)) {
        n += 1;
        candidate = `${root}-${n}`;
    }
    return candidate;
}

// ─── Writes ───────────────────────────────────────────────────────

export async function create(
    input: CalendarEventInput,
    ctx: AuditContext,
): Promise<CalendarEvent> {
    assertValid(input,);
    if (!input.title?.trim()) throw new ValidationError('Title is required',);
    if (!input.startsAt) throw new ValidationError('startsAt is required',);

    const slug = await uniqueSlug(input.slug || input.title,);
    const event = await repo.createEvent({
        ...input,
        slug,
        // Left undefined so the repository's own default applies.
        ...(input.registrationFields
            ? { registrationFields: normalizeRegistrationFields(input.registrationFields,), }
            : {}),
    }, ctx.userId,);

    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'event',
        entityId: event.id,
        newValues: { title: event.title, startsAt: event.startsAt, status: event.status, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    // Announce only once the event is actually visible to the public.
    if (event.status === 'published') void notifyForEvent(event, 'published',);
    return event;
}

export async function update(
    id: string,
    patch: Partial<CalendarEventInput>,
    ctx: AuditContext,
): Promise<CalendarEvent> {
    const existing = await repo.findById(id,);
    if (!existing) throw new NotFoundError('Event',);
    assertValid(patch,);

    const dbPatch: Record<string, unknown> = {};
    const map: Record<string, string> = {
        title: 'title', description: 'description', startsAt: 'startsAt',
        endsAt: 'endsAt', allDay: 'allDay', location: 'location', url: 'url',
        featuredImage: 'featuredImage', status: 'status', timezone: 'timezone',
        recurrenceRule: 'recurrenceRule', recurrenceUntil: 'recurrenceUntil',
        registrationEnabled: 'registrationEnabled',
        registrationFields: 'registrationFields',
        showRegistrantCount: 'showRegistrantCount',
        ticketingEnabled: 'ticketingEnabled', metadata: 'metadata',
    };
    for (const [key, col,] of Object.entries(map,)) {
        let v = (patch as Record<string, unknown>)[key];
        if (v === undefined) continue;
        if (col === 'registrationFields') {
            v = normalizeRegistrationFields(v as string[],);
        }
        // jsonb columns must be sent as JSON text, not a JS object/array.
        dbPatch[col] = (col === 'registrationFields' || col === 'metadata')
            ? JSON.stringify(v,)
            : v;
    }
    if (patch.slug && patch.slug !== existing.slug) {
        dbPatch.slug = await uniqueSlug(patch.slug, id,);
    }

    const updated = await repo.updateEvent(id, dbPatch,);
    if (!updated) throw new NotFoundError('Event',);

    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'event',
        entityId: id,
        newValues: dbPatch,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    // Draft → published is the moment the event becomes announceable.
    if (existing.status !== 'published' && updated.status === 'published') {
        void notifyForEvent(updated, 'published',);
    }
    return updated;
}

export async function remove(id: string, ctx: AuditContext,): Promise<void> {
    const existing = await repo.findById(id,);
    if (!existing) throw new NotFoundError('Event',);
    await repo.deleteEvent(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'event',
        entityId: id,
        oldValues: { title: existing.title, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

export type { CalendarEvent, EventStatus, };
