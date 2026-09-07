/**
 * Components — reusable block templates bound to no entity type.
 *
 * These are the SAME rows as the per-entity templates under
 * `/entities/:type/templates`; the only difference is `entity_type_key IS NULL`.
 * That column was already nullable and the service already accepted null, so
 * this module adds no storage — it exists because the entity routes take the
 * type from the URL and therefore can never express "no type".
 *
 * Reads are `optional` auth: the public site resolves a `template` block by
 * fetching the referenced template's blocks, exactly as it already does for an
 * `entity` block. Writes are admin-only.
 */
import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import * as cbtSvc from '../services/contentBlockTemplates';
import { NotFoundError, } from '../core/errors';

const idParam = z.object({ id: z.string(), },);

const createSchema = z.object({
    name: z.string().min(1,).max(200,),
    description: z.string().max(2000,).optional(),
    mode: z.enum(['single', 'list',],).optional(),
    maxRecords: z.number().int().min(1,).max(100,).nullish(),
},);
const updateSchema = createSchema.partial();

const blockSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
    z.object({
        id: z.string().optional(),
        parentBlockId: z.string().nullish(),
        type: z.string(),
        title: z.string().nullish(),
        content: z.string().nullish(),
        settings: z.record(z.string(), z.unknown(),).optional(),
        style: z.record(z.string(), z.unknown(),).nullish(),
        order: z.number().int().optional(),
        isVisible: z.boolean().optional(),
    },)
);
const blocksBody = z.object({ blocks: z.array(blockSchema,), },);

export const componentsRoutes = [
    defineRoute({
        method: 'get', path: '/templates', auth: 'optional',
        summary: 'List global (entity-less) block templates',
        handler: async () => cbtSvc.listGlobal(),
    },),

    defineRoute({
        method: 'get', path: '/templates/:id', auth: 'optional',
        summary: 'Get a global block template + its blocks',
        input: { params: idParam, },
        handler: async ({ params, },) => {
            const template = await cbtSvc.findById(params.id,);
            if (!template) throw new NotFoundError(`Block template "${params.id}"`,);
            return { ...template, blocks: await cbtSvc.findBlocksResolved(params.id,), };
        },
    },),

    defineRoute({
        method: 'post', path: '/templates', auth: 'admin',
        summary: 'Create a global block template',
        input: { body: createSchema, },
        handler: async ({ body, },) =>
            // entityTypeKey stays null — that IS what makes it global.
            reply(await cbtSvc.create({ ...body, entityTypeKey: null, },), { status: 201, },),
    },),

    defineRoute({
        method: 'put', path: '/templates/:id', auth: 'admin',
        summary: 'Update a global block template',
        input: { params: idParam, body: updateSchema, },
        handler: async ({ params, body, },) => {
            const template = await cbtSvc.update(params.id, body,);
            if (!template) throw new NotFoundError(`Block template "${params.id}"`,);
            return template;
        },
    },),

    defineRoute({
        method: 'delete', path: '/templates/:id', auth: 'admin',
        summary: 'Delete a global block template',
        input: { params: idParam, },
        handler: async ({ params, },) => {
            await cbtSvc.remove(params.id,);
            return { deleted: true, };
        },
    },),

    defineRoute({
        method: 'get', path: '/templates/:id/blocks', auth: 'optional',
        summary: 'Get a global template\'s resolved blocks',
        input: { params: idParam, },
        handler: async ({ params, },) => cbtSvc.findBlocksResolved(params.id,),
    },),

    defineRoute({
        method: 'put', path: '/templates/:id/blocks', auth: 'admin',
        summary: 'Replace a global template\'s blocks',
        input: { params: idParam, body: blocksBody, },
        handler: async ({ params, body, },) => {
            await cbtSvc.replaceBlocks(params.id, body.blocks as never,);
            return { saved: true, };
        },
    },),
];
