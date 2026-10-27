/**
 * Events & calendar routes (feature-gated behind `events`).
 *
 * Reads are `optional` auth and role-shaped: anonymous callers only ever see
 * `published` events, staff additionally see drafts. Writes are `staff` — the
 * same tier the other content modules use, so editors can manage events without
 * full admin. Subscribe/unsubscribe are public so a visitor can follow an event
 * without an account.
 */
import type { EventsCreateBody, EventsSubscribeBody, EventsUnsubscribeBody, } from '@sitesurge/types';
import { isAdminRole, isStaffRole, } from '@sitesurge/types';
import { z, } from 'zod';
import { defineRoute, } from '../api/defineRoute';
import { ValidationError, } from '../core/errors';
import { reply, } from '../api/types';
import type { RouteDef, } from '../api/types';
import * as events from '../services/events';
import { sendCsv, sendPrint, } from '../services/export/formats';
import { getPublicSettings as getSitePublicSettings, } from '../services/settings';
import { can, requirePermission, } from '../services/permissions';

// ─── Permissions ───────────────────────────────────────────────────
//
// The route tier decides who reaches a route; these narrow it within the
// tier (Settings → Permissions). API keys are scoped by the key itself and
// skip the check. Defaults cover the tier, so today's access is unchanged.

async function gate(user: { id: string; role: string; } | undefined, key: string,): Promise<void> {
    if (user) await requirePermission({ id: user.id, role: user.role, }, key,);
}

/** Staff see drafts + every registrant only while they hold `events:read`. */
async function staffView(user: { id: string; role: string; } | undefined,): Promise<boolean> {
    if (!user || !isStaffRole(user.role,)) return false;
    return can({ id: user.id, role: user.role, }, 'events:read',);
}

export const EVENT_ROUTE_PERMISSIONS: Record<string, string> = {
    'PUT /settings': 'events:write',
    'PUT /:id/tiers': 'events:write',
    'PUT /:id/occurrences/:date': 'events:write',
    'GET /:id/registrations': 'events.registrations:read',
    'POST /:id/unregister': 'events.registrations:cancel_own',
    'GET /:id/registrations/export': 'events.registrations:read',
    'PUT /tickets/:code/check-in': 'events:write',
    'POST /': 'events:write',
    'PUT /:id': 'events:write',
    'DELETE /:id': 'events:write',
};

function withPermissions(routes: RouteDef[], table: Record<string, string>,): RouteDef[] {
    return routes.map((r,) => {
        const key = table[`${r.method.toUpperCase()} ${r.path}`];
        if (!key) return r;
        const inner = r.handler;
        return {
            ...r,
            handler: async (ctx,) => {
                await gate(ctx.user as { id: string; role: string; } | undefined, key,);
                return inner(ctx,);
            },
        };
    },);
}

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
    locationLabel: z.string().max(255,).nullish(),
    locationLat: z.number().min(-90,).max(90,).nullish(),
    locationLng: z.number().min(-180,).max(180,).nullish(),
    showMap: z.boolean().optional(),
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
    viewAccess: z.enum(['inherit', 'public', 'members', 'tier',],).optional(),
    viewMinTierId: z.string().uuid().nullable().optional(),
    registerAccess: z.enum(['inherit', 'public', 'members', 'tier',],).optional(),
    registerMinTierId: z.string().uuid().nullable().optional(),
    metadata: z.record(z.string(), z.unknown(),).optional(),
},) satisfies z.ZodType<EventsCreateBody>;

const subscribeBody = z.object({
    email: z.string().email(),
    eventId: z.string().uuid().optional(),
    notifyEmail: z.boolean().optional(),
    notifyPush: z.boolean().optional(),
    /** Honeypot: hidden from people, filled in by bots. */
    website: z.string().max(500,).optional(),
},) satisfies z.ZodType<EventsSubscribeBody>;

/** A filled honeypot: answer as if it worked, do nothing. */
const isBot = (body: { website?: string; },): boolean => Boolean(body.website?.trim(),);

const pushBody = z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string().min(1,), auth: z.string().min(1,), },),
    email: z.string().email().optional(),
},);

const allEventsRoutes = [
    // ─── Settings (declared BEFORE /:idOrSlug so it isn't swallowed) ───
    defineRoute({
        method: 'get',
        path: '/settings',
        auth: 'optional',
        summary: 'Events settings (notification toggles + VAPID public key; admins also get the email sender).',
        handler: async ({ user, },) => {
            const pub = await events.getPublicSettings();
            if (!user || !isAdminRole(user.role,)) return pub;
            const full = await events.getSettings();
            return { ...pub, fromName: full.fromName ?? '', fromAddress: full.fromAddress ?? '', };
        },
    },),

    defineRoute({
        method: 'put',
        path: '/settings',
        auth: 'admin',
        summary: 'Update the events module settings.',
        input: {
            body: z.object({
                notifyOnPublish: z.boolean().optional(),
                reminderHoursBefore: z.number().int().min(0,).max(720,).optional(),
                vapidPublicKey: z.string().optional(),
                eventsUrl: z.string().max(64,).optional(),
                allowRegistration: z.boolean().optional(),
                allowTicketing: z.boolean().optional(),
                fromName: z.string().trim().max(200,).optional(),
                fromAddress: z.union([z.string().trim().email(), z.literal('',),],).optional(),
                viewAccess: z.enum(['public', 'members', 'tier',],).optional(),
                viewMinTierId: z.string().uuid().nullable().optional(),
                registerAccess: z.enum(['public', 'members', 'tier',],).optional(),
                registerMinTierId: z.string().uuid().nullable().optional(),
            },),
        },
        handler: ({ body, audit, },) => events.updateSettings(body, audit(),),
    },),

    // ─── Subscriptions ───
    defineRoute({
        method: 'post',
        path: '/subscribe',
        auth: 'optional',
        summary: 'Subscribe to one event, or to all events when eventId is omitted.',
        input: { body: subscribeBody, },
        handler: async ({ body, user, req, },) => {
            const email = user?.email ?? body.email;
            if (isBot(body,)) return { subscriber: null, pendingConfirmation: !user, };
            await events.checkPublicWriteRate('subscribe', { ip: req.ip, email, signedIn: Boolean(user,), },);
            const { website: _w, ...rest } = body;
            const subscriber = await events.subscribe({ ...rest, email, userId: user?.id, },);
            return { subscriber, pendingConfirmation: subscriber.pendingConfirmation, };
        },
    },),

    defineRoute({
        method: 'get',
        path: '/subscribe/confirm/:token',
        auth: 'public',
        raw: true,
        summary: 'Confirm an event-notification subscription (the double opt-in link); redirects to the calendar.',
        input: { params: z.object({ token: z.string().min(10,).max(200,), },), },
        handler: async ({ params, res, },) => {
            const ok = await events.confirmSubscription(params.token,);
            const { eventsUrl, } = await events.getPublicSettings();
            res.redirect(302, `${eventsUrl || '/events'}?subscribed=${ok ? '1' : 'invalid'}`,);
        },
    },),

    defineRoute({
        method: 'post',
        path: '/unsubscribe',
        auth: 'public',
        summary: 'Unsubscribe using the token from a notification email.',
        input: { body: z.object({ token: z.string().min(1,), },) satisfies z.ZodType<EventsUnsubscribeBody>, },
        handler: async ({ body, },) => ({ unsubscribed: await events.unsubscribe(body.token,), }),
    },),

    defineRoute({
        method: 'post',
        path: '/push/subscribe',
        auth: 'optional',
        summary: 'Register a browser Web Push endpoint for desktop notifications.',
        input: { body: pushBody, },
        handler: ({ body, user, req, },) =>
            events.registerPushEndpoint({
                endpoint: body.endpoint,
                p256dh: body.keys.p256dh,
                auth: body.keys.auth,
                // A signed-in visitor's own address wins, as on every other route.
                email: user?.email ?? body.email,
                userId: user?.id,
                userAgent: req.headers['user-agent'],
            },),
    },),

    // ─── Calendar (occurrence-expanded) ───
    // Declared before /:idOrSlug so the literal path isn't swallowed by it.
    defineRoute({
        method: 'get',
        path: '/calendar',
        auth: 'optional',
        summary: 'Occurrences in a date window, with recurring series expanded.',
        input: {
            query: z.object({
                from: isoDate,
                to: isoDate,
                search: z.string().max(200,).optional(),
            },),
        },
        handler: async ({ query, user, },) => {
            const admin = await staffView(user,);
            return events.listOccurrences({ ...query, admin, viewer: user ?? null, },);
        },
    },),

    // ─── Ticket tiers ───
    defineRoute({
        method: 'get',
        path: '/:id/tiers',
        auth: 'optional',
        summary: 'Ticket tiers for an occurrence, with sold/remaining counts.',
        input: {
            params: z.object({ id: z.string().uuid(), },),
            query: z.object({ occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/,), },),
        },
        handler: ({ params, query, user, },) => events.listTiers(params.id, query.occurrenceDate, user ?? null,),
    },),

    defineRoute({
        method: 'put',
        path: '/:id/tiers',
        auth: 'staff',
        summary: "Replace an event's ticket tiers.",
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
                    // Only subscribers of this tier (or higher) may buy this ticket type.
                    requiredTierId: z.string().uuid().nullable().optional(),
                    // Most of this ticket type one buyer may hold per date (null = no cap).
                    maxPerOrder: z.number().int().min(1,).max(1000,).nullable().optional(),
                    // Optional plain-text blurb under the tier name (omitted = keep the stored one).
                    description: z.string().max(500,).nullable().optional(),
                },),),
            },),
        },
        handler: ({ params, body, audit, },) => events.replaceTiers(params.id, body.tiers, audit(),),
    },),

    // ─── Per-date exceptions ───
    defineRoute({
        method: 'put',
        path: '/:id/occurrences/:date',
        auth: 'staff',
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

    // ─── Attendee registration ───
    defineRoute({
        method: 'post',
        path: '/:id/register',
        auth: 'optional',
        summary: 'Register an attendee for an occurrence of this event.',
        input: {
            params: z.object({ id: z.string().min(1,), },),
            body: z.object({
                email: z.string().email(),
                name: z.string().max(255,).optional(),
                phone: z.string().max(255,).optional(),
                occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/,).optional(),
                fields: z.record(z.string(), z.unknown(),).optional(),
                /** Honeypot. */
                website: z.string().max(500,).optional(),
            },),
        },
        handler: async ({ params, body: rawBody, user, req, },) => {
            const { website, ...body } = rawBody;
            if (website?.trim()) throw new ValidationError('Could not register.',);
            await events.checkPublicWriteRate('register', { ip: req.ip, email: user?.email || body.email, signedIn: Boolean(user,), },);
            return {
            registration: await events.register({
                eventId: params.id,
                ...body,
                // A signed-in attendee registers as THEMSELVES. The form shows
                // their account email as a label, and the server does not take
                // the client's word for it.
                email: user?.email || body.email,
                userId: user?.id,
                viewer: user ?? null,
            },),
            };
        },
    },),

    defineRoute({
        method: 'get',
        path: '/:id/my-registration',
        auth: 'user',
        summary: "The signed-in viewer's own registration for an occurrence (null = not registered).",
        input: {
            params: z.object({ id: z.string().min(1,), },),
            query: z.object({ occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/,).optional(), },),
        },
        handler: async ({ params, query: q, user, },) => ({
            registration: await events.getMyRegistration(params.id, { id: user!.id, email: user!.email, }, q.occurrenceDate,),
        }),
    },),

    defineRoute({
        method: 'post',
        path: '/:id/unregister',
        auth: 'user',
        summary: "Cancel the signed-in viewer's own FREE registration (paid / checked-in tickets refuse).",
        input: {
            params: z.object({ id: z.string().min(1,), },),
            body: z.object({ occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/,).optional(), },),
        },
        handler: async ({ params, body, user, },) => {
            await events.unregisterMine(params.id, { id: user!.id, email: user!.email, }, body.occurrenceDate,);
            return { ok: true as const, };
        },
    },),

    defineRoute({
        method: 'get',
        path: '/:id/registrations',
        auth: 'staff',
        summary: 'Paged attendee list for an occurrence.',
        input: {
            params: z.object({ id: z.string().uuid(), },),
            query: z.object({
                occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/,),
                page: z.coerce.number().int().min(1,).optional(),
                limit: z.coerce.number().int().min(1,).max(200,).optional(),
            },),
        },
        handler: async ({ params, query, },) => {
            const { data, total, } = await events.listRegistrations(
                params.id,
                query.occurrenceDate,
                query,
            );
            return reply(data, {
                meta: {
                    page: query.page ?? 1,
                    limit: query.limit ?? 50,
                    total,
                    totalPages: Math.ceil(total / (query.limit ?? 50),),
                },
            },);
        },
    },),

    defineRoute({
        method: 'get',
        path: '/:id/registrations/export',
        auth: 'staff',
        raw: true,
        summary: 'Export one occurrence\'s registrants with ticket codes (CSV, or ?format=print for a door list).',
        input: {
            params: z.object({ id: z.string().uuid(), },),
            query: z.object({
                occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/,),
                format: z.enum(['csv', 'print',],).default('csv',),
                columns: z.enum(['all', 'basic',],).optional(),
            },),
        },
        handler: async ({ params, query, res, user, },) => {
            await gate(user as never, 'data:export',);
            const ds = await events.registrantsDataset(params.id, query.occurrenceDate,);
            if (query.format === 'csv') return sendCsv(res, ds,);
            const site = await getSitePublicSettings().catch(() => ({ siteName: '', }),);
            sendPrint(res, ds, { siteName: site.siteName ?? '', allColumns: query.columns === 'all', },);
        },
    },),

    defineRoute({
        method: 'put',
        path: '/tickets/:code/check-in',
        auth: 'staff',
        summary: 'Check a ticket in at the door, or undo it (`{ checkedIn: false }`).',
        input: {
            params: z.object({ code: z.string().min(4,).max(32,), },),
            body: z.object({ checkedIn: z.boolean(), },),
        },
        handler: ({ params, body, },) => events.setTicketCheckIn(params.code, body.checkedIn,),
    },),

    // ─── Ticket view ───
    defineRoute({
        method: 'get',
        path: '/tickets/:code',
        auth: 'optional',
        summary:
            'One ticket and the registration it belongs to. The code is the credential; contact details are masked for anyone but the attendee or staff.',
        input: { params: z.object({ code: z.string().min(4,).max(32,), },), },
        handler: ({ params, user, },) => events.getTicketView(params.code, user,),
    },),

    // ─── Ticket purchase ───
    defineRoute({
        method: 'post',
        path: '/tickets/purchase',
        auth: 'optional',
        summary: 'Buy tickets. Free orders confirm immediately; paid ones return a total for payment.',
        input: {
            body: z.object({
                email: z.string().email(),
                name: z.string().max(255,).optional(),
                phone: z.string().max(255,).optional(),
                // The event's other requested details (organization, notes) —
                // a ticket buyer is an attendee and is asked the same things.
                fields: z.record(z.string(), z.unknown(),).optional(),
                lines: z.array(z.object({
                    kind: z.literal('event_ticket',).optional(),
                    eventId: z.string().uuid(),
                    occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/,),
                    tierId: z.string().uuid(),
                    quantity: z.number().int().min(1,).max(50,),
                    // Sent for display only; the server re-reads both from the DB.
                    name: z.string().optional(),
                    priceCents: z.number().optional(),
                    currency: z.string().optional(),
                },),).min(1,),
            },),
        },
        handler: async ({ body, user, req, },) => {
            await events.checkPublicWriteRate('tickets', { ip: req.ip, email: user?.email || body.email, signedIn: Boolean(user,), },);
            return events.purchaseTickets({
                lines: body.lines as never,
                email: user?.email || body.email,
                name: body.name,
                phone: body.phone,
                fields: body.fields,
                userId: user?.id,
                viewer: user ?? null,
            },);
        },
    },),

    // ─── Reads ───
    defineRoute({
        method: 'get',
        path: '/',
        auth: 'optional',
        summary: 'List events in a date range. Anonymous callers see published only.',
        input: { query: listQuery, },
        handler: async ({ query, user, },) => {
            const admin = await staffView(user,);
            const { data, meta, } = await events.list({ ...query, admin, viewer: user ?? null, },);
            return reply(data, { meta, },);
        },
    },),

    defineRoute({
        method: 'get',
        path: '/:idOrSlug',
        auth: 'optional',
        summary: 'A single event by id or slug.',
        input: { params: z.object({ idOrSlug: z.string().min(1,), },), },
        handler: async ({ params, user, },) => events.getByIdOrSlug(params.idOrSlug, { admin: await staffView(user,), viewer: user ?? null, },),
    },),

    // ─── Writes (staff) ───
    defineRoute({
        method: 'post',
        path: '/',
        auth: 'staff',
        summary: 'Create an event.',
        input: { body: eventBody, },
        handler: async ({ body, audit, },) => reply(await events.create(body, audit(),), { status: 201, },),
    },),

    defineRoute({
        method: 'put',
        path: '/:id',
        auth: 'staff',
        summary: 'Update an event.',
        input: { params: z.object({ id: z.string().uuid(), },), body: eventBody.partial(), },
        handler: ({ params, body, audit, },) => events.update(params.id, body, audit(),),
    },),

    defineRoute({
        method: 'delete',
        path: '/:id',
        auth: 'staff',
        summary: 'Delete an event.',
        input: { params: z.object({ id: z.string().uuid(), },), },
        handler: async ({ params, audit, },) => {
            await events.remove(params.id, audit(),);
            return { deleted: true, };
        },
    },),
];

export const eventsRoutes = withPermissions(allEventsRoutes, EVENT_ROUTE_PERMISSIONS,);
