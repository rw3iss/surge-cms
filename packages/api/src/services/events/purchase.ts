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
import { sendEmail, } from '../email';
import { logger, } from '../../utils/logger';
import { register, } from './registration';
import { getSettings, } from './settings';
import { issueTickets, resolveTicketLines, } from './tickets';

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
    userId?: string;
},): Promise<PurchaseResult> {
    const settings = await getSettings();
    if (!settings.allowTicketing) {
        throw new ValidationError('Ticket sales are not enabled for this site.',);
    }
    const email = (input.email || '').trim();
    if (!isValidEmail(email,)) throw new ValidationError('A valid email address is required',);
    if (!input.lines?.length) throw new ValidationError('No tickets selected.',);

    const { lines, totalCents, } = await resolveTicketLines(input.lines,);

    // Every line must belong to one event: an order spans a single event's
    // registration, and mixing them would leave attendees on the wrong list.
    const eventIds = [...new Set(lines.map((l,) => l.eventId),),];
    if (eventIds.length > 1) {
        throw new ValidationError('Please check out tickets for one event at a time.',);
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
        userId: input.userId,
    },);
    const tickets = await issueTickets(registration.id, lines,);
    await sendTicketConfirmation(lines[0].eventId, email, tickets,);

    return {
        status: 'confirmed',
        totalCents,
        currency,
        registrationId: registration.id,
        tickets: tickets.map((t,) => ({ code: t.code, tierName: t.tierName, }),),
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
): Promise<void> {
    try {
        const event = await repo.findById(eventId,);
        if (!event) return;
        const when = new Date(event.startsAt,).toLocaleString('en-US', {
            dateStyle: 'full', timeStyle: 'short',
        },);
        const rows = tickets.map((t,) =>
            `<tr><td style="padding:4px 10px 4px 0">${t.tierName}</td>`
            + `<td style="padding:4px 0"><code>${t.code}</code></td></tr>`).join('',);

        await sendEmail({
            to: email,
            subject: `Your tickets: ${event.title}`,
            html: `<h2>You're going to ${event.title}</h2>
                <p>${when}</p>
                ${event.location ? `<p>${event.location}</p>` : ''}
                <h3 style="margin-top:18px">Your tickets</h3>
                <table>${rows}</table>
                <p style="margin-top:16px">
                    <a href="${config.frontendUrl.replace(/\/+$/, '',)}/events/${event.slug}">
                        View the event
                    </a>
                </p>
                <p style="color:#666;font-size:12px">Bring these codes with you.</p>`,
        },);
    } catch (e) {
        logger.warn('event ticket confirmation email failed', {
            eventId, error: (e as Error).message,
        },);
    }
}
