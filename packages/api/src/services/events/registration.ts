/**
 * Attendee registration.
 *
 * Distinct from `subscriptions.ts`, which only signs someone up for
 * NOTIFICATIONS. Conflating the two would mean a "Register" button that never
 * told the organiser who was actually coming.
 */
import type { EventRegistration, } from '@sitesurge/types';
import { isValidEmail, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import * as repo from '../../repositories/events.repo';
import { logger, } from '../../utils/logger';
import { sendPurposeMail, } from '../mail/purposes';
import { assertCanRegister, } from './access';
import { assertBookableOccurrence, nextOccurrenceDate, } from './bookable';
import type { LevelViewer, } from '../access/level';
import { getByIdOrSlug, } from './crud';
import { describeWhen, escapeHtml, eventLink, } from './format';
import { eventSender, getSettings, } from './settings';
import { eventLocationText, } from '@sitesurge/types';

/**
 * The occurrence a registration lands on when the caller didn't name one.
 *
 * A non-recurring event has exactly one occurrence — its own start date. This
 * accepts a `Date` as well as an ISO string on purpose: the repository maps
 * `*_at` columns to `Date` objects, and calling `.slice()` on one is precisely
 * the bug that shipped here once already. Normalising in one place means a
 * future change to row mapping can't resurrect it.
 */
export function defaultOccurrenceDate(startsAt: string | Date,): string {
    const iso = startsAt instanceof Date ? startsAt.toISOString() : String(startsAt,);
    return iso.slice(0, 10,);
}

/** Register an attendee for one occurrence. */
export async function register(input: {
    eventId: string;
    occurrenceDate?: string;
    email: string;
    name?: string;
    phone?: string;
    fields?: Record<string, unknown>;
    userId?: string;
    /**
     * Send the "You're registered" email (default true). The ticket paths
     * turn it off: their ticket email already confirms the registration, and
     * two messages for one sign-up read as a mistake.
     */
    sendConfirmation?: boolean;
    /**
     * The person registering — given on PUBLIC paths (register route, ticket
     * purchase), so the event's register rule is enforced. Omitted by the paid
     * ticket fulfilment, which runs after a checkout that already checked it.
     */
    viewer?: LevelViewer;
},): Promise<EventRegistration> {
    const event = await getByIdOrSlug(input.eventId,);
    if ('viewer' in input) await assertCanRegister(event, input.viewer,);
    if (!event.registrationEnabled) {
        throw new ValidationError('Registration is not open for this event.',);
    }
    const settings = await getSettings();
    if (!settings.allowRegistration) {
        throw new ValidationError('Event registration is disabled for this site.',);
    }
    const email = (input.email || '').trim();
    if (!isValidEmail(email,)) throw new ValidationError('A valid email address is required',);

    // No date named → the next upcoming occurrence (not the series start, which
    // for a weekly series is usually long past). A public caller's date must be
    // a real, open occurrence — capacity is per date.
    const occurrenceDate = input.occurrenceDate || await nextOccurrenceDate(event,);
    if ('viewer' in input) await assertBookableOccurrence(event, occurrenceDate,);

    const registration = await repo.upsertRegistration({
        eventId: event.id,
        occurrenceDate,
        userId: input.userId ?? null,
        email,
        name: input.name ?? null,
        phone: input.phone ?? null,
        fields: input.fields ?? {},
    },);

    if (input.sendConfirmation === false) return registration;

    // Confirmation is best-effort: a mail failure must not lose the registration.
    try {
        const when = await describeWhen(event, occurrenceDate,);
        const url = await eventLink(event,);
        // A mail purpose (Events settings → Emails): the operator can edit or
        // switch it off; this body is the built-in default.
        await sendPurposeMail('event_registered', {
            to: email,
            ...(await eventSender()),
            defaultSubject: `You're registered: ${event.title}`,
            defaultHtml: `<h2>You're registered</h2>
                <p><strong>${escapeHtml(event.title,)}</strong></p>
                <p>${escapeHtml(when,)}</p>
                ${eventLocationText(event,) ? `<p>${escapeHtml(eventLocationText(event,)!,)}</p>` : ''}
                <p><a href="${escapeHtml(url,)}">View the event</a></p>`,
            context: {
                event: { title: event.title, location: eventLocationText(event,) ?? '', url, },
                occurrence: { date: occurrenceDate, when, },
                registration: { name: input.name ?? '', email, },
            },
        },);
    } catch (e) {
        logger.warn('event registration: confirmation email failed', {
            event: event.id,
            error: (e as Error).message,
        },);
    }
    return registration;
}

/** How many people are registered for an occurrence. */
export async function registrantCount(
    eventId: string,
    occurrenceDate: string,
): Promise<number> {
    return repo.countRegistrations(eventId, occurrenceDate,);
}

export async function listRegistrations(
    eventId: string,
    occurrenceDate: string,
    pagination: { page?: number; limit?: number; } = {},
) {
    const page = await repo.findRegistrations(eventId, occurrenceDate, pagination,);
    // Attach each attendee's tickets so the admin can open a ticket page.
    const ids = page.data.map((r,) => r.id);
    if (ids.length) {
        const t = await query<
            {
                registration_id: string;
                tier_id: string | null;
                code: string;
                status: string;
                tier_name: string | null;
                price_cents_paid: number;
                currency: string;
            }
        >(
            `SELECT t.registration_id, t.tier_id, t.code, t.status, tr.name AS tier_name, t.price_cents_paid, t.currency
               FROM event_tickets t LEFT JOIN event_ticket_tiers tr ON tr.id = t.tier_id
              WHERE t.registration_id = ANY($1::uuid[])
              ORDER BY t.created_at, t.code`,
            [ids,],
        );
        for (const r of page.data) {
            r.tickets = t.rows.filter((x,) => x.registration_id === r.id).map((x,) => ({
                id: x.code,
                registrationId: r.id,
                tierId: x.tier_id,
                tierName: x.tier_name ?? 'Ticket',
                eventId,
                occurrenceDate,
                code: x.code,
                status: x.status as never,
                priceCentsPaid: Number(x.price_cents_paid,),
                currency: x.currency,
                createdAt: '',
            }));
        }
    }
    return page;
}
