/**
 * Event ticketing: cart-line validation and ticket issuance.
 *
 * The cart is client-side, so NOTHING it says about price or availability is
 * trusted. `resolveTicketLines` re-reads every tier from the database and
 * returns authoritative figures; the caller prices the order from those, never
 * from the request. This mirrors how the shop already re-validates real
 * variants — a tampered cart must not be able to change what someone pays.
 */
import { randomInt, } from 'node:crypto';
import type { EventTicketCartLine, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import { transaction, } from '../../db';
import * as repo from '../../repositories/events.repo';
import { logger, } from '../../utils/logger';
import { assertCanBuyTier, assertCanRegister, } from './access';
import { assertBookableOccurrence, } from './bookable';
import type { LevelViewer, } from '../access/level';

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
    /**
     * `viewer` given (public purchase / checkout): enforce the event's register
     * rule and each ticket type's required tier. Omitted by the post-payment
     * fulfilment, which re-resolves lines the checkout already checked.
     */
    opts: { viewer?: LevelViewer; buyerEmail?: string | null; } = {},
): Promise<{ lines: ResolvedTicketLine[]; totalCents: number; }> {
    const enforce = 'viewer' in opts;
    const resolved: ResolvedTicketLine[] = [];
    // Quantity of each (tier, date) asked for in THIS request, for the per-buyer cap.
    const asked = new Map<string, number>();
    for (const l of lines) {
        const k = `${l.tierId}|${l.occurrenceDate}`;
        asked.set(k, (asked.get(k,) ?? 0) + (l.quantity || 0),);
    }

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
        if (enforce) {
            await assertCanRegister(event, opts.viewer,);
            await assertCanBuyTier(tier, opts.viewer,);
            // Not on the post-payment path: money has been taken by then, and a
            // refusal there would only lose the tickets (logged for a refund).
            await assertBookableOccurrence(event, line.occurrenceDate,);
            // Per-buyer cap: one address cannot claim a whole (free) allocation.
            if (tier.maxPerOrder) {
                const held = opts.buyerEmail
                    ? await repo.countHeldByEmail(tier.id, line.occurrenceDate, opts.buyerEmail,)
                    : 0;
                const want = asked.get(`${tier.id}|${line.occurrenceDate}`,) ?? line.quantity;
                if (held + want > tier.maxPerOrder) {
                    const left = Math.max(0, tier.maxPerOrder - held,);
                    throw new ValidationError(
                        left === 0
                            ? `You already have the most "${tier.name}" tickets allowed for this date (${tier.maxPerOrder}).`
                            : `"${tier.name}" is limited to ${tier.maxPerOrder} per person — you can add ${left} more.`,
                    );
                }
            }
        }

        // Inventory is per OCCURRENCE: week 3 of a series has its own capacity.
        const sold = await repo.countSoldByTier(event.id, line.occurrenceDate,);
        const used = sold[tier.id] ?? 0;
        const remaining = tier.quantityAvailable === null ?
            null :
            Math.max(0, tier.quantityAvailable - used,);

        if (remaining !== null && line.quantity > remaining) {
            throw new ValidationError(
                remaining === 0 ?
                    `"${tier.name}" for ${event.title} is sold out.` :
                    `Only ${remaining} "${tier.name}" ticket(s) left for ${event.title}.`,
            );
        }

        resolved.push({
            eventId: event.id,
            eventTitle: event.title,
            occurrenceDate: line.occurrenceDate,
            tierId: tier.id,
            tierName: tier.name,
            priceCents: tier.priceCents, // authoritative
            currency: tier.currency,
            quantity: line.quantity,
            remaining,
        },);
    }

    const totalCents = resolved.reduce((sum, l,) => sum + l.priceCents * l.quantity, 0,);
    return { lines: resolved, totalCents, };
}

/** Short, human-quotable code for a ticket. Ambiguous characters (0/O, 1/I)
 *  are excluded so a code read down a phone line survives. The code IS the
 *  credential for `/tickets/:code`, so it comes from the CSPRNG — 32^10 ≈ 2^50. */
export function ticketCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 10; i += 1) {
        out += alphabet[randomInt(alphabet.length,)];
    }
    return `${out.slice(0, 5,)}-${out.slice(5,)}`;
}

/** How many fresh codes to try before giving up on a (vanishingly rare) clash. */
const CODE_ATTEMPTS = 3;

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
    opts: { orderId?: string; } = {},
): Promise<Array<{ code: string; tierName: string; priceCents: number; currency: string; }>> {
    // ONE transaction: the tier row lock below is only held until the
    // transaction ends. Run as separate pool queries it was released the
    // moment the SELECT returned, so two buyers could both read "one seat
    // left" and both be issued it.
    const issued = await transaction(async (client,) => {
        const out: Array<{ code: string; tierName: string; priceCents: number; currency: string; }> = [];

        for (const line of lines) {
            // Lock the tier row so a concurrent purchase can't read the same
            // remaining count and oversell.
            const tierRes = await client.query<{ quantity_available: number | null; }>(
                `SELECT quantity_available FROM event_ticket_tiers WHERE id = $1 FOR UPDATE`,
                [line.tierId,],
            );
            const cap = tierRes.rows[0]?.quantity_available ?? null;

            if (cap !== null) {
                const soldRes = await client.query<{ count: number; }>(
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
                // ON CONFLICT DO NOTHING instead of catching 23505: a failed
                // INSERT would abort the whole transaction (every ticket in it).
                let code: string | undefined;
                for (let attempt = 0; attempt < CODE_ATTEMPTS && !code; attempt += 1) {
                    const res = await client.query<{ code: string; }>(
                        `INSERT INTO event_tickets
                        (registration_id, tier_id, event_id, occurrence_date, code,
                         price_cents_paid, currency, order_id)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                     ON CONFLICT (code) DO NOTHING
                     RETURNING code`,
                        [
                            registrationId,
                            line.tierId,
                            line.eventId,
                            line.occurrenceDate,
                            ticketCode(),
                            line.priceCents,
                            line.currency,
                            opts.orderId ?? null,
                        ],
                    );
                    code = res.rows[0]?.code;
                }
                if (!code) throw new Error('Could not allocate a unique ticket code',);
                out.push({
                    code,
                    tierName: line.tierName,
                    priceCents: line.priceCents,
                    currency: line.currency,
                },);
            }
        }
        return out;
    },);

    logger.info('event tickets issued', { registrationId, count: issued.length, },);
    return issued;
}
