/**
 * Events & calendar routes (feature-gated behind `events`).
 *
 * Reads are `optional` auth and role-shaped: anonymous callers only ever see
 * `published` events, staff additionally see drafts. Writes are `staff` — the
 * same tier the other content modules use, so editors can manage events without
 * full admin. Subscribe/unsubscribe are public so a visitor can follow an event
 * without an account.
 */
import { z, } from 'zod';
import type {
    EventsCreateBody,
    EventsSubscribeBody,
    EventsUnsubscribeBody,
} from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import { reply, } from '../api/types';
import * as events from '../services/events';

const isoDate = z.string().refine((s,) => !Number.isNaN(Date.parse(s,),), 'Expected an ISO date',);

const listQuery = z.object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    status: z.enum(['draft', 'published', 'cancelled',],).optional(),
    search: z.string().max(200,).optional(),
    page: z.coerce.number().int().min(1,).optional(),
    limit: z.coerce.number().int().min(1,).max(500,).optional(),
    sort: z.enum(['asc', 'desc',],).optional(),
},);

const eventBody = z.object({
    title: z.string().min(1,).max(255,),
    slug: z.string().max(255,).optional(),
    description: z.string().nullish(),
    startsAt: isoDate,
    endsAt: isoDate.nullish(),
    allDay: z.boolean().optional(),
    location: z.string().max(255,).nullish(),
    url: z.string().max(500,).nullish(),
    featuredImage: z.string().max(500,).nullish(),
    status: z.enum(['draft', 'published', 'cancelled',],).optional(),
},) satisfies z.ZodType<EventsCreateBody>;

const subscribeBody = z.object({
    email: z.string().email(),
    eventId: z.string().uuid().optional(),
    notifyEmail: z.boolean().optional(),
    notifyPush: z.boolean().optional(),
},) satisfies z.ZodType<EventsSubscribeBody>;

const pushBody = z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string().min(1,), auth: z.string().min(1,), },),
    email: z.string().email().optional(),
},);

export const eventsRoutes = [

    // ─── Settings (declared BEFORE /:idOrSlug so it isn't swallowed) ───
    defineRoute({
        method: 'get', path: '/settings', auth: 'public',
        summary: 'Public events settings (notification toggles + VAPID public key).',
        handler: () => events.getPublicSettings(),
    },),

    defineRoute({
        method: 'put', path: '/settings', auth: 'admin',
        summary: 'Update the events module settings.',
        input: {
            body: z.object({
                notifyOnPublish: z.boolean().optional(),
                reminderHoursBefore: z.number().int().min(0,).max(720,).optional(),
                vapidPublicKey: z.string().optional(),
            },),
        },
        handler: ({ body, audit, },) => events.updateSettings(body, audit(),),
    },),

    // ─── Subscriptions ───
    defineRoute({
        method: 'post', path: '/subscribe', auth: 'optional',
        summary: 'Subscribe to one event, or to all events when eventId is omitted.',
        input: { body: subscribeBody, },
        handler: async ({ body, user, },) => ({
            subscriber: await events.subscribe({ ...body, userId: user?.id, },),
        }),
    },),

    defineRoute({
        method: 'post', path: '/unsubscribe', auth: 'public',
        summary: 'Unsubscribe using the token from a notification email.',
        input: { body: z.object({ token: z.string().min(1,), },) satisfies z.ZodType<EventsUnsubscribeBody>, },
        handler: async ({ body, },) => ({ unsubscribed: await events.unsubscribe(body.token,), }),
    },),

    defineRoute({
        method: 'post', path: '/push/subscribe', auth: 'optional',
        summary: 'Register a browser Web Push endpoint for desktop notifications.',
        input: { body: pushBody, },
        handler: ({ body, user, req, },) =>
            events.registerPushEndpoint({
                endpoint: body.endpoint,
                p256dh: body.keys.p256dh,
                auth: body.keys.auth,
                email: body.email ?? user?.email,
                userId: user?.id,
                userAgent: req.headers['user-agent'],
            },),
    },),

    // ─── Reads ───
    defineRoute({
        method: 'get', path: '/', auth: 'optional',
        summary: 'List events in a date range. Anonymous callers see published only.',
        input: { query: listQuery, },
        handler: async ({ query, user, },) => {
            const admin = isStaffRole(user?.role,);
            const { data, meta, } = await events.list({ ...query, admin, },);
            return reply(data, { meta, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/:idOrSlug', auth: 'optional',
        summary: 'A single event by id or slug.',
        input: { params: z.object({ idOrSlug: z.string().min(1,), },), },
        handler: ({ params, user, },) =>
            events.getByIdOrSlug(params.idOrSlug, { admin: isStaffRole(user?.role,), },),
    },),

    // ─── Writes (staff) ───
    defineRoute({
        method: 'post', path: '/', auth: 'staff',
        summary: 'Create an event.',
        input: { body: eventBody, },
        handler: async ({ body, audit, },) =>
            reply(await events.create(body, audit(),), { status: 201, },),
    },),

    defineRoute({
        method: 'put', path: '/:id', auth: 'staff',
        summary: 'Update an event.',
        input: { params: z.object({ id: z.string().uuid(), },), body: eventBody.partial(), },
        handler: ({ params, body, audit, },) => events.update(params.id, body, audit(),),
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'staff',
        summary: 'Delete an event.',
        input: { params: z.object({ id: z.string().uuid(), },), },
        handler: async ({ params, audit, },) => {
            await events.remove(params.id, audit(),);
            return { deleted: true, };
        },
    },),
];
