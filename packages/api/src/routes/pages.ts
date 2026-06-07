import { z, } from 'zod';
import type {
    AssertCompatible,
    PageBlockBody,
    PageCreateBody,
    PageListQuery,
    PageReorderBlocksBody,
} from '@rw/cms-shared';
import { defineRoute, reply, } from '../api/defineRoute';
import { isAdminRole, } from '../api/roles';
import { NotFoundError, } from '../core/errors';
import * as pages from '../services/pages';

// ─── Schemas ──────────────────────────────────────────────────────

const pageSchema = z.object({
    slug: z.string().min(1,).max(255,).regex(/^[a-z0-9-]+$/,),
    title: z.string().min(1,).max(255,),
    titleAlignment: z.enum(['left', 'center', 'right',],).optional(),
    description: z.string().optional(),
    metaTitle: z.string().max(255,).optional(),
    metaDescription: z.string().optional(),
    metaKeywords: z.array(z.string(),).optional(),
    ogImage: z.string().url().optional(),
    status: z.enum(['draft', 'published', 'scheduled', 'archived', 'deleted',],).optional(),
    publishAt: z.string().datetime().nullable().optional(),
    isHomepage: z.boolean().optional(),
    showTitle: z.boolean().optional(),
    showInNav: z.boolean().optional(),
    navOrder: z.number().int().optional(),
    isPrivate: z.boolean().optional(),
    accessLevel: z.enum(['public', 'member', 'patron',],).optional(),
},) satisfies z.ZodType<PageCreateBody>;

const blockSchema = z.object({
    /** Optional client-supplied UUID. When present, used as the row's
     *  primary key — lets the editor reference a parent before the
     *  parent's create response returns. Must be a v4-shaped UUID. */
    id: z.string().uuid().optional(),
    /** Parent block id; null/undefined for top-level blocks. */
    parentBlockId: z.string().uuid().nullable().optional(),
    type: z.enum([
        'rich_text', 'text', 'post', 'post_list', 'form', 'image', 'video', 'gallery',
        'social', 'campaign', 'hero', 'html',
        'document', 'url_link', 'carousel', 'spacer',
        'group', 'group_item',
    ],),
    title: z.string().max(255,).optional(),
    content: z.string().optional(),
    settings: z.record(z.unknown(),).optional(),
    order: z.number().int().optional(),
    isVisible: z.boolean().optional(),
    style: z.record(z.unknown(),).nullable().optional(),
},) satisfies z.ZodType<PageBlockBody>;

const reorderBlocksBody = z.object({
    blockIds: z.array(z.string(),),
    parentBlockId: z.string().nullable().optional(),
},) satisfies z.ZodType<PageReorderBlocksBody>;

const listQuery = z.object({
    status: z.string().optional(),
    search: z.string().optional(),
    sort: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(20,),
},);

const idParams = z.object({ id: z.string(), },);
const versionParams = z.object({ id: z.string(), version: z.coerce.number().int(), },);

// Query schema coerces (string → number), so assert z.infer compatibility.
type _AssertPageListQuery = AssertCompatible<z.infer<typeof listQuery>, PageListQuery>;

// ─── Routes ───────────────────────────────────────────────────────
// Literal paths (/navigation, /homepage, /slug/:slug, /bulk) and the
// /:id/* + /:pageId/blocks/* groups declared before the /:id catch-all.

export const pagesRoutes = [

    // Navigation (public, cached).
    defineRoute({
        method: 'get', path: '/navigation', auth: 'public',
        summary: 'Main navigation tree.',
        handler: () => pages.getNavigationCached(),
    },),

    // Homepage (public, cached).
    defineRoute({
        method: 'get', path: '/homepage', auth: 'public',
        summary: 'The page flagged as homepage (with blocks).',
        handler: async () => {
            const page = await pages.getHomepageCached();
            if (!page) throw new NotFoundError('No homepage configured',);
            return page;
        },
    },),

    // Public slug fetch (optional auth, access-gated).
    defineRoute({
        method: 'get', path: '/slug/:slug', auth: 'optional',
        summary: 'Fetch a page by slug. Gated content yields CONTENT_LOCKED with a preview in error.details.',
        input: {
            params: z.object({ slug: z.string(), },),
            query: z.object({ preview: z.string().optional(), },),
        },
        handler: ({ params, query, user, },) => {
            const adminPreview = query.preview === 'admin' && isAdminRole(user?.role,);
            return pages.getPublicBySlug(params.slug, user, adminPreview,);
        },
    },),

    // Admin list.
    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List pages (any status) with filters.',
        input: { query: listQuery, },
        handler: async ({ query, },) => {
            const result = await pages.list(
                { status: query.status, search: query.search, sort: query.sort, },
                { page: query.page, limit: query.limit, },
            );
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    // Bulk actions (admin).
    defineRoute({
        method: 'post', path: '/bulk', auth: 'admin',
        summary: 'Bulk status change / soft-delete by id list.',
        handler: ({ body, },) => pages.bulk(body,),
    },),

    // Revisions (admin).
    defineRoute({
        method: 'get', path: '/:id/revisions', auth: 'admin',
        summary: 'List a page\'s saved revisions.',
        input: { params: idParams, },
        handler: ({ params, },) => pages.listRevisions(params.id,),
    },),

    defineRoute({
        method: 'get', path: '/:id/revisions/:version', auth: 'admin',
        summary: 'Fetch one revision snapshot.',
        input: { params: versionParams, },
        handler: ({ params, },) => pages.getRevision(params.id, params.version,),
    },),

    defineRoute({
        method: 'post', path: '/:id/revisions/:version/restore', auth: 'admin',
        summary: 'Restore a revision (snapshots current state first).',
        input: { params: versionParams, },
        handler: ({ params, audit, },) => pages.restoreRevision(params.id, params.version, audit(),),
    },),

    // Block routes (admin). Declared before /:id so the more specific
    // /:pageId/blocks paths match first.
    defineRoute({
        method: 'post', path: '/:pageId/blocks', auth: 'admin',
        summary: 'Create a page block.',
        input: { params: z.object({ pageId: z.string(), },), body: blockSchema, },
        handler: async ({ params, body, audit, },) => {
            const block = await pages.createBlock(params.pageId, body, audit(),);
            return reply(block, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/:pageId/blocks/reorder', auth: 'admin',
        summary: 'Reorder a page\'s blocks within one parent.',
        input: {
            params: z.object({ pageId: z.string(), },),
            body: reorderBlocksBody,
        },
        handler: async ({ params, body, audit, },) => {
            await pages.reorderBlocks(params.pageId, body.parentBlockId ?? null, body.blockIds, audit(),);
            return { message: 'Blocks reordered', };
        },
    },),

    defineRoute({
        method: 'put', path: '/:pageId/blocks/:blockId', auth: 'admin',
        summary: 'Update a page block.',
        input: { params: z.object({ pageId: z.string(), blockId: z.string(), },), body: blockSchema.partial(), },
        handler: ({ params, body, audit, },) => pages.updateBlock(params.pageId, params.blockId, body, audit(),),
    },),

    defineRoute({
        method: 'delete', path: '/:pageId/blocks/:blockId', auth: 'admin',
        summary: 'Delete a page block.',
        input: { params: z.object({ pageId: z.string(), blockId: z.string(), },), },
        handler: async ({ params, audit, },) => {
            await pages.removeBlock(params.pageId, params.blockId, audit(),);
            return { message: 'Block deleted', };
        },
    },),

    // Admin fetch by id (with blocks).
    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'Fetch a page by id (any status, with blocks).',
        input: { params: idParams, },
        handler: async ({ params, },) => {
            const page = await pages.getByIdWithBlocks(params.id,);
            if (!page) throw new NotFoundError('Page',);
            return page;
        },
    },),

    // Create (admin).
    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a page.',
        input: { body: pageSchema, },
        handler: async ({ body, audit, },) => {
            const page = await pages.create(body, audit(),);
            return reply(page, { status: 201, },);
        },
    },),

    // Update (admin). Snapshots a revision first.
    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: 'Update a page. Snapshots a revision first.',
        input: { params: idParams, body: pageSchema.partial(), },
        handler: ({ params, body, audit, },) => pages.update(params.id, body, audit(),),
    },),

    // Delete (admin).
    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a page.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await pages.remove(params.id, audit(),);
            return { message: 'Page deleted', };
        },
    },),
];
