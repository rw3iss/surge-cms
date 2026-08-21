/**
 * Event ticketing: cart-line validation and ticket issuance.
 *
 * The cart is client-side, so NOTHING it says about price or availability is
 * trusted. `resolveTicketLines` re-reads every tier from the database and
 * returns authoritative figures; the caller prices the order from those, never
 * from the request. This mirrors how the shop already re-validates real
 * variants — a tampered cart must not be able to change what someone pays.
 */
import type { EventTicketCartLine, } from '@sitesurge/types';
import { query, } from '../../db';
import { ValidationError, } from '../../core/errors';
import { logger, } from '../../utils/logger';
import * as repo from '../../repositories/events.repo';

export interface ResolvedTicketLine {
    eventId: string;
    eventTitle: string;
    occurrenceDate: string;
    tierId: string;
    tierName: string;
    /** Authoritative, from the DB — not whatever the cart claimed. */
    priceCents: number;
    currency: string;
    quantity: number;
    /** null = unlimited. */
    remaining: number | null;
}

/**
 * Validate and price the event-ticket lines of a cart.
 *
 * Throws on anything that would produce a wrong charge or an oversold event.
 * Returns the lines priced from the database, plus the order total.
 */
export async function resolveTicketLines(
    lines: EventTicketCartLine[],
): Promise<{ lines: ResolvedTicketLine[]; totalCents: number; }> {
    const resolved: ResolvedTicketLine[] = [];

    for (const line of lines) {
        if (!line.quantity || line.quantity < 1) {
            throw new ValidationError('Ticket quantity must be at least 1.',);
        }

        const event = await repo.findById(line.eventId,);
        if (!event) throw new ValidationError('That event no longer exists.',);
        if (event.status !== 'published') {
            throw new ValidationError(`"${event.title}" is not open for ticket sales.`,);
        }
        if (!event.ticketingEnabled) {
            throw new ValidationError(`"${event.title}" is not selling tickets.`,);
        }

        const tier = await repo.findTierById(line.tierId,);
        if (!tier || tier.eventId !== event.id) {
            throw new ValidationError('That ticket type is no longer available.',);
        }

        // Inventory is per OCCURRENCE: week 3 of a series has its own capacity.
        const sold = await repo.countSoldByTier(event.id, line.occurrenceDate,);
        const used = sold[tier.id] ?? 0;
        const remaining = tier.quantityAvailable === null
            ? null
            : Math.max(0, tier.quantityAvailable - used,);

        if (remaining !== null && line.quantity > remaining) {
            throw new ValidationError(
                remaining === 0
                    ? `"${tier.name}" for ${event.title} is sold out.`
                    : `Only ${remaining} "${tier.name}" ticket(s) left for ${event.title}.`,
            );
        }

        resolved.push({
            eventId: event.id,
            eventTitle: event.title,
            occurrenceDate: line.occurrenceDate,
            tierId: tier.id,
            tierName: tier.name,
            priceCents: tier.priceCents,   // authoritative
            currency: tier.currency,
            quantity: line.quantity,
            remaining,
        },);
    }

    const totalCents = resolved.reduce((sum, l,) => sum + l.priceCents * l.quantity, 0,);
    return { lines: resolved, totalCents, };
}

/** Short, human-quotable code for a ticket. Ambiguous characters (0/O, 1/I)
 *  are excluded so a code read down a phone line survives. */
function ticketCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 10; i += 1) {
        out += alphabet[Math.floor(Math.random() * alphabet.length,)];
    }
    return `${out.slice(0, 5,)}-${out.slice(5,)}`;
}

/**
 * Issue tickets for resolved lines against a registration.
 *
 * Called AFTER payment succeeds (or immediately for a free ticket). Inventory
 * is re-checked inside the same transaction under a row lock, because the gap
 * between "resolve" and "pay" is exactly where two buyers can claim the last
 * seat.
 */
export async function issueTickets(
    registrationId: string,
    lines: ResolvedTicketLine[],
): Promise<Array<{ code: string; tierName: string; priceCents: number; currency: string; }>> {
    const issued: Array<{ code: string; tierName: string; priceCents: number; currency: string; }> = [];

    for (const line of lines) {
        // Lock the tier row so a concurrent purchase can't read the same
        // remaining count and oversell.
        const tierRes = await query<{ quantity_available: number | null; }>(
            `SELECT quantity_available FROM event_ticket_tiers WHERE id = $1 FOR UPDATE`,
            [line.tierId,],
        );
        const cap = tierRes.rows[0]?.quantity_available ?? null;

        if (cap !== null) {
            const soldRes = await query<{ count: number; }>(
                `SELECT COUNT(*)::int AS count FROM event_tickets
                  WHERE tier_id = $1 AND occurrence_date = $2
                    AND status IN ('valid', 'checked_in')`,
                [line.tierId, line.occurrenceDate,],
            );
            const already = Number(soldRes.rows[0]?.count ?? 0,);
            if (already + line.quantity > cap) {
                throw new ValidationError(
                    `"${line.tierName}" sold out while you were checking out.`,
                );
            }
        }

        for (let i = 0; i < line.quantity; i += 1) {
            // price_cents_paid is captured now: a later tier price change must
            // not rewrite history on an issued ticket.
            const res = await query<{ code: string; }>(
                `INSERT INTO event_tickets
                    (registration_id, tier_id, event_id, occurrence_date, code,
                     price_cents_paid, currency)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 RETURNING code`,
                [
                    registrationId, line.tierId, line.eventId, line.occurrenceDate,
                    ticketCode(), line.priceCents, line.currency,
                ],
            );
            issued.push({
                code: res.rows[0].code,
                tierName: line.tierName,
                priceCents: line.priceCents,
                currency: line.currency,
            },);
        }
    }

    logger.info('event tickets issued', { registrationId, count: issued.length, },);
    return issued;
}
