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
import { getByIdOrSlug, } from './crud';

function unsubscribeToken(email: string, eventId?: string | null,): string {
    const secret = config.mail.unsubscribeSecret || 'events';
    const payload = `${email.toLowerCase()}:${eventId ?? 'all'}`;
    const sig = crypto.createHmac('sha256', secret,).update(payload,).digest('base64url',);
    return `${Buffer.from(payload,).toString('base64url',)}.${sig}`;
}

export async function subscribe(input: {
    email: string;
    eventId?: string;
    notifyEmail?: boolean;
    notifyPush?: boolean;
    userId?: string;
},): Promise<EventSubscriber> {
    const email = (input.email || '').trim();
    if (!isValidEmail(email,)) throw new ValidationError('A valid email address is required',);
    // Subscribing to a specific event requires that event to exist, or the row
    // would dangle and the person would never hear anything.
    if (input.eventId) await getByIdOrSlug(input.eventId,);

    return repo.upsertSubscriber({
        eventId: input.eventId ?? null,
        userId: input.userId ?? null,
        email,
        notifyEmail: input.notifyEmail ?? true,
        notifyPush: input.notifyPush ?? false,
        unsubscribeToken: unsubscribeToken(email, input.eventId,),
    },);
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
