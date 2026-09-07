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
import * as permissions from '../services/permissions';

/**
 * Writing a component's SCRIPT is gated separately from editing its blocks.
 * Blocks are content; a script is arbitrary code that runs in every visitor's
 * browser, so it gets its own permission rather than riding on "is an admin".
 */
const SCRIPT_PERMISSION = 'components:script';

async function assertMayWriteScript(
    body: { script?: unknown; scriptEnabled?: unknown; },
    user: { id?: string; role?: string; } | undefined,
): Promise<void> {
    if (body.script === undefined && body.scriptEnabled === undefined) return;
    await permissions.requirePermission({ id: user?.id, role: user?.role, }, SCRIPT_PERMISSION,);
}

const idParam = z.object({ id: z.string(), },);

const createSchema = z.object({
    name: z.string().min(1,).max(200,),
    description: z.string().max(2000,).optional(),
    mode: z.enum(['single', 'list',],).optional(),
    maxRecords: z.number().int().min(1,).max(100,).nullish(),
    // 256 KB is far more than a component needs and still bounds the row.
    script: z.string().max(262144,).nullish(),
    scriptEnabled: z.boolean().optional(),
},);
const updateSchema = createSchema.partial();

// Mirrors `templateBlockSchema` in routes/entities.ts — the same table, so the
// same shape. Note `blockType`/`position`, NOT `type`/`order`: content-block
// template rows are not page blocks and have no content column.
const blockSchema = z.object({
    id: z.string().optional(),
    parentBlockId: z.string().nullable().optional(),
    blockType: z.string(),
    position: z.number().int(),
    settings: z.record(z.string(), z.unknown(),).optional(),
    style: z.record(z.string(), z.unknown(),).optional(),
},);
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

    /**
     * The component's client module, served same-origin.
     *
     * This is what keeps CSP at `script-src 'self'`: an inline <script> (and an
     * inline onclick) is blocked outright, but a real same-origin module is not.
     * Public because the public site loads it — the CODE is admin-authored, and
     * it is already running in every visitor's browser by design.
     *
     * Always 200s with valid JS. A 404 for "no script" would make the block's
     * dynamic import throw and log a console error on a perfectly healthy page,
     * so an absent or disabled script returns an empty module instead.
     */
    defineRoute({
        method: 'get', path: '/templates/:id/client.js', auth: 'public', raw: true,
        summary: 'Serve a component\'s browser ES module (same-origin).',
        input: { params: idParam, },
        handler: async ({ params, res, },) => {
            const template = await cbtSvc.findById(params.id,);
            res.type('application/javascript',);
            // Private: the module is per-component and cheap to rebuild; a shared
            // cache would serve a stale script after an edit.
            res.set('Cache-Control', 'no-cache',);
            if (!template || !template.script || template.scriptEnabled === false) {
                res.send('export function mount() {}\n',);
                return;
            }
            res.send(template.script,);
        },
    },),

    defineRoute({
        method: 'post', path: '/templates', auth: 'admin',
        summary: 'Create a global block template',
        input: { body: createSchema, },
        handler: async ({ body, user, },) => {
            await assertMayWriteScript(body, user,);
            // entityTypeKey stays null — that IS what makes it global.
            return reply(await cbtSvc.create({ ...body, entityTypeKey: null, },), { status: 201, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/templates/:id', auth: 'admin',
        summary: 'Update a global block template',
        input: { params: idParam, body: updateSchema, },
        handler: async ({ params, body, user, },) => {
            await assertMayWriteScript(body, user,);
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
            await cbtSvc.replaceBlocks(params.id, body.blocks,);
            return { saved: true, };
        },
    },),
];
