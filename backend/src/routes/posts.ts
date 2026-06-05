import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import { isAdminRole, } from '../api/roles';
import { NotFoundError, } from '../core/errors';
import * as posts from '../services/posts';

// ─── Schemas ──────────────────────────────────────────────────────

const contentBlockSchema = z.object({
    id: z.string().optional(),
    type: z.enum([
        'text', 'rich_text', 'social', 'image', 'video',
        'document', 'url_link', 'hero', 'html', 'campaign', 'form', 'post', 'post_list',
        'gallery', 'carousel', 'spacer',
    ],),
    sort_order: z.number().int().min(0,),
    data: z.record(z.unknown(),).default({},),
},);

const postSchema = z.object({
    slug: z.string().min(1,).max(255,).regex(/^[a-z0-9-]+$/,),
    title: z.string().min(1,).max(255,),
    excerpt: z.string().optional(),
    content: z.string().optional().default('',),
    featuredImage: z.string().url().optional(),
    status: z.enum(['draft', 'published', 'scheduled', 'archived', 'deleted',],).optional(),
    publishAt: z.string().datetime().nullable().optional(),
    isPrivate: z.boolean().optional(),
    accessLevel: z.enum(['public', 'member', 'patron',],).optional(),
    tags: z.array(z.string(),).optional(),
    categories: z.array(z.string(),).optional(),
    metaTitle: z.string().max(255,).optional(),
    metaDescription: z.string().optional(),
    publishedAt: z.string().datetime().optional(),
    contentBlocks: z.array(contentBlockSchema,).optional(),
},);

const idParams = z.object({ id: z.string(), },);

const listQuery = z.object({
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(10,),
    tag: z.string().optional(),
    category: z.string().optional(),
    search: z.string().optional(),
    before: z.string().optional(),
    after: z.string().optional(),
    ids: z.string().optional(),
    withBlocks: z.string().optional(),
    status: z.string().optional(),
    sort: z.string().optional(),
},);

// ─── Routes ───────────────────────────────────────────────────────
// Order matters: literal paths (/search, /slug/:slug, /bulk) must be
// declared before the /:id catch-all.

export const postsRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'optional',
        summary: 'List posts. Public gate by default; admins passing status/sort get the all-statuses listing.',
        input: { query: listQuery, },
        handler: async ({ user, query, apiKey, },) => {
            // API keys are admin-equivalent for response shaping (any
            // active key has at least read scope; drafts are admin reads).
            const isAdmin = isAdminRole(user?.role,) || Boolean(apiKey,);

            // Admin view is explicit: only when an admin sends status or
            // sort. An admin browsing the public site sends neither and
            // gets the public gate like everyone else.
            if (isAdmin && (query.status !== undefined || query.sort !== undefined)) {
                const status = query.status && query.status !== 'all' ? query.status : undefined;
                const result = await posts.list(
                    { status, search: query.search, sort: query.sort, },
                    { page: query.page, limit: query.limit, },
                );
                return reply(result.data, { meta: result.meta, },);
            }

            const idList = query.ids?.trim() ?
                query.ids.split(',',).map((s,) => s.trim(),).filter(Boolean,) :
                undefined;

            const result = await posts.listPublicCached({
                filters: {
                    tag: query.tag,
                    category: query.category,
                    search: query.search,
                    publishedBefore: query.before,
                    publishedAfter: query.after,
                    ids: idList,
                    withContentBlocks: query.withBlocks === '1' || query.withBlocks === 'true',
                },
                pagination: { page: query.page, limit: query.limit, },
                anonymous: !user,
                isAdmin,
            },);
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/search', auth: 'public',
        summary: 'Full-text search over published posts.',
        input: {
            query: z.object({
                q: z.string().min(1,),
                page: z.coerce.number().int().min(1,).default(1,),
                limit: z.coerce.number().int().min(1,).max(100,).default(10,),
            },),
        },
        handler: async ({ query, },) => {
            const result = await posts.search(query.q, { page: query.page, limit: query.limit, },);
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/slug/:slug', auth: 'optional',
        summary: 'Fetch a post by slug. Gated content yields CONTENT_LOCKED with a preview in error.details.',
        input: {
            params: z.object({ slug: z.string(), },),
            query: z.object({ preview: z.string().optional(), },),
        },
        handler: ({ params, query, user, },) => {
            const adminPreview = query.preview === 'admin' && isAdminRole(user?.role,);
            return posts.getPublicBySlug(params.slug, user, adminPreview,);
        },
    },),

    defineRoute({
        method: 'post', path: '/bulk', auth: 'admin',
        summary: 'Bulk status change / soft-delete by id list.',
        handler: ({ body, },) => posts.bulk(body,),
    },),

    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'Fetch a post by id (any status).',
        input: { params: idParams, },
        handler: async ({ params, },) => {
            const post = await posts.getById(params.id,);
            if (!post) throw new NotFoundError('Post',);
            return post;
        },
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a post.',
        input: { body: postSchema, },
        handler: async ({ body, audit, },) => {
            const post = await posts.create(body, audit(),);
            return reply(post, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: 'Update a post. Snapshots a revision first.',
        input: { params: idParams, body: postSchema.partial(), },
        handler: ({ params, body, audit, },) => posts.update(params.id, body, audit(),),
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a post.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await posts.remove(params.id, audit(),);
            return { message: 'Post deleted', };
        },
    },),

    defineRoute({
        method: 'get', path: '/:id/revisions', auth: 'admin',
        summary: 'List a post\'s saved revisions.',
        input: { params: idParams, },
        handler: ({ params, },) => posts.listRevisions(params.id,),
    },),

    defineRoute({
        method: 'get', path: '/:id/revisions/:version', auth: 'admin',
        summary: 'Fetch one revision snapshot.',
        input: { params: z.object({ id: z.string(), version: z.coerce.number().int(), },), },
        handler: ({ params, },) => posts.getRevision(params.id, params.version,),
    },),

    defineRoute({
        method: 'post', path: '/:id/revisions/:version/restore', auth: 'admin',
        summary: 'Restore a revision (snapshots current state first).',
        input: { params: z.object({ id: z.string(), version: z.coerce.number().int(), },), },
        handler: ({ params, audit, },) => posts.restoreRevision(params.id, params.version, audit(),),
    },),

    defineRoute({
        method: 'put', path: '/:id/blocks/reorder', auth: 'admin',
        summary: 'Reorder a post\'s content blocks.',
        input: {
            params: idParams,
            body: z.object({ blockIds: z.array(z.string(),), },),
        },
        handler: async ({ params, body, },) => {
            await posts.reorderContentBlocks(params.id, body.blockIds,);
            return { message: 'Blocks reordered', };
        },
    },),
];
