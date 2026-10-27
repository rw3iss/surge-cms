/**
 * Notifications — `/api/v1/notifications`.
 *   /me…      the signed-in user's IN-APP notifications + desktop (Web Push)
 *             subscriptions (`notifications:self`)
 *   /options, /sms, /test   admin (`notifications:manage`)
 * Per-type channel config (email, SMS, in-app users/roles, desktop) is saved
 * with the other settings (`PUT /settings { notifications }`).
 * Service: services/notifications. Guide: docs/how-it-works/NOTIFICATIONS.md.
 */
import { NOTIFICATION_TYPES, } from '@sitesurge/types';
import { z, } from 'zod';
import { defineRoute, } from '../api/defineRoute';
import { ValidationError, } from '../core/errors';
import { notify, } from '../services/notifications';
import * as inApp from '../services/notifications/inApp';
import * as options from '../services/notifications/options';
import * as push from '../services/notifications/push';
import { isPhone, smsProvider, } from '../services/notifications/sms';
import * as permissions from '../services/permissions';

type Caller = { id?: string; role?: string; } | undefined;
async function self(user: Caller,): Promise<string> {
    await permissions.requirePermission({ id: user?.id, role: user?.role, }, 'notifications:self',);
    return user!.id!;
}
const manage = (user: Caller,) => permissions.requirePermission({ id: user?.id, role: user?.role, }, 'notifications:manage',);
const idsBody = z.object({ ids: z.array(z.string().uuid(),).max(500,).optional(), all: z.boolean().optional(), },);

export const notificationRoutes = [
    // ── The user's own ──
    defineRoute({
        method: 'get', path: '/me', auth: 'user',
        summary: 'Your in-app notifications (newest first; `unread=1` for unread only), the unread count and whether in-app notifications are on.',
        input: {
            query: z.object({
                unread: z.string().optional(), type: z.string().max(64,).optional(),
                page: z.coerce.number().int().min(1,).default(1,), limit: z.coerce.number().int().min(1,).max(100,).default(20,),
            },),
        },
        handler: async ({ user, query, },) => inApp.listFor(await self(user,), { unread: query.unread === '1' || query.unread === 'true', type: query.type, page: query.page, limit: query.limit, },),
    },),
    defineRoute({
        method: 'get', path: '/me/count', auth: 'user',
        summary: 'Your unread in-app notification count (+ whether in-app notifications are on) — polled by the admin sidebar.',
        handler: async ({ user, },) => ({ unread: await inApp.unreadCount(await self(user,),), enabled: (await options.getNotificationOptions()).inAppEnabled, }),
    },),
    defineRoute({
        method: 'post', path: '/me/read', auth: 'user',
        summary: 'Mark your notifications read: `ids`, or `all: true`.',
        input: { body: idsBody, },
        handler: async ({ user, body, },) => ({ updated: await inApp.markRead(await self(user,), body.all ? 'all' : body.ids ?? [],), }),
    },),
    defineRoute({
        method: 'post', path: '/me/clear', auth: 'user',
        summary: 'Clear (remove) your notifications: `ids`, or `all: true`.',
        input: { body: idsBody, },
        handler: async ({ user, body, },) => ({ cleared: await inApp.clear(await self(user,), body.all ? 'all' : body.ids ?? [],), }),
    },),
    defineRoute({
        method: 'get', path: '/me/push', auth: 'user',
        summary: 'Desktop notifications: the VAPID public key (null = not available on this server) and how many of your browsers are subscribed.',
        handler: async ({ user, },) => {
            const id = await self(user,);
            const publicKey = await push.publicKey();
            return { available: !!publicKey, publicKey, subscriptions: await push.subscriptionCount(id,), };
        },
    },),
    defineRoute({
        method: 'post', path: '/me/push/subscribe', auth: 'user',
        summary: 'Turn desktop notifications on for this browser (its Web Push subscription).',
        input: {
            body: z.object({
                endpoint: z.string().url().max(2000,),
                keys: z.object({ p256dh: z.string().max(200,), auth: z.string().max(100,), },),
            },),
        },
        handler: async ({ user, body, req, },) => {
            await push.subscribe(await self(user,), body, (req.headers['user-agent'] as string | undefined) ?? null,);
            return { ok: true, };
        },
    },),
    defineRoute({
        method: 'post', path: '/me/push/unsubscribe', auth: 'user',
        summary: 'Turn desktop notifications off for this browser.',
        input: { body: z.object({ endpoint: z.string().max(2000,), },), },
        handler: async ({ user, body, },) => { await push.unsubscribe(await self(user,), body.endpoint,); return { ok: true, }; },
    },),

    // ── Admin ──
    defineRoute({
        method: 'get', path: '/options', auth: 'admin',
        summary: 'In-app notifications on/off + how long they are kept.',
        handler: async ({ user, },) => { await manage(user,); return options.getNotificationOptions(); },
    },),
    defineRoute({
        method: 'put', path: '/options', auth: 'admin',
        summary: 'Update the in-app notification options.',
        input: { body: z.object({ inAppEnabled: z.boolean().optional(), retentionDays: z.number().int().min(1,).max(3650,).optional(), },), },
        handler: async ({ user, body, },) => { await manage(user,); return options.setNotificationOptions(body, user?.id ?? null,); },
    },),
    defineRoute({
        method: 'get', path: '/sms', auth: 'admin',
        summary: 'The SMS provider settings (auth token masked).',
        handler: async ({ user, },) => { await manage(user,); return options.smsSettingsForAdmin(); },
    },),
    defineRoute({
        method: 'put', path: '/sms', auth: 'admin',
        summary: 'Set the SMS provider (Twilio): Account SID, auth token (the mask = unchanged), sending number or Messaging Service SID.',
        input: {
            body: z.object({
                provider: z.enum(['none', 'twilio',],).optional(), accountSid: z.string().max(64,).optional(),
                authToken: z.string().max(200,).optional(), fromNumber: z.string().max(64,).optional(),
            },),
        },
        handler: async ({ user, body, },) => { await manage(user,); return options.setSmsSettings(body, user?.id ?? null,); },
    },),
    defineRoute({
        method: 'post', path: '/sms/test', auth: 'admin',
        summary: 'Send a test SMS to a number through the configured provider.',
        input: { body: z.object({ to: z.string().max(20,), },), },
        handler: async ({ user, body, },) => {
            await manage(user,);
            if (!isPhone(body.to,)) throw new ValidationError('Use international format, e.g. +12155550123.',);
            const provider = await smsProvider();
            if (!provider) throw new ValidationError('Set up the SMS provider first.',);
            await provider.send(body.to.trim(), 'Test notification from your site — SMS notifications work.',);
            return { ok: true, };
        },
    },),
    defineRoute({
        method: 'post', path: '/test', auth: 'admin',
        summary: 'Send a TEST of a notification type to its configured recipients on every enabled channel.',
        input: { body: z.object({ type: z.string().max(64,), },), },
        handler: async ({ user, body, },) => {
            await manage(user,);
            const meta = NOTIFICATION_TYPES.find((t,) => t.key === body.type,);
            if (!meta) throw new ValidationError('Unknown notification type.',);
            await notify(body.type, {
                subject: `Test: ${meta.label}`,
                title: `Test: ${meta.label}`,
                body: `A test of the "${meta.label}" notification.`,
                url: '/admin/notifications',
                text: `A test of the "${meta.label}" notification.`,
                html: `<p>A test of the <strong>${meta.label}</strong> notification.</p>`,
            },);
            return { ok: true, };
        },
    },),
];
