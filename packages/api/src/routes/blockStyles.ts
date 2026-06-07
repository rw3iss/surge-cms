import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import * as blockStyles from '../services/blockStyles';

const blockStyleSchema = z.object({
    name: z.string().min(1,).max(255,),
    isDefault: z.boolean().optional(),
    backgroundColor: z.string().nullable().optional(),
    textColor: z.string().nullable().optional(),
    textAlign: z.string().nullable().optional(),
    verticalAlign: z.string().nullable().optional(),
    fontSize: z.string().nullable().optional(),
    width: z.string().nullable().optional(),
    height: z.string().nullable().optional(),
    padding: z.string().nullable().optional(),
    margin: z.string().nullable().optional(),
    gap: z.string().nullable().optional(),
    overflowX: z.string().nullable().optional(),
    overflowY: z.string().nullable().optional(),
},);

const idParams = z.object({ id: z.string(), },);

export const blockStylesRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List all block-style templates (admin, cached).',
        handler: () => blockStyles.listAllCached(),
    },),

    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'Fetch a single block-style template.',
        input: { params: idParams, },
        handler: ({ params, },) => blockStyles.getById(params.id,),
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a block-style template.',
        input: { body: blockStyleSchema, },
        handler: async ({ body, audit, },) => {
            const style = await blockStyles.create(body, audit(),);
            return reply(style, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: 'Update a block-style template.',
        input: { params: idParams, body: blockStyleSchema.partial(), },
        handler: ({ params, body, audit, },) => blockStyles.update(params.id, body, audit(),),
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a block-style template.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await blockStyles.remove(params.id, audit(),);
            return { message: 'Block style deleted', };
        },
    },),
];
