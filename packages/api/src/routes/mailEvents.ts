/**
 * Reply tracking endpoints (`/api/v1/mail-events`).
 *
 * Public (no session — they are called by AWS and by mail clients):
 *   POST /ses/:token   SNS → SES delivery / bounce / complaint events (signed; see services/reply/sesEvents)
 *   GET  /o/:token     the open image (always a GIF, even for a bad token)
 *   GET  /c/:token?u=  the click redirect (404 unless the signature covers `u`)
 * Admin:
 *   GET/PUT /settings, POST /settings/rotate
 */
import { z, } from 'zod';
import type { ReplyTrackingSettingsBody, ReplyTrackingSettingsResponse, } from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import * as permissions from '../services/permissions';
import * as sesEvents from '../services/reply/sesEvents';
import * as tracking from '../services/reply/tracking';

const tokenParams = z.object({ token: z.string().max(128,), },);
const settingsBody = z.object({
    deliveryEvents: z.boolean().optional(),
    configurationSet: z.string().trim().max(64,).regex(/^[A-Za-z0-9_-]*$/, 'Letters, numbers, - and _ only',).optional(),
    trackOpens: z.boolean().optional(),
    trackClicks: z.boolean().optional(),
},) satisfies z.ZodType<ReplyTrackingSettingsBody>;

const perm = (user: { id?: string; role?: string; } | undefined, key: string,) =>
    permissions.requirePermission({ id: user?.id, role: user?.role, } as never, key,);

export const mailEventsRoutes = [
    defineRoute({
        method: 'post', path: '/ses/:token', auth: 'public', raw: true,
        summary: 'Amazon SNS endpoint for SES events (delivery, bounce, complaint, …) on admin replies. Token + SNS signature + pinned topic.',
        input: { params: tokenParams, },
        handler: async ({ params, req, res, },) => {
            const body = typeof req.body === 'string' ? req.body : (req as { rawBody?: string; }).rawBody ?? JSON.stringify(req.body ?? null,);
            const out = await sesEvents.handleSnsWebhook(params.token, body,);
            res.status(out.status,).type('text/plain',).send(out.body,);
        },
    },),

    defineRoute({
        method: 'get', path: '/o/:token', auth: 'public', raw: true,
        summary: 'Open-tracking image for an admin reply (1×1 GIF).',
        input: { params: tokenParams, },
        handler: async ({ params, req, res, },) => {
            await tracking.recordOpen(params.token, req.headers['user-agent'],);
            res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, private', Pragma: 'no-cache', },);
            res.status(200,).end(tracking.PIXEL,);
        },
    },),

    defineRoute({
        method: 'get', path: '/c/:token', auth: 'public', raw: true,
        summary: 'Click-tracking redirect for a link in an admin reply.',
        input: { params: tokenParams, query: z.object({ u: z.string().max(4000,), },), },
        handler: async ({ params, query, res, },) => {
            const target = await tracking.recordClick(params.token, query.u,);
            if (!target) {
                res.status(404,).type('text/plain',).send('Link not found',);
                return;
            }
            res.set('Cache-Control', 'no-store',).redirect(302, target,);
        },
    },),

    defineRoute({
        method: 'get', path: '/settings', auth: 'admin',
        summary: 'Reply tracking settings + webhook URL + last SES event.',
        handler: async ({ user, },): Promise<ReplyTrackingSettingsResponse> => {
            await perm(user, 'settings:read',);
            return tracking.status();
        },
    },),

    defineRoute({
        method: 'put', path: '/settings', auth: 'admin',
        summary: 'Update reply tracking (delivery events, configuration set, opens, clicks).',
        input: { body: settingsBody, },
        handler: async ({ body, user, audit, },): Promise<ReplyTrackingSettingsResponse> => {
            await perm(user, 'settings:write',);
            return tracking.update(body, audit(),);
        },
    },),

    defineRoute({
        method: 'post', path: '/settings/rotate', auth: 'admin',
        summary: 'Issue a new webhook URL (the old one stops working; re-create the SNS subscription).',
        handler: async ({ user, },): Promise<ReplyTrackingSettingsResponse> => {
            await perm(user, 'settings:write',);
            return tracking.rotateToken();
        },
    },),
];
