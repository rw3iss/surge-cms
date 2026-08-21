/**
 * Ticket tier definitions and their live availability.
 *
 * Separate from `tickets.ts`, which issues the tickets themselves: this module
 * answers "what can be bought and how many are left", the other answers "give
 * this buyer their codes".
 */
import type { EventTicketTier, } from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../../core/errors';
import * as repo from '../../repositories/events.repo';
import { logAudit, } from '../audit';
import type { AuditContext, } from '../types';

/**
 * Tiers with live sold/remaining counts for one occurrence. Remaining is null
 * for an unlimited tier, and never negative.
 */
export async function listTiers(
    eventId: string,
    occurrenceDate: string,
): Promise<EventTicketTier[]> {
    const [tiers, sold,] = await Promise.all([
        repo.findTiers(eventId,),
        repo.countSoldByTier(eventId, occurrenceDate,),
    ],);
    return tiers.map((t,) => {
        const used = sold[t.id] ?? 0;
        return {
            ...t,
            sold: used,
            remaining: t.quantityAvailable === null
                ? null
                : Math.max(0, t.quantityAvailable - used,),
        };
    },);
}

export async function replaceTiers(
    eventId: string,
    tiers: Array<{
        id?: string; name: string; priceCents: number; currency: string;
        quantityAvailable: number | null; position: number;
    }>,
    ctx: AuditContext,
): Promise<EventTicketTier[]> {
    const event = await repo.findById(eventId,);
    if (!event) throw new NotFoundError('Event',);
    for (const t of tiers) {
        if (!t.name?.trim()) throw new ValidationError('Every ticket tier needs a name',);
        if (t.priceCents < 0) throw new ValidationError('Ticket price cannot be negative',);
    }
    const saved = await repo.replaceTiers(eventId, tiers,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'event',
        entityId: eventId,
        newValues: { tiers: saved.length, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return saved;
}
