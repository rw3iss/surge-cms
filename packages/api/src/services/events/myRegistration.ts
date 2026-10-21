/**
 * A signed-in member's OWN registration: read it (so the event page can show
 * "You're registered" instead of the form) and cancel it themselves.
 *
 * Matched by account id OR account email, because a registration made while
 * signed out (or before the account existed) is keyed on the email only. The
 * email match needs a VERIFIED account email: an unverified account (allowed to
 * sign in in subscription-required mode) has not proved it owns the address,
 * and must not read or cancel a stranger's sign-up made under it.
 *
 * Self-cancel is for FREE registrations only: anything paid goes through a
 * refund, which is the organiser's decision. A checked-in ticket or a past
 * occurrence cannot be cancelled either.
 */
import type { CalendarEvent, EventMyRegistration, } from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../../core/errors';
import { query, transaction, } from '../../db';
import { logger, } from '../../utils/logger';
import { nextOccurrenceDate, occurrenceProblem, } from './bookable';
import { getByIdOrSlug, } from './crud';
import { sendPurposeMail, } from '../mail/purposes';
import { describeWhen, escapeHtml, eventLink, } from './format';
import { eventSender, } from './settings';

export interface RegistrationViewer {
    id: string;
    email?: string | null;
}

interface RegRow {
    id: string;
    event_id: string;
    occurrence_date: string;
    name: string | null;
    email: string;
    phone: string | null;
    created_at: Date | string;
}

interface TicketRow {
    code: string;
    status: EventMyRegistration['tickets'][number]['status'];
    price_cents_paid: number;
    currency: string;
    tier_name: string | null;
}

/** Live (registered) row for this viewer + occurrence, or null. */
async function findOwn(eventId: string, occurrenceDate: string, viewer: RegistrationViewer,): Promise<RegRow | null> {
    const res = await query<RegRow>(
        `SELECT id, event_id, occurrence_date::text AS occurrence_date, name, email, phone, created_at
           FROM event_registrations
          WHERE event_id = $1 AND occurrence_date = $2 AND status = 'registered'
            AND (user_id = $3 OR ($4::text IS NOT NULL AND lower(email) = lower($4)
                 AND EXISTS (SELECT 1 FROM users u WHERE u.id = $3 AND u.email_verified)))
          ORDER BY (user_id = $3) DESC NULLS LAST, created_at
          LIMIT 1`,
        [eventId, occurrenceDate, viewer.id, viewer.email?.trim() || null,],
    );
    return res.rows[0] ?? null;
}

async function ticketsOf(registrationId: string,): Promise<TicketRow[]> {
    const res = await query<TicketRow>(
        `SELECT t.code, t.status, t.price_cents_paid, t.currency, tr.name AS tier_name
           FROM event_tickets t LEFT JOIN event_ticket_tiers tr ON tr.id = t.tier_id
          WHERE t.registration_id = $1 AND t.status IN ('valid', 'checked_in')
          ORDER BY t.created_at, t.code`,
        [registrationId,],
    );
    return res.rows;
}

/**
 * Pure: may the holder cancel this themselves? `over` = the occurrence has
 * ended (the same "until it is over" rule booking uses — `occurrenceProblem`
 * → 'past' — so a 9 PM event can still be cancelled that afternoon whatever
 * the UTC date says).
 */
export function canSelfUnregister(tickets: Pick<TicketRow, 'status' | 'price_cents_paid'>[], over: boolean,): boolean {
    if (tickets.some((t,) => Number(t.price_cents_paid,) > 0 || t.status === 'checked_in')) return false;
    return !over;
}

async function occurrenceOver(event: CalendarEvent, date: string,): Promise<boolean> {
    return (await occurrenceProblem(event, date,)) === 'past';
}

async function resolveDate(eventIdOrSlug: string, occurrenceDate?: string,) {
    const event = await getByIdOrSlug(eventIdOrSlug,);
    return { event, date: occurrenceDate || await nextOccurrenceDate(event,), };
}

export async function getMyRegistration(
    eventIdOrSlug: string,
    viewer: RegistrationViewer,
    occurrenceDate?: string,
): Promise<EventMyRegistration | null> {
    const { event, date, } = await resolveDate(eventIdOrSlug, occurrenceDate,);
    const reg = await findOwn(event.id, date, viewer,);
    if (!reg) return null;
    const tickets = await ticketsOf(reg.id,);
    return {
        id: reg.id,
        occurrenceDate: reg.occurrence_date,
        name: reg.name,
        email: reg.email,
        phone: reg.phone,
        createdAt: new Date(reg.created_at,).toISOString(),
        tickets: tickets.map((t,) => ({
            code: t.code,
            tierName: t.tier_name ?? 'Ticket',
            status: t.status,
            priceCents: Number(t.price_cents_paid,),
            currency: t.currency,
        })),
        canUnregister: canSelfUnregister(tickets, await occurrenceOver(event, reg.occurrence_date,),),
    };
}

/**
 * Cancel the viewer's own free registration: the row goes `cancelled` and its
 * free tickets `cancelled`, which returns their places to the tier. Locked so
 * a concurrent ticket claim cannot slip a paid ticket in between the check
 * and the cancel.
 */
export async function unregisterMine(
    eventIdOrSlug: string,
    viewer: RegistrationViewer,
    occurrenceDate?: string,
): Promise<void> {
    const { event, date, } = await resolveDate(eventIdOrSlug, occurrenceDate,);
    const reg = await findOwn(event.id, date, viewer,);
    if (!reg) throw new NotFoundError('You are not registered for this event.',);
    const over = await occurrenceOver(event, reg.occurrence_date,);
    const cancelled = await transaction(async (client,) => {
        const locked = await client.query<{ status: string; }>(`SELECT status FROM event_registrations WHERE id = $1 FOR UPDATE`, [reg.id,],);
        // Cancelled meanwhile (a second click, another tab): nothing left to do.
        if (locked.rows[0]?.status !== 'registered') return false;
        const t = await client.query<TicketRow>(
            `SELECT code, status, price_cents_paid, currency, NULL::text AS tier_name
               FROM event_tickets WHERE registration_id = $1 AND status IN ('valid', 'checked_in')`,
            [reg.id,],
        );
        if (over) throw new ValidationError('This date has already passed.',);
        if (!canSelfUnregister(t.rows, false,)) {
            throw new ValidationError('This registration includes paid or used tickets — please contact the organiser to cancel it.',);
        }
        await client.query(`UPDATE event_tickets SET status = 'cancelled' WHERE registration_id = $1 AND status = 'valid'`, [reg.id,],);
        await client.query(`UPDATE event_registrations SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [reg.id,],);
        return true;
    },);
    if (!cancelled) return;
    logger.info('event registration cancelled by attendee', { event: event.id, registration: reg.id, date, },);
    await sendUnregisteredMail(event, reg.occurrence_date, reg.email, reg.name,);
}

/** "You're no longer registered" — best-effort (a mail failure never undoes the cancel). */
async function sendUnregisteredMail(event: CalendarEvent, date: string, email: string, name: string | null,): Promise<void> {
    try {
        const when = await describeWhen(event, date,);
        const url = await eventLink(event,);
        await sendPurposeMail('event_unregistered', {
            to: email,
            ...(await eventSender()),
            defaultSubject: `Registration cancelled: ${event.title}`,
            defaultHtml: `<h2>You're no longer registered</h2>
                <p><strong>${escapeHtml(event.title,)}</strong></p>
                <p>${escapeHtml(when,)}</p>
                <p>Changed your mind? <a href="${escapeHtml(url,)}">Register again</a> while places remain.</p>`,
            context: {
                event: { title: event.title, location: event.location ?? '', url, },
                occurrence: { date, when, },
                registration: { name: name ?? '', email, },
            },
        },);
    } catch (e) {
        logger.warn('event un-register: confirmation email failed', { event: event.id, error: (e as Error).message, },);
    }
}
