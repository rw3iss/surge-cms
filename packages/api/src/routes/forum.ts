/**
 * /api/v1/forum — categories, threads, settings (feature `forum`). Replies
 * are read and written through /api/v1/discussions (`forum_thread:<id>`).
 */
import { z, } from 'zod';
import type {
    AssertCompatible, ForumCategoryBody, ForumFeedQuery, ForumSettingsBody, ForumThreadCreateBody, ForumThreadUpdateBody,
} from '@sitesurge/types';
import { MAX_FORUM_BLOCK_LIMIT, } from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import { viewerOf, } from '../services/discussions';
import * as forum from '../services/forum';
import * as permissions from '../services/permissions';
import { ForbiddenError, } from '../core/errors';

const idParams = z.object({ id: z.string().uuid(), },);
const page = z.coerce.number().int().min(1,).optional();
const limit = z.coerce.number().int().min(1,).max(100,).optional();
const rank = z.number().int().min(0,).max(1000,).nullable().optional();

const settingsBody = z.object({
    title: z.string().max(120,).optional(),
    description: z.string().max(2000,).optional(),
    readAccess: z.enum(['public', 'members', 'tier',],).optional(),
    readMinRank: z.number().int().min(0,).optional(),
    threadMinRank: z.number().int().min(0,).optional(),
    replyMinRank: z.number().int().min(0,).optional(),
    approveAll: z.boolean().optional(),
    approveUntil: z.number().int().min(0,).optional(),
    threadsPerPage: z.number().int().optional(),
    postsPerPage: z.number().int().optional(),
    showActivityCounts: z.boolean().optional(),
    allowAnonymous: z.boolean().optional(),
    anonymousApproval: z.boolean().optional(),
},) satisfies z.ZodType<ForumSettingsBody>;

const categoryBody = z.object({
    name: z.string().max(120,),
    slug: z.string().max(80,).optional(),
    description: z.string().max(2000,).nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
    readMinRank: rank,
    postMinRank: rank,
    locked: z.boolean().optional(),
    hiddenFromIndex: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
},) satisfies z.ZodType<ForumCategoryBody>;

const threadCreateBody = z.object({
    // Id or slug.
    categoryId: z.string().min(1,).max(80,),
    // Empty → derived from the first line of the body.
    title: z.string().max(200,).optional(),
    body: z.string().min(1,).max(50_000,),
    guestName: z.string().max(80,).optional(),
    guestEmail: z.string().max(255,).optional(),
    // Honeypot.
    website: z.string().max(500,).optional(),
},) satisfies z.ZodType<ForumThreadCreateBody>;

const threadUpdateBody = z.object({
    title: z.string().max(200,).optional(), categoryId: z.string().uuid().optional(),
},) satisfies z.ZodType<ForumThreadUpdateBody>;

/** `threads` arrives comma-joined (the SDK joins the array); present-but-empty = an empty selection. */
const feedQuery = z.object({
    threads: z.string().max(8_200,).optional()
        .transform((v,) => (v === undefined ? undefined : v.split(',',).map((x,) => x.trim()).filter(Boolean,).slice(0, MAX_FORUM_BLOCK_LIMIT,))),
    sort: z.enum(['latest', 'newest', 'hot', 'top',],).optional(),
    window: z.enum(['24h', '7d', '30d', 'all',],).optional(),
    category: z.string().max(80,).optional(),
    postCategory: z.string().max(80,).optional(),
    page,
    limit: z.coerce.number().int().min(1,).max(MAX_FORUM_BLOCK_LIMIT,).optional(),
},);
type _AssertFeedQuery = AssertCompatible<z.infer<typeof feedQuery>, ForumFeedQuery>;

const THREAD_ACTIONS = ['pin', 'unpin', 'lock', 'unlock', 'approve', 'hide', 'restore', 'delete',] as const;

export const forumRoutes = [
    // ─── Settings ───
    defineRoute({
        method: 'get', path: '/settings', auth: 'optional',
        summary: 'Forum settings (public: the pages need the title, page sizes and access rules).',
        handler: () => forum.getSettings(),
    },),
    defineRoute({
        method: 'put', path: '/settings', auth: 'admin',
        summary: 'Update the forum settings.',
        input: { body: settingsBody, },
        handler: async ({ body, user, audit, },) => {
            await permissions.requirePermission(viewerOf(user,), 'forum:manage',);
            return forum.updateSettings(body, audit(),);
        },
    },),

    // ─── Categories ───
    defineRoute({
        method: 'get', path: '/categories', auth: 'optional',
        summary: 'Categories the caller may read, with counts and the latest thread.',
        handler: ({ user, },) => forum.listCategories(viewerOf(user,),),
    },),
    defineRoute({
        method: 'post', path: '/categories', auth: 'staff',
        summary: 'Create a category.',
        input: { body: categoryBody, },
        handler: async ({ body, user, },) => reply(await forum.saveCategory(null, body, viewerOf(user,),), { status: 201, },),
    },),
    defineRoute({
        method: 'post', path: '/categories/reorder', auth: 'staff',
        summary: 'Set category order.',
        input: { body: z.object({ ids: z.array(z.string().uuid(),).min(1,).max(500,), },), },
        handler: async ({ body, user, },) => {
            await forum.reorderCategories(body.ids, viewerOf(user,),);
            return { reordered: true as const, };
        },
    },),
    defineRoute({
        method: 'put', path: '/categories/:id', auth: 'staff',
        summary: 'Update a category.',
        input: { params: idParams, body: categoryBody.partial(), },
        handler: ({ params, body, user, },) => forum.saveCategory(params.id, body as ForumCategoryBody, viewerOf(user,),),
    },),
    defineRoute({
        method: 'delete', path: '/categories/:id', auth: 'staff',
        summary: 'Delete an empty category.',
        input: { params: idParams, },
        handler: async ({ params, user, },) => {
            await forum.removeCategory(params.id, viewerOf(user,),);
            return { deleted: true as const, };
        },
    },),
    defineRoute({
        method: 'get', path: '/categories/:slug/threads', auth: 'optional',
        summary: 'A category\'s threads: pinned first, then by last activity.',
        input: { params: z.object({ slug: z.string().max(80,), },), query: z.object({ page, limit, },), },
        handler: async ({ params, query, user, },) => {
            const r = await forum.categoryThreads(params.slug, viewerOf(user,), query.page ?? 1, query.limit,);
            return reply({ category: r.category, threads: r.threads, }, {
                meta: { page: r.page, limit: r.limit, total: r.total, totalPages: Math.ceil(r.total / r.limit,), },
            },);
        },
    },),

    // ─── Forum block feed ───
    defineRoute({
        method: 'get', path: '/feed', auth: 'optional',
        summary: 'Threads for a forum block: opening posts, last replier, per-thread reply rights and the post target.',
        input: { query: feedQuery, },
        handler: ({ query, user, },) => forum.forumFeed(query, viewerOf(user,),),
    },),

    // ─── Threads ───
    defineRoute({
        method: 'get', path: '/threads', auth: 'staff',
        summary: 'All threads (moderators), filterable by status / category / pinned / search.',
        input: {
            query: z.object({
                status: z.enum(['visible', 'pending', 'hidden', 'deleted', 'all',],).optional(),
                category: z.string().max(80,).optional(),
                search: z.string().max(200,).optional(),
                pinned: z.coerce.boolean().optional(),
                page, limit,
            },),
        },
        handler: async ({ query, user, },) => {
            const r = await forum.adminThreads(query, viewerOf(user,),);
            return reply(r.items, { meta: { page: r.page, limit: r.limit, total: r.total, totalPages: Math.ceil(r.total / r.limit,), }, },);
        },
    },),
    defineRoute({
        method: 'post', path: '/threads', auth: 'optional',
        summary: 'Start a thread (first post; title optional — derived from the first line). Guests when Allow anonymous posting is on.',
        input: {
            body: threadCreateBody,
        },
        handler: async ({ body, user, req, },) =>
            reply(await forum.createThread(body, viewerOf(user,), req.ip ?? null,), { status: 201, },),
    },),
    defineRoute({
        method: 'get', path: '/threads/:id', auth: 'optional',
        summary: 'A thread by id (with its opening post).',
        input: { params: idParams, },
        handler: ({ params, user, },) => forum.getThreadById(params.id, viewerOf(user,),),
    },),
    defineRoute({
        method: 'get', path: '/t/:category/:thread', auth: 'optional',
        summary: 'A thread page by category + thread slug (counts a view).',
        input: { params: z.object({ category: z.string().max(80,), thread: z.string().max(160,), },), },
        handler: ({ params, user, req, },) =>
            forum.getThread(params.category, params.thread, viewerOf(user,), req.ip ?? 'anon',),
    },),
    defineRoute({
        method: 'put', path: '/threads/:id', auth: 'user',
        summary: 'Edit a thread title (author) or move it (moderators).',
        input: {
            params: idParams,
            body: threadUpdateBody,
        },
        handler: ({ params, body, user, },) => forum.updateThread(params.id, body, viewerOf(user,),),
    },),
    defineRoute({
        method: 'post', path: '/threads/:id/:action', auth: 'user',
        summary: 'Pin / lock / approve / hide / restore / delete a thread (moderators; authors may delete an unanswered thread).',
        input: { params: z.object({ id: z.string().uuid(), action: z.enum(THREAD_ACTIONS,), },), },
        handler: async ({ params, user, },) => {
            if (!user) throw new ForbiddenError();
            return forum.actOnThread(params.id, params.action, viewerOf(user,),);
        },
    },),
];
