/**
 * Who wants to HEAR about events — email subscribers and Web Push endpoints.
 *
 * Split from `notifications.ts` (which does the sending) on purpose: sign-up
 * needs to look an event up, and event CRUD needs to send a notification. With
 * both halves in one module those two facts form an import cycle; apart, the
 * dependencies run one way — crud → notifications, subscriptions → crud.
 */
import type { EventSubscriber, } from '@sitesurge/types';
import { isValidEmail, } from '@sitesurge/types';
import crypto from 'crypto';
import { config, } from '../../config';
import { ValidationError, } from '../../core/errors';
import * as repo from '../../repositories/events.repo';
import { logger, } from '../../utils/logger';
import { sendEmail, } from '../email';
import { getByIdOrSlug, } from './crud';
import { escapeHtml, } from './format';
import { eventSender, } from './settings';

function unsubscribeToken(email: string, eventId?: string | null,): string {
    const secret = config.mail.unsubscribeSecret || 'events';
    const payload = `${email.toLowerCase()}:${eventId ?? 'all'}`;
    const sig = crypto.createHmac('sha256', secret,).update(payload,).digest('base64url',);
    return `${Buffer.from(payload,).toString('base64url',)}.${sig}`;
}

/** The opt-in link's token: `<subscriberId>.<HMAC>`, stateless. */
export function confirmToken(subscriberId: string,): string {
    const secret = config.mail.unsubscribeSecret || 'events';
    const sig = crypto.createHmac('sha256', secret,).update(`event-sub-confirm:${subscriberId}`,).digest('base64url',);
    return `${subscriberId}.${sig}`;
}

/** The subscriber id a token proves, or null when it was tampered with. */
export function verifyConfirmToken(token: string,): string | null {
    const [id, sig,] = String(token || '',).split('.',);
    if (!id || !sig) return null;
    const expected = confirmToken(id,).split('.',)[1];
    const a = Buffer.from(sig,);
    const b = Buffer.from(expected,);
    return a.length === b.length && crypto.timingSafeEqual(a, b,) ? id : null;
}

export async function subscribe(input: {
    email: string;
    eventId?: string;
    notifyEmail?: boolean;
    notifyPush?: boolean;
    userId?: string;
},): Promise<EventSubscriber & { pendingConfirmation: boolean; }> {
    const email = (input.email || '').trim();
    if (!isValidEmail(email,)) throw new ValidationError('A valid email address is required',);
    // Subscribing to a specific event requires that event to exist, or the row
    // would dangle and the person would never hear anything.
    const event = input.eventId ? await getByIdOrSlug(input.eventId,) : null;

    // Signed in = the address is the account's own, so it counts at once.
    // Anonymous = double opt-in: nothing is sent to the address except the
    // confirmation link until its owner clicks it.
    const confirmed = Boolean(input.userId,);
    const row = await repo.upsertSubscriber({
        eventId: event?.id ?? null,
        userId: input.userId ?? null,
        email,
        notifyEmail: input.notifyEmail ?? true,
        notifyPush: input.notifyPush ?? false,
        unsubscribeToken: unsubscribeToken(email, event?.id ?? input.eventId,),
        confirmed,
    },);
    const pendingConfirmation = !row.confirmedAt;
    if (pendingConfirmation) await sendConfirmation(row.id, email, event?.title ?? null,);
    const { confirmedAt: _c, ...subscriber } = row;
    return { ...subscriber, pendingConfirmation, };
}

/** The "confirm your subscription" email. Best-effort — the row stays pending. */
async function sendConfirmation(subscriberId: string, email: string, eventTitle: string | null,): Promise<void> {
    try {
        const base = config.frontendUrl.replace(/\/+$/, '',);
        const link = `${base}/api/v1/events/subscribe/confirm/${encodeURIComponent(confirmToken(subscriberId,),)}`;
        const what = eventTitle ? `updates about ${escapeHtml(eventTitle,)}` : 'new events';
        await sendEmail({
            ...(await eventSender()),
            to: email,
            subject: 'Confirm your event notifications',
            html: `<p>Someone (hopefully you) asked to get ${what} at this address.</p>
                <p><a href="${escapeHtml(link,)}">Yes, send me event emails</a></p>
                <p style="color:#6b7280;font-size:12px">If this was not you, ignore this email — nothing more will be sent.</p>`,
        },);
    } catch (e) {
        logger.warn('event subscription confirmation email failed', { error: (e as Error).message, },);
    }
}

/** Follow the opt-in link. Returns false for a bad / stale token. */
export async function confirmSubscription(token: string,): Promise<boolean> {
    const id = verifyConfirmToken(token,);
    if (!id) return false;
    return repo.confirmSubscriber(id,);
}

export async function unsubscribe(token: string,): Promise<boolean> {
    if (!token) return false;
    return repo.deleteSubscriberByToken(token,);
}

export async function registerPushEndpoint(input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    email?: string;
    userId?: string;
    userAgent?: string;
},): Promise<{ subscribed: boolean; pushEnabled: boolean; }> {
    if (!input.endpoint || !input.p256dh || !input.auth) {
        throw new ValidationError('A complete push subscription is required',);
    }
    await repo.upsertPushSubscription({
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        email: input.email ?? null,
        userId: input.userId ?? null,
        userAgent: input.userAgent ?? null,
    },);
    return { subscribed: true, pushEnabled: Boolean(config.webPush.privateKey,), };
}
