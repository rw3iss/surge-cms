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
    // NOTE: zod STRIPS unknown keys, so anything absent here never reaches the
    // service — a field added to the type and the table is silently dropped
    // until it is also declared on this schema.
    timezone: z.string().max(64,).nullish(),
    recurrenceRule: z.string().max(255,).nullish(),
    recurrenceUntil: isoDate.nullish(),
    registrationEnabled: z.boolean().optional(),
    registrationFields: z.array(z.string().max(50,),).optional(),
    showRegistrantCount: z.boolean().optional(),
    ticketingEnabled: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown(),).optional(),
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
                eventsUrl: z.string().max(64,).optional(),
                allowRegistration: z.boolean().optional(),
                allowTicketing: z.boolean().optional(),
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


    // ─── Calendar (occurrence-expanded) ───
    // Declared before /:idOrSlug so the literal path isn't swallowed by it.
    defineRoute({
        method: 'get', path: '/calendar', auth: 'optional',
        summary: 'Occurrences in a date window, with recurring series expanded.',
        input: {
            query: z.object({
                from: isoDate,
                to: isoDate,
                search: z.string().max(200,).optional(),
            },),
        },
        handler: async ({ query, user, },) => {
            const admin = isStaffRole(user?.role,);
            return events.listOccurrences({ ...query, admin, },);
        },
    },),

    // ─── Ticket tiers ───
    defineRoute({
        method: 'get', path: '/:id/tiers', auth: 'optional',
        summary: 'Ticket tiers for an occurrence, with sold/remaining counts.',
        input: {
            params: z.object({ id: z.string().uuid(), },),
            query: z.object({ occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/,), },),
        },
        handler: ({ params, query, },) => events.listTiers(params.id, query.occurrenceDate,),
    },),

    defineRoute({
        method: 'put', path: '/:id/tiers', auth: 'staff',
        summary: 'Replace an event\'s ticket tiers.',
        input: {
            params: z.object({ id: z.string().uuid(), },),
            body: z.object({
                tiers: z.array(z.object({
                    id: z.string().uuid().optional(),
                    name: z.string().min(1,).max(255,),
                    // 0 is valid: a free tier with a cap is a limited free event.
                    priceCents: z.number().int().min(0,),
                    currency: z.string().length(3,).default('USD',),
                    quantityAvailable: z.number().int().min(0,).nullable(),
                    position: z.number().int().min(0,).default(0,),
                },),),
            },),
        },
        handler: ({ params, body, audit, },) =>
            events.replaceTiers(params.id, body.tiers, audit(),),
    },),

    // ─── Per-date exceptions ───
    defineRoute({
        method: 'put', path: '/:id/occurrences/:date', auth: 'staff',
        summary: 'Cancel or restore one date of a recurring series.',
        input: {
            params: z.object({
                id: z.string().uuid(),
                date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/,),
            },),
            body: z.object({ status: z.enum(['cancelled',],).nullable(), },),
        },
        handler: async ({ params, body, audit, },) => {
            await events.setOccurrenceStatus(params.id, params.date, body.status, audit(),);
            return { ok: true, };
        },
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
