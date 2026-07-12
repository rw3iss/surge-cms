import { z, } from 'zod';
import type { AdminSearchQuery, AssertCompatible, SearchQuery, } from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import * as search from '../services/search';

const publicQuery = z.object({
    q: z.string().min(2, 'Search query must be at least 2 characters',),
    type: z.string().optional(),
    page: z.coerce.number().int().default(1,),
    limit: z.coerce.number().int().default(20,),
},);

const adminQuery = publicQuery.extend({
    limit: z.coerce.number().int().default(50,),
},);

// Queries coerce (string → number), so assert z.infer compatibility.
type _AssertSearchQuery = AssertCompatible<z.infer<typeof publicQuery>, SearchQuery>;
type _AssertAdminSearchQuery = AssertCompatible<z.infer<typeof adminQuery>, AdminSearchQuery>;

export const searchRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'public',
        summary: 'Global search over published, non-private content (posts, pages, campaigns).',
        input: { query: publicQuery, },
        handler: async ({ query, },) => {
            const { results, total, } = await search.publicSearch(query,);
            return reply(results, { meta: { page: query.page, limit: query.limit, total, }, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/admin', auth: 'admin',
        summary: 'Admin search across all content (posts, pages, users, campaigns, forms, messages), any status.',
        input: { query: adminQuery, },
        handler: async ({ query, },) => {
            const { results, total, } = await search.adminSearch(query,);
            return reply(results, { meta: { page: query.page, limit: query.limit, total, }, },);
        },
    },),
];
