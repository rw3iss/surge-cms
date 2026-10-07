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
import type {
    MailTemplateBlockInput,
    MailTemplateBlocksReplaceBody,
    MailTemplateCreateBody,
    MailTemplatePreviewBody,
} from '@sitesurge/types';
import { z, } from 'zod';
import { blockStyleRecord, } from '../api/blockStyleInput';
import { defineRoute, reply, } from '../api/defineRoute';
import { requireFeature, } from '../api/requireFeature';
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
    style: blockStyleRecord.optional(),
},) satisfies z.ZodType<MailTemplateBlockInput>;

const previewSchema = z.object({
    blocks: z.array(blockSchema,).optional(),
    subject: z.string().max(1000,).optional(),
    preheader: z.string().max(255,).optional(),
    variables: z.record(z.string(), z.string(),).optional(),
},) satisfies z.ZodType<MailTemplatePreviewBody>;

const versionParams = z.object({ id: z.string().uuid(), version: z.coerce.number().int(), },);
const idParams = z.object({ id: z.string(), },);

export const mailTemplatesRoutes = [
    defineRoute({
        method: 'get',
        path: '/variables',
        auth: 'admin',
        summary: 'Variable catalog for the template reference UI.',
        handler: () => mailTemplates.variables(),
    },),

    // Declared before `/:id` so "options" is never read as an id.
    defineRoute({
        method: 'get',
        path: '/options',
        auth: 'staff',
        pre: [requireFeature('mailing_lists',),],
        summary: 'Enabled mail templates by name — for any "choose an email template" control (e.g. replies).',
        handler: () => mailTemplates.options(),
    },),

    defineRoute({
        method: 'get',
        path: '/',
        auth: 'admin',
        summary: 'List all mail templates.',
        handler: () => mailTemplates.list(),
    },),

    defineRoute({
        method: 'post',
        path: '/',
        auth: 'admin',
        summary: 'Create a mail template.',
        input: { body: templateSchema, },
        handler: async ({ body, audit, },) => {
            const created = await mailTemplates.create(body, audit(),);
            return reply(created, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'post',
        path: '/preview',
        auth: 'admin',
        summary: 'Render preview HTML for an in-progress block set with variables resolved.',
        input: { body: previewSchema, },
        handler: ({ body, },) => mailTemplates.preview(body,),
    },),

    defineRoute({
        method: 'get',
        path: '/:id',
        auth: 'admin',
        summary: 'Fetch a template (meta + block tree).',
        input: { params: idParams, },
        handler: ({ params, },) => mailTemplates.getById(params.id,),
    },),

    defineRoute({
        method: 'put',
        path: '/:id',
        auth: 'admin',
        summary: 'Update template metadata.',
        input: { params: idParams, body: templateSchema.partial(), },
        handler: ({ params, body, audit, },) => mailTemplates.update(params.id, body, audit(),),
    },),

    defineRoute({
        method: 'delete',
        path: '/:id',
        auth: 'admin',
        summary: 'Delete a template.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await mailTemplates.remove(params.id, audit(),);
            return { ok: true, };
        },
    },),

    defineRoute({
        method: 'post',
        path: '/:id/copy',
        auth: 'admin',
        summary: 'Clone a template (meta + block tree) into a new template.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => reply(await mailTemplates.copy(params.id, audit(),), { status: 201, },),
    },),

    defineRoute({
        method: 'put',
        path: '/:id/blocks',
        auth: 'admin',
        summary: "Replace a template's whole block tree (transactional).",
        input: {
            params: idParams,
            body: z.object({ blocks: z.array(blockSchema,).default([],), },) satisfies z.ZodType<
                MailTemplateBlocksReplaceBody
            >,
        },
        handler: async ({ params, body, audit, },) => {
            const result = await mailTemplates.replaceBlocks(params.id, body.blocks, audit(),);
            return { ok: true, count: result.count, };
        },
    },),

    // ─── Revisions (full-tree history: meta + every block) ───
    defineRoute({
        method: 'get', path: '/:id/revisions', auth: 'admin',
        summary: "List a template's saved revisions.",
        input: { params: idParams, },
        handler: ({ params, },) => mailTemplates.listRevisions(params.id,),
    },),

    defineRoute({
        method: 'post', path: '/:id/revisions', auth: 'admin',
        summary: "Snapshot the template's current state as a revision.",
        input: { params: idParams, },
        handler: ({ params, audit, },) => mailTemplates.snapshotNow(params.id, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/:id/revisions/:version', auth: 'admin',
        summary: 'Fetch one template revision snapshot.',
        input: { params: versionParams, },
        handler: ({ params, },) => mailTemplates.getRevision(params.id, params.version,),
    },),

    defineRoute({
        method: 'post', path: '/:id/revisions/:version/restore', auth: 'admin',
        summary: 'Restore a template revision — its settings and whole block tree (snapshots current state first).',
        input: { params: versionParams, },
        handler: ({ params, audit, },) => mailTemplates.restoreRevision(params.id, params.version, audit(),),
    },),
];
