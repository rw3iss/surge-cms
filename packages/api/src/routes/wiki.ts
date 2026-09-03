/**
 * Wiki routes.
 *
 * Reads are `optional` auth: the wiki is public by default and each page
 * decides for itself via `view_roles`, so the caller's identity narrows what
 * comes back rather than whether they may call at all.
 *
 * Writes are `staff` tier AND gated on `wiki:write` — the tier is the
 * authentication floor, the permission is the policy. Widening the permission
 * to members is how an operator later opens contributions.
 */
import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import * as wiki from '../services/wiki';
import * as permissions from '../services/permissions';

const idParams = z.object({ id: z.string().uuid(), },);
const refParams = z.object({ ref: z.string().min(1,).max(255,), },);

const pageBody = z.object({
    title: z.string().min(1,).max(255,),
    slug: z.string().max(255,).nullish(),
    content: z.string().optional(),
    tags: z.array(z.string().max(60,),).optional(),
    categories: z.array(z.string().max(60,),).optional(),
    parentId: z.string().uuid().nullish(),
    viewRoles: z.array(z.string().max(32,),).optional(),
    status: z.enum(['draft', 'published', 'archived',],).optional(),
    position: z.number().int().optional(),
},);

const searchQuery = z.object({
    q: z.string().max(200,).optional(),
    limit: z.coerce.number().int().min(1,).max(50,).default(25,),
},);

const deleteQuery = z.object({
    mode: z.enum(['cascade', 'orphan',],).default('orphan',),
},);

const listQuery = z.object({
    /** Staff-only: include drafts/archived in the admin tree. */
    all: z.coerce.boolean().optional(),
},);

/** The viewer shape both the service and the permission manager expect. */
const viewerOf = (user: { id?: string; role?: string; } | undefined,) =>
    ({ id: user?.id, role: user?.role, });

export const wikiRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'optional',
        summary: 'List wiki pages the caller may view (flat; build the tree client-side).',
        input: { query: listQuery, },
        handler: async ({ query, user, },) => {
            const viewer = viewerOf(user,);
            await permissions.requirePermission(viewer, 'wiki:read',);
            const isStaff = ['editor', 'admin', 'sysadmin',].includes(user?.role ?? '',);
            return wiki.list(viewer, { includeUnpublished: Boolean(query.all && isStaff,), },);
        },
    },),

    defineRoute({
        method: 'get', path: '/search', auth: 'optional',
        summary: 'Search wiki titles + content; returns scored hits with highlighted excerpts.',
        input: { query: searchQuery, },
        handler: async ({ query, user, },) => {
            const viewer = viewerOf(user,);
            await permissions.requirePermission(viewer, 'wiki:read',);
            return wiki.search(query.q ?? '', viewer, query.limit,);
        },
    },),

    /** Child counts, so the admin tree can mark expandable rows in one call. */
    defineRoute({
        method: 'get', path: '/child-counts', auth: 'staff',
        summary: 'Map of parent id → number of children.',
        handler: () => wiki.childCounts(),
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'staff',
        summary: 'Create a wiki page.',
        input: { body: pageBody, },
        handler: async ({ body, user, audit, },) => {
            await permissions.requirePermission(viewerOf(user,), 'wiki:write',);
            const page = await wiki.create(body, audit(),);
            return reply(page, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/:id', auth: 'staff',
        summary: 'Update a wiki page.',
        input: { params: idParams, body: pageBody.partial(), },
        handler: async ({ params, body, user, audit, },) => {
            await permissions.requirePermission(viewerOf(user,), 'wiki:write',);
            return wiki.update(params.id, body, audit(),);
        },
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'staff',
        summary: 'Delete a page. mode=orphan promotes children to roots; cascade removes the subtree.',
        input: { params: idParams, query: deleteQuery, },
        handler: async ({ params, query, user, audit, },) => {
            await permissions.requirePermission(viewerOf(user,), 'wiki:delete',);
            return wiki.remove(params.id, query.mode, audit(),);
        },
    },),

    // Declared LAST: `/search` and `/child-counts` are literal paths that would
    // otherwise be captured by this catch-all.
    defineRoute({
        method: 'get', path: '/:ref', auth: 'optional',
        summary: 'Fetch one page by slug or id.',
        input: { params: refParams, },
        handler: async ({ params, user, },) => {
            const viewer = viewerOf(user,);
            await permissions.requirePermission(viewer, 'wiki:read',);
            return wiki.getByIdOrSlug(params.ref, viewer,);
        },
    },),
];
