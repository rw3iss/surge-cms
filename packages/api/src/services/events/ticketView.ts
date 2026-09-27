/**
 * One ticket, as its holder sees it (`GET /events/tickets/:code`).
 *
 * The code IS the credential — 10 characters from a 32-symbol alphabet, the
 * same thing printed in the confirmation email — so holding it is enough to
 * see the registration it belongs to. What it does NOT reveal to a stranger
 * is the attendee's contact detail: the email is masked and the phone
 * withheld unless the viewer is that attendee (by account or email) or staff.
 * A later "proof of registration" (QR, check-in) builds on this same view.
 */
import type { EventTicketView, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { NotFoundError, } from '../../core/errors';
import { query, } from '../../db';
import * as repo from '../../repositories/events.repo';
import { logger, } from '../../utils/logger';

/** `jane.doe@example.com` → `j•••@example.com`. */
export function maskEmail(email: string,): string {
    const [local, domain,] = email.split('@',);
    if (!domain) return '•••';
    return `${local.slice(0, 1,)}•••@${domain}`;
}

interface TicketRow {
    code: string;
    status: EventTicketView['status'];
    price_cents_paid: number;
    currency: string;
    order_id: string | null;
    tier_name: string | null;
}

export async function getTicketView(
    code: string,
    viewer?: { id: string; email?: string; role?: string; } | null,
): Promise<EventTicketView> {
    const normalized = code.trim().toUpperCase();
    const head = await query<{
        registration_id: string;
        event_id: string;
        occurrence_date: string;
        email: string;
        name: string | null;
        phone: string | null;
        user_id: string | null;
        created_at: string;
    }>(
        `SELECT t.registration_id, t.event_id, t.occurrence_date::text AS occurrence_date,
                r.email, r.name, r.phone, r.user_id, r.created_at
           FROM event_tickets t
           JOIN event_registrations r ON r.id = t.registration_id
          WHERE t.code = $1`,
        [normalized,],
    );
    const reg = head.rows[0];
    if (!reg) throw new NotFoundError('Ticket not found',);

    const event = await repo.findById(reg.event_id,);
    if (!event) throw new NotFoundError('Ticket not found',);

    const rows = await query<TicketRow & { code: string; }>(
        `SELECT t.code, t.status, t.price_cents_paid, t.currency, t.order_id, tr.name AS tier_name
           FROM event_tickets t
           LEFT JOIN event_ticket_tiers tr ON tr.id = t.tier_id
          WHERE t.registration_id = $1
          ORDER BY t.created_at, t.code`,
        [reg.registration_id,],
    );

    // Order numbers, when any ticket came through the shop. Guarded: the shop
    // tables only exist while that feature is installed.
    const orderIds = [...new Set(rows.rows.map((r,) => r.order_id).filter(Boolean,),),] as string[];
    const orderNumbers = new Map<string, string>();
    if (orderIds.length) {
        try {
            const o = await query<{ id: string; order_number: string; }>(
                `SELECT id, order_number FROM shop_orders WHERE id = ANY($1::uuid[])`,
                [orderIds,],
            );
            for (const r of o.rows) orderNumbers.set(r.id, r.order_number,);
        } catch (err) {
            logger.warn('ticket view: order lookup failed', { error: (err as Error).message, },);
        }
    }

    const tickets = rows.rows.map((r,) => ({
        code: r.code,
        tierName: r.tier_name ?? 'Ticket',
        priceCents: Number(r.price_cents_paid,),
        currency: r.currency,
        status: r.status,
        ...(r.order_id && orderNumbers.get(r.order_id,) ? { orderNumber: orderNumbers.get(r.order_id,), } : {}),
    }));
    const self = tickets.find((t,) => t.code === normalized)!;

    const isOwner = !!viewer && (
        isStaffRole(viewer.role as never,) ||
        (!!reg.user_id && viewer.id === reg.user_id) ||
        (!!viewer.email && viewer.email.toLowerCase() === reg.email.toLowerCase())
    );

    return {
        code: self.code,
        status: self.status,
        tierName: self.tierName,
        priceCents: self.priceCents,
        currency: self.currency,
        occurrenceDate: reg.occurrence_date,
        event: {
            id: event.id,
            title: event.title,
            slug: event.slug,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            allDay: event.allDay,
            location: event.location,
            timezone: event.timezone,
            featuredImage: event.featuredImage ?? null,
        },
        attendee: {
            name: reg.name,
            email: isOwner ? reg.email : maskEmail(reg.email,),
            phone: isOwner ? reg.phone : null,
        },
        registeredAt: new Date(reg.created_at,).toISOString(),
        tickets,
        totalCents: tickets.filter((t,) => t.status !== 'refunded' && t.status !== 'cancelled')
            .reduce((sum, t,) => sum + t.priceCents, 0,),
        isOwner,
    };
}
