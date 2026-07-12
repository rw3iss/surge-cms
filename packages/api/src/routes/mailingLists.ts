/**
 * Admin + public routes for mailing lists and subscribers.
 *
 * Mount point under /api/v1/mailing-lists (admin tier):
 *   GET    /                                     — list all
 *   POST   /                                     — create
 *   GET    /:id                                  — fetch one
 *   PUT    /:id                                  — update
 *   DELETE /:id                                  — remove
 *   GET    /:id/subscribers                      — paginated subscribers
 *   POST   /:id/subscribers                      — admin add (force confirmed)
 *   PUT    /:id/subscribers/:subId               — update subscriber
 *   DELETE /:id/subscribers/:subId               — remove one
 *   POST   /:id/subscribers/bulk-delete          — { ids }
 *   POST   /:id/subscribers/:subId/force-confirm — flip pending → subscribed
 *
 * Public sub-router mounted at /api/v1/lists (optional tier — email-only
 * subscribers, captures req.user when present):
 *   POST   /:slug/subscribe                      — { email, name?, phone?, customFields? }
 *
 * (Token-based unsubscribe lives in routes/unsubscribe.ts, mounted at
 * the public root.)
 *
 * Business logic lives in `services/mailingLists.ts`.
 */
import { z, } from 'zod';
import type {
    AssertCompatible,
    ListSubscribeBody,
    MailingListCreateBody,
    MailingListSubscriberCreateBody,
    MailingListSubscribersBulkDeleteBody,
    MailingListSubscribersQuery,
} from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import * as mailingLists from '../services/mailingLists';

const listSchema = z.object({
    slug: z.string().min(1,).max(64,).regex(/^[a-z0-9-]+$/,),
    name: z.string().min(1,).max(255,),
    description: z.string().optional(),
    isEnabled: z.boolean().optional(),
    registeredUsersOnly: z.boolean().optional(),
    doubleOptIn: z.boolean().optional(),
    defaultTemplateId: z.string().uuid().nullable().optional(),
},) satisfies z.ZodType<MailingListCreateBody>;

const subscriberAdminSchema = z.object({
    email: z.string().email(),
    name: z.string().optional(),
    phone: z.string().optional(),
    customFields: z.record(z.string(), z.unknown(),).optional(),
},) satisfies z.ZodType<MailingListSubscriberCreateBody>;

const subscribersQuery = z.object({
    limit: z.coerce.number().int().min(1,).optional(),
    offset: z.coerce.number().int().min(0,).optional(),
    search: z.string().optional(),
    status: z.string().optional(),
},);

// Query coerces (string → number), so assert z.infer compatibility.
type _AssertSubscribersQuery = AssertCompatible<z.infer<typeof subscribersQuery>, MailingListSubscribersQuery>;

const idParams = z.object({ id: z.string(), },);
const subIdParams = z.object({ id: z.string(), subId: z.string(), },);

export const mailingListsRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List all mailing lists.',
        handler: () => mailingLists.list(),
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a mailing list.',
        input: { body: listSchema, },
        handler: async ({ body, audit, },) => {
            const created = await mailingLists.create(body, audit(),);
            return reply(created, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'Fetch a mailing list.',
        input: { params: idParams, },
        handler: ({ params, },) => mailingLists.getById(params.id,),
    },),

    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: 'Update a mailing list.',
        input: { params: idParams, body: listSchema.partial(), },
        handler: ({ params, body, audit, },) => mailingLists.update(params.id, body, audit(),),
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a mailing list.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await mailingLists.remove(params.id, audit(),);
            return { ok: true, };
        },
    },),

    defineRoute({
        method: 'get', path: '/:id/subscribers', auth: 'admin',
        summary: 'Paginated subscriber list (optional search/status filters).',
        input: { params: idParams, query: subscribersQuery, },
        handler: ({ params, query, },) => mailingLists.listSubscribers(params.id, {
            limit: query.limit,
            offset: query.offset,
            search: query.search,
            status: query.status as Parameters<typeof mailingLists.listSubscribers>[1]['status'],
        },),
    },),

    defineRoute({
        method: 'post', path: '/:id/subscribers', auth: 'admin',
        summary: 'Add a subscriber (force confirmed). Idempotent: re-add reactivates.',
        input: { params: idParams, body: subscriberAdminSchema, },
        handler: async ({ params, body, },) => {
            const result = await mailingLists.addSubscriber(params.id, body,);
            return reply(result.subscriber, { status: result.created ? 201 : 200, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/:id/subscribers/:subId', auth: 'admin',
        summary: 'Update a subscriber.',
        input: { params: subIdParams, },
        handler: ({ params, body, },) => mailingLists.updateSubscriber(params.subId, body as Record<string, unknown>,),
    },),

    defineRoute({
        method: 'delete', path: '/:id/subscribers/:subId', auth: 'admin',
        summary: 'Remove a subscriber.',
        input: { params: subIdParams, },
        handler: async ({ params, },) => {
            await mailingLists.removeSubscriber(params.subId,);
            return { ok: true, };
        },
    },),

    defineRoute({
        method: 'post', path: '/:id/subscribers/bulk-delete', auth: 'admin',
        summary: 'Bulk-delete subscribers by id list.',
        input: {
            params: idParams,
            body: z.object({ ids: z.array(z.string(),).default([],), },) satisfies z.ZodType<MailingListSubscribersBulkDeleteBody>,
        },
        handler: ({ params, body, audit, },) => mailingLists.bulkRemoveSubscribers(params.id, body.ids, audit(),),
    },),

    defineRoute({
        method: 'post', path: '/:id/subscribers/:subId/force-confirm', auth: 'admin',
        summary: 'Flip a pending subscriber to subscribed.',
        input: { params: subIdParams, },
        handler: ({ params, },) => mailingLists.forceConfirmSubscriber(params.subId,),
    },),
];

// ─── Public subscribe sub-router ─────────────────────────────────────
// Mounted separately at /api/v1/lists so the URL shape is short and
// matches the unsubscribe URL pattern (/u/:token, /lists/:slug/confirm).
// Optional tier: anonymous email-only subscribers, captures req.user
// when a session is present (registered-users-only lists require it).

const subscribeSchema = z.object({
    email: z.string().email().optional(),
    name: z.string().optional(),
    phone: z.string().optional(),
    customFields: z.record(z.string(), z.unknown(),).optional(),
},) satisfies z.ZodType<ListSubscribeBody>;

export const listsPublicRoutes = [

    defineRoute({
        method: 'post', path: '/:slug/subscribe', auth: 'optional',
        summary: 'Public subscribe to a list by slug (double-opt-in aware).',
        input: { params: z.object({ slug: z.string(), },), body: subscribeSchema, },
        handler: ({ params, body, user, },) => mailingLists.publicSubscribe(params.slug, body, {
            userId: user?.id,
            userEmail: user?.email,
        },),
    },),
];
