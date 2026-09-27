/**
 * Event tickets bought through the shop cart, issued once payment succeeds.
 *
 * A paid ticket is a virtual cart line (no catalogue product): checkout
 * prices it from the event's tier and records `{ kind: 'event_ticket',
 * eventId, occurrenceDate, tierId, attendee }` on the order item. Here —
 * after the webhook has marked the order paid — each (event, date) group
 * becomes ONE registration with its tickets, exactly what the free path in
 * `events/purchase.ts` does immediately.
 *
 * Nothing is reserved at checkout, so the last seat can go to someone else
 * between "add to cart" and "paid"; `issueTickets` re-checks under a row lock
 * and throws in that case. The charge has already been captured, so that is
 * logged as an error for the operator to refund rather than failing the
 * webhook.
 */
import type { FulfillmentItem, } from '../../repositories/shop/shopOrders.repo';
import { logger, } from '../../utils/logger';
import { sendTicketConfirmation, } from '../events/purchase';
import { register, } from '../events/registration';
import { issueTickets, resolveTicketLines, } from '../events/tickets';

interface TicketMeta {
    eventId: string;
    occurrenceDate: string;
    tierId: string;
    attendee?: { email?: string; name?: string; phone?: string; fields?: Record<string, unknown>; };
}

export async function issueOrderTickets(
    orderId: string,
    items: FulfillmentItem[],
    buyer: { userId: string | null; email: string; name: string | null; },
): Promise<void> {
    // One registration per (event, date): an attendee list is per occurrence.
    const groups = new Map<string, Array<{ item: FulfillmentItem; meta: TicketMeta; }>>();
    for (const item of items) {
        const meta = item.metadata as unknown as TicketMeta;
        if (!meta?.eventId || !meta.occurrenceDate || !meta.tierId) continue;
        const key = `${meta.eventId}|${meta.occurrenceDate}`;
        const list = groups.get(key,) ?? [];
        list.push({ item, meta, },);
        groups.set(key, list,);
    }

    for (const group of groups.values()) {
        const { meta, } = group[0];
        const attendee = group.find((g,) => g.meta.attendee?.email)?.meta.attendee ?? {};
        const email = attendee.email || buyer.email;
        try {
            const { lines, } = await resolveTicketLines(group.map(({ item, meta: m, },) => ({
                kind: 'event_ticket' as const,
                eventId: m.eventId,
                occurrenceDate: m.occurrenceDate,
                tierId: m.tierId,
                quantity: item.quantity,
                name: '',
                priceCents: 0,
                currency: '',
            })),);
            // Record what the buyer actually PAID, not today's tier price.
            lines.forEach((l, i,) => {
                l.priceCents = group[i].item.unitPriceCents;
            },);

            const registration = await register({
                eventId: meta.eventId,
                occurrenceDate: meta.occurrenceDate,
                email,
                name: attendee.name || buyer.name || undefined,
                phone: attendee.phone,
                fields: attendee.fields,
                userId: buyer.userId ?? undefined,
                sendConfirmation: false,
            },);
            const tickets = await issueTickets(registration.id, lines, { orderId, },);
            await sendTicketConfirmation(meta.eventId, email, tickets,);
            logger.info('Event tickets issued for paid shop order', {
                orderId,
                eventId: meta.eventId,
                count: tickets.length,
            },);
        } catch (err) {
            logger.error('Paid event tickets could NOT be issued (payment captured — refund or issue manually)', {
                orderId,
                eventId: meta.eventId,
                occurrenceDate: meta.occurrenceDate,
                error: (err as Error).message,
            },);
        }
    }
}
