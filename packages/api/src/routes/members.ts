/**
 * /api/v1/members — public member pages. Core (no feature gate): the profile
 * card always exists; the comments list 404s when the discussions engine is off.
 */
import { z, } from 'zod';
import type { AssertCompatible, MembersCommentsQuery, } from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import * as members from '../services/members';

const handleParams = z.object({ handle: z.string().min(1,).max(40,), },);
const commentsQuery = z.object({
    page: z.coerce.number().int().min(1,).optional(),
    limit: z.coerce.number().int().min(1,).max(50,).optional(),
},);
type _CommentsQuery = AssertCompatible<z.infer<typeof commentsQuery>, MembersCommentsQuery>;

const viewerOf = (user: { id?: string; role?: string; } | undefined,) => ({ id: user?.id ?? null, role: user?.role ?? null, });

export const membersRoutes = [
    defineRoute({
        method: 'get', path: '/:handle', auth: 'optional',
        summary: 'A member\'s public profile (404 when unknown or hidden).',
        input: { params: handleParams, },
        handler: ({ params, user, },) => members.profile(params.handle, viewerOf(user,),),
    },),

    defineRoute({
        method: 'get', path: '/:handle/comments', auth: 'optional',
        summary: 'A member\'s visible comments and forum posts across the site, newest first (gated items left out).',
        input: { params: handleParams, query: commentsQuery, },
        handler: async ({ params, query, user, },) => {
            const r = await members.comments(params.handle, viewerOf(user,), query,);
            return reply(r.items, { meta: { page: r.page, limit: r.limit, total: r.total, totalPages: Math.ceil(r.total / r.limit,), }, },);
        },
    },),
];
