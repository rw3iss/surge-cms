/**
 * Admin routes for mail templates + the preview endpoint that the
 * editor's iframe hits. All admin tier (API keys are admin-equivalent).
 *
 *   GET    /variables  — variable catalog for the reference UI
 *   GET    /           — list
 *   POST   /           — create
 *   GET    /:id        — template meta + blocks
 *   PUT    /:id        — update meta
 *   DELETE /:id        — remove
 *   PUT    /:id/blocks — replace block tree
 *   POST   /preview    — render preview HTML
 *
 * Business logic lives in `services/mailTemplates.ts`.
 */
import { z, } from 'zod';
import type {
    MailTemplateBlockInput,
    MailTemplateBlocksReplaceBody,
    MailTemplateCreateBody,
    MailTemplatePreviewBody,
} from '@rw/cms-shared';
import { defineRoute, reply, } from '../api/defineRoute';
import * as mailTemplates from '../services/mailTemplates';

const templateSchema = z.object({
    name: z.string().min(1,).max(255,),
    description: z.string().optional(),
    isEnabled: z.boolean().optional(),
    subject: z.string().max(1000,).optional(),
    preheader: z.string().max(255,).optional(),
    fromName: z.string().max(255,).optional(),
    fromEmail: z.string().email().or(z.literal('',),).optional(),
    replyTo: z.string().email().or(z.literal('',),).optional(),
},) satisfies z.ZodType<MailTemplateCreateBody>;

const blockSchema = z.object({
    id: z.string().uuid().optional(),
    parentBlockId: z.string().uuid().nullable().optional(),
    blockType: z.string().min(1,),
    position: z.number().int().min(0,),
    settings: z.record(z.string(), z.unknown(),).optional(),
    style: z.record(z.string(), z.unknown(),).optional(),
},) satisfies z.ZodType<MailTemplateBlockInput>;

const previewSchema = z.object({
    blocks: z.array(blockSchema,).optional(),
    subject: z.string().max(1000,).optional(),
    preheader: z.string().max(255,).optional(),
    variables: z.record(z.string(), z.string(),).optional(),
},) satisfies z.ZodType<MailTemplatePreviewBody>;

const idParams = z.object({ id: z.string(), },);

export const mailTemplatesRoutes = [

    defineRoute({
        method: 'get', path: '/variables', auth: 'admin',
        summary: 'Variable catalog for the template reference UI.',
        handler: () => mailTemplates.variables(),
    },),

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List all mail templates.',
        handler: () => mailTemplates.list(),
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a mail template.',
        input: { body: templateSchema, },
        handler: async ({ body, audit, },) => {
            const created = await mailTemplates.create(body, audit(),);
            return reply(created, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'post', path: '/preview', auth: 'admin',
        summary: 'Render preview HTML for an in-progress block set with variables resolved.',
        input: { body: previewSchema, },
        handler: ({ body, },) => mailTemplates.preview(body,),
    },),

    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'Fetch a template (meta + block tree).',
        input: { params: idParams, },
        handler: ({ params, },) => mailTemplates.getById(params.id,),
    },),

    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: 'Update template metadata.',
        input: { params: idParams, body: templateSchema.partial(), },
        handler: ({ params, body, audit, },) => mailTemplates.update(params.id, body, audit(),),
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a template.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await mailTemplates.remove(params.id, audit(),);
            return { ok: true, };
        },
    },),

    defineRoute({
        method: 'put', path: '/:id/blocks', auth: 'admin',
        summary: 'Replace a template\'s whole block tree (transactional).',
        input: {
            params: idParams,
            body: z.object({ blocks: z.array(blockSchema,).default([],), },) satisfies z.ZodType<MailTemplateBlocksReplaceBody>,
        },
        handler: async ({ params, body, },) => {
            const result = await mailTemplates.replaceBlocks(params.id, body.blocks,);
            return { ok: true, count: result.count, };
        },
    },),
];
