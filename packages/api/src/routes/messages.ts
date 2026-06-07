import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import { NotFoundError, } from '../core/errors';
import * as messages from '../services/messages';

// ─── Schemas ──────────────────────────────────────────────────────

const messageSchema = z.object({
    name: z.string().min(1,).max(255,),
    email: z.string().email(),
    subject: z.string().max(255,).optional(),
    message: z.string().min(1,).max(5000,),
},);

const updateStatusSchema = z.object({
    status: z.enum(['unread', 'read', 'replied', 'archived', 'spam',],),
},);

const listQuery = z.object({
    status: z.string().optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(50,),
},);

const idParams = z.object({ id: z.string(), },);

// ─── Routes ───────────────────────────────────────────────────────
// Literal paths (/bulk, /bulk-status, /bulk-delete) before /:id.

export const messagesRoutes = [

    // Submit contact message (public)
    defineRoute({
        method: 'post', path: '/', auth: 'optional',
        summary: 'Submit a contact message. Sanitizes input and notifies admins by email.',
        input: { body: messageSchema, },
        handler: async ({ body, req, userId, },) => {
            const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',',)[0] || req.ip!;
            await messages.submit({
                name: body.name,
                email: body.email,
                subject: body.subject,
                message: body.message,
                userId: userId || null,
                ipAddress,
                userAgent: req.headers['user-agent'],
            },);
            return reply({ message: 'Message sent successfully', }, { status: 201, },);
        },
    },),

    // List messages (admin)
    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List contact messages with optional status/search filters.',
        input: { query: listQuery, },
        handler: async ({ query, },) => {
            const result = await messages.list(
                { status: query.status, search: query.search, },
                { page: query.page, limit: query.limit, },
            );
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    // Unified bulk endpoint ({ ids, action, value })
    defineRoute({
        method: 'post', path: '/bulk', auth: 'admin',
        summary: 'Bulk status change / delete by id list.',
        handler: ({ body, },) => messages.bulk(body,),
    },),

    // Bulk update status (admin)
    defineRoute({
        method: 'post', path: '/bulk-status', auth: 'admin',
        summary: 'Bulk update message status.',
        input: {
            body: z.object({
                messageIds: z.array(z.string().uuid(),),
                status: z.enum(['unread', 'read', 'replied', 'archived', 'spam',],),
            },),
        },
        handler: async ({ body, audit, },) => {
            await messages.bulkUpdateStatus(body.messageIds, body.status, audit(),);
            return { message: `${body.messageIds.length} messages updated`, };
        },
    },),

    // Bulk delete (admin)
    defineRoute({
        method: 'post', path: '/bulk-delete', auth: 'admin',
        summary: 'Bulk delete messages by id list.',
        input: {
            body: z.object({ messageIds: z.array(z.string().uuid(),), },),
        },
        handler: async ({ body, audit, },) => {
            await messages.bulkRemove(body.messageIds, audit(),);
            return { message: `${body.messageIds.length} messages deleted`, };
        },
    },),

    // Get message by ID (admin)
    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'Fetch a message by id (marks unread → read).',
        input: { params: idParams, },
        handler: async ({ params, },) => {
            const message = await messages.getById(params.id,);
            if (!message) throw new NotFoundError('Message',);
            return message;
        },
    },),

    // Update message status (admin)
    defineRoute({
        method: 'put', path: '/:id/status', auth: 'admin',
        summary: 'Update a message\'s status.',
        input: { params: idParams, body: updateStatusSchema, },
        handler: ({ params, body, audit, },) => messages.updateStatus(params.id, body.status, audit(),),
    },),

    // Delete message (admin)
    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a message.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await messages.remove(params.id, audit(),);
            return { message: 'Message deleted', };
        },
    },),
];
