/**
 * Send wizard endpoints + job status / retry / cancel. All admin tier.
 *
 *   POST   /send                — create job + recipients, kick worker (202)
 *   GET    /jobs                — recent jobs
 *   GET    /jobs/:id            — job status snapshot
 *   GET    /jobs/:id/recipients — paginated recipient list
 *   POST   /jobs/:id/retry      — reset failed → pending, re-kick
 *   PATCH  /jobs/:id            — { status: 'cancelled' }
 *
 * Business logic lives in `services/mailSend.ts`.
 */
import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import * as mailSend from '../services/mailSend';

const blockSchema = z.object({
    id: z.string().uuid().optional(),
    parentBlockId: z.string().uuid().nullable().optional(),
    blockType: z.string().min(1,),
    position: z.number().int().min(0,),
    settings: z.record(z.string(), z.unknown(),).optional(),
    style: z.record(z.string(), z.unknown(),).optional(),
},);

const sendSchema = z.object({
    listId: z.string().uuid(),
    templateId: z.string().uuid().nullable().optional(),
    /** Frontend tracks whether the operator edited any block / meta field
     *  after loading the chosen template; the detail page surfaces this
     *  as a "(custom)" suffix on the template name. */
    templateWasModified: z.boolean().optional(),
    subject: z.string().min(1,).max(1000,),
    preheader: z.string().max(255,).optional(),
    fromName: z.string().max(255,).optional(),
    fromEmail: z.string().email().optional(),
    replyTo: z.string().email().optional(),
    blocks: z.array(blockSchema,),
},);

const jobsQuery = z.object({
    limit: z.coerce.number().int().min(1,).optional(),
    offset: z.coerce.number().int().min(0,).optional(),
},);

const recipientsQuery = z.object({
    limit: z.coerce.number().int().min(1,).optional(),
    offset: z.coerce.number().int().min(0,).optional(),
    status: z.string().optional(),
},);

const idParams = z.object({ id: z.string(), },);
const patchSchema = z.object({ status: z.enum(['cancelled',],), },);

export const mailSendRoutes = [

    defineRoute({
        method: 'post', path: '/send', auth: 'admin',
        summary: 'Create a send job + recipients and kick the worker (returns 202).',
        input: { body: sendSchema, },
        handler: async ({ body, audit, },) => {
            const result = await mailSend.send(body, audit(),);
            return reply(result, { status: 202, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/jobs', auth: 'admin',
        summary: 'List recent send jobs.',
        input: { query: jobsQuery, },
        handler: ({ query, },) => mailSend.listJobs(query.limit, query.offset,),
    },),

    defineRoute({
        method: 'get', path: '/jobs/:id', auth: 'admin',
        summary: 'Fetch a send job status snapshot.',
        input: { params: idParams, },
        handler: ({ params, },) => mailSend.getJob(params.id,),
    },),

    defineRoute({
        method: 'get', path: '/jobs/:id/recipients', auth: 'admin',
        summary: 'Paginated recipient list for a job (optional status filter).',
        input: { params: idParams, query: recipientsQuery, },
        handler: ({ params, query, },) => mailSend.listRecipients(params.id, {
            limit: query.limit,
            offset: query.offset,
            status: query.status as Parameters<typeof mailSend.listRecipients>[1]['status'],
        },),
    },),

    defineRoute({
        method: 'post', path: '/jobs/:id/retry', auth: 'admin',
        summary: 'Reset failed recipients → pending and re-kick the worker.',
        input: { params: idParams, },
        handler: ({ params, audit, },) => mailSend.retry(params.id, audit(),),
    },),

    defineRoute({
        method: 'patch', path: '/jobs/:id', auth: 'admin',
        summary: 'Cancel a send job.',
        input: { params: idParams, body: patchSchema, },
        handler: async ({ params, body, audit, },) => {
            await mailSend.cancel(params.id, body.status, audit(),);
            return { ok: true, };
        },
    },),
];
