/**
 * Ticket purchase — the checkout seam between a cart and issued tickets.
 *
 * FREE tickets complete immediately: sending someone through a card flow to
 * charge zero is pure friction. PAID tickets are priced here FROM THE DATABASE
 * (never from the cart) and handed back for the Stripe step; tickets are only
 * issued once payment has succeeded, so an abandoned checkout never holds
 * inventory.
 */
import type { EventTicketCartLine, } from '@sitesurge/types';
import { isValidEmail, } from '@sitesurge/types';
import { config, } from '../../config';
import { ValidationError, } from '../../core/errors';
import * as repo from '../../repositories/events.repo';
import { logger, } from '../../utils/logger';
import { sendPurposeMail, } from '../mail/purposes';
import { describeWhen, escapeHtml, eventLink, } from './format';
import { register, } from './registration';
import { eventSender, getSettings, } from './settings';
import { issueTickets, resolveTicketLines, } from './tickets';
import type { LevelViewer, } from '../access/level';
import { eventLocationText, } from '@sitesurge/types';

export interface PurchaseResult {
    status: 'confirmed' | 'payment_required';
    totalCents: number;
    currency: string;
    registrationId?: string;
    tickets?: Array<{ code: string; tierName: string; }>;
}

export async function purchaseTickets(input: {
    lines: EventTicketCartLine[];
    email: string;
    name?: string;
    phone?: string;
    fields?: Record<string, unknown>;
    userId?: string;
    /** The buyer (`{ id, role }`, null when signed out): enforces register + ticket tier rules. */
    viewer: LevelViewer;
},): Promise<PurchaseResult> {
    const settings = await getSettings();
    if (!settings.allowTicketing) {
        throw new ValidationError('Ticket sales are not enabled for this site.',);
    }
    const email = (input.email || '').trim();
    if (!isValidEmail(email,)) throw new ValidationError('A valid email address is required',);
    if (!input.lines?.length) throw new ValidationError('No tickets selected.',);

    const { lines, totalCents, } = await resolveTicketLines(input.lines, { viewer: input.viewer, buyerEmail: email, },);

    // Every line must belong to one event: an order spans a single event's
    // registration, and mixing them would leave attendees on the wrong list.
    const eventIds = [...new Set(lines.map((l,) => l.eventId),),];
    if (eventIds.length > 1) {
        throw new ValidationError('Please check out tickets for one event at a time.',);
    }
    // …and one DATE: the registration is per occurrence, and a ticket for
    // week 3 must not hang off a registration for week 1.
    if (new Set(lines.map((l,) => l.occurrenceDate),).size > 1) {
        throw new ValidationError('Please check out tickets for one date at a time.',);
    }

    const currency = lines[0]?.currency ?? 'USD';

    if (totalCents > 0) {
        // Paid: the storefront takes this to the Stripe step. Nothing is
        // issued and no inventory is consumed until payment confirms.
        return { status: 'payment_required', totalCents, currency, };
    }

    // Free: register and issue immediately.
    const registration = await register({
        eventId: lines[0].eventId,
        occurrenceDate: lines[0].occurrenceDate,
        email,
        name: input.name,
        phone: input.phone,
        fields: input.fields,
        userId: input.userId,
        sendConfirmation: false,
        viewer: input.viewer,
    },);
    const tickets = await issueTickets(registration.id, lines,);
    await sendTicketConfirmation(lines[0].eventId, email, tickets, lines[0].occurrenceDate,);

    return {
        status: 'confirmed',
        totalCents,
        currency,
        registrationId: registration.id,
        tickets: tickets.map((t,) => ({ code: t.code, tierName: t.tierName, })),
    };
}

/**
 * Ticket confirmation email. Best-effort — a mail failure must not undo a
 * completed purchase.
 */
export async function sendTicketConfirmation(
    eventId: string,
    email: string,
    tickets: Array<{ code: string; tierName: string; priceCents?: number; currency?: string; }>,
    occurrenceDate?: string | null,
): Promise<void> {
    try {
        const event = await repo.findById(eventId,);
        if (!event) return;
        const when = await describeWhen(event, occurrenceDate,);
        const url = await eventLink(event,);
        const base = config.frontendUrl.replace(/\/+$/, '',);
        const ticketUrl = (code: string,) => `${base}/tickets/${encodeURIComponent(code,)}`;
        // Each code links to its ticket page — the proof of registration.
        const rows = tickets.map((t,) =>
            `<tr><td style="padding:4px 10px 4px 0">${escapeHtml(t.tierName,)}</td>` +
            `<td style="padding:4px 0"><a href="${escapeHtml(ticketUrl(t.code,),)}"><code>${escapeHtml(t.code,)}</code></a></td></tr>`
        ).join('',);
        const ticketsHtml = `<table>${rows}</table>`;

        // A mail purpose (Events settings → Emails): editable, switchable; this
        // body is the built-in default.
        await sendPurposeMail('event_tickets', {
            to: email,
            ...(await eventSender()),
            defaultSubject: `Your tickets: ${event.title}`,
            defaultHtml: `<h2>You're going to ${escapeHtml(event.title,)}</h2>
                <p>${escapeHtml(when,)}</p>
                ${eventLocationText(event,) ? `<p>${escapeHtml(eventLocationText(event,)!,)}</p>` : ''}
                <h3 style="margin-top:18px">Your tickets</h3>
                ${ticketsHtml}
                <p style="margin-top:16px">
                    <a href="${escapeHtml(url,)}">View the event</a>
                </p>
                <p style="color:#6b7280;font-size:12px">Bring these codes with you.</p>`,
            context: {
                event: { title: event.title, location: eventLocationText(event,) ?? '', url, },
                occurrence: { date: occurrenceDate ?? '', when, },
                tickets: tickets.map((t,) => ({ code: t.code, tier: t.tierName, url: ticketUrl(t.code,), })),
                ticketsHtml,
            },
        },);
    } catch (e) {
        logger.warn('event ticket confirmation email failed', {
            eventId,
            error: (e as Error).message,
        },);
    }
}
