/**
 * /api/v1/gallery (feature `gallery`).
 *
 * Public (viewer-gated; `gallery:view` + the gallery/collection/item access rules):
 *   GET /config, GET / (query), GET /items/:id, GET /collections, GET /collections/:id
 * Staff (`gallery:manage`): GET/PUT /admin/items (PUT = publish the draft),
 *   PATCH/DELETE /admin/items/:id, POST /admin/items/move, GET /admin/media-links (media → item),
 *   GET/POST /admin/collections, PATCH/DELETE /admin/collections/:id
 * Admin (`gallery.settings:manage`): GET/PUT /settings
 */
import { z, } from 'zod';
import type {
    AssertCompatible, GalleryAdminCollectionsResponse, GalleryCollectionCreateBody, GalleryCollectionDeleteBody, GalleryCollectionDeleteResponse,
    GalleryCollectionResponse, GalleryCollectionsQuery, GalleryCollectionsResponse, GalleryCollectionUpdateBody, GalleryMoveItemsBody, GalleryMoveItemsResponse,
    GalleryAdminItemsResponse, GalleryConfigResponse, GalleryItemResponse, GalleryItemUpdateBody, GalleryListResponse,
    GalleryRemoveResponse, GallerySettingsBody, GallerySettingsResponse, GallerySyncBody, GallerySyncResponse,
} from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import { AccessRequiredError, NotFoundError, } from '../core/errors';
import { viewerOf, } from '../services/discussions/viewer';
import * as gallery from '../services/gallery';
import * as permissions from '../services/permissions';

const idParams = z.object({ id: z.string().uuid(), },);
const inherit = z.enum(['inherit', 'on', 'off',],);
const accessRule = z.object({
    enabled: z.boolean(),
    roles: z.array(z.string().max(64,),).max(50,),
    tierIds: z.array(z.string().uuid(),).max(50,),
},);
const patch = z.object({
    titleOverride: z.string().max(300,).nullable().optional(),
    captionOverride: z.string().max(4000,).nullable().optional(),
    tags: z.array(z.string().max(40,),).max(30,).optional(),
    visibility: z.enum(['inherit', 'public', 'members', 'tier',],).optional(),
    minTierId: z.string().uuid().nullable().optional(),
    comments: inherit.optional(),
    anonymousComments: inherit.optional(),
    collectionId: z.string().uuid().nullable().optional(),
    access: accessRule.optional(),
    hiddenInGallery: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
},) satisfies z.ZodType<GalleryItemUpdateBody>;

const collectionBody = z.object({
    name: z.string().max(200,).optional(),
    description: z.string().max(4000,).optional(),
    sortOrder: z.number().int().optional(),
    access: accessRule.optional(),
    hiddenInGallery: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
},) satisfies z.ZodType<GalleryCollectionCreateBody & GalleryCollectionUpdateBody>;

const collectionDeleteBody = z.object({
    items: z.enum(['delete', 'root', 'move',],),
    targetId: z.string().uuid().optional(),
    deleteMedia: z.boolean().optional(),
    forceMedia: z.boolean().optional(),
},) satisfies z.ZodType<GalleryCollectionDeleteBody>;

const moveBody = z.object({
    ids: z.array(z.string().uuid(),).max(5000,),
    collectionId: z.string().uuid().nullable(),
},) satisfies z.ZodType<GalleryMoveItemsBody>;

const syncBody = z.object({
    items: z.array(patch.extend({ id: z.string().uuid().optional(), mediaId: z.string().uuid().optional(), },),).max(5000,),
    remove: z.array(z.object({ id: z.string().uuid(), deleteMedia: z.boolean().optional(), },),).max(5000,).optional(),
    forceMedia: z.boolean().optional(),
    basedOn: z.object({ updatedAt: z.string().datetime().nullable(), count: z.number().int().min(0,), },).optional(),
    overwrite: z.boolean().optional(),
},) satisfies z.ZodType<GallerySyncBody>;

/** `?listing=true` (gallery pages only) — query strings carry booleans as text. */
const queryBool = z.union([z.boolean(), z.enum(['true', 'false', '1', '0',],),],).optional()
    .transform((v,) => (v === undefined ? undefined : v === true || v === 'true' || v === '1'),);

const listQuery = z.object({
    ids: z.string().max(10_000,).optional(),
    collectionId: z.union([z.literal('root',), z.string().uuid(),],).optional(),
    type: z.enum(['image', 'video', 'all',],).optional(),
    tag: z.string().max(400,).optional(),
    search: z.string().max(100,).optional(),
    sort: z.enum(['order', 'newest', 'oldest', 'title', 'random',],).optional(),
    limit: z.coerce.number().int().min(1,).max(200,).optional(),
    page: z.coerce.number().int().min(1,).optional(),
    seed: z.string().regex(/^[\w-]{1,32}$/,).optional(),
    listing: queryBool,
    featured: queryBool,
},);

const collectionsQuery = z.object({ listing: queryBool, },);
type _AssertCollectionsQuery = AssertCompatible<z.infer<typeof collectionsQuery>, GalleryCollectionsQuery>;

const appearance = z.object({
    layout: z.enum(['grid', 'masonry', 'carousel', 'stage',],).optional(),
    open: z.enum(['lightbox', 'page', 'none',],).optional(),
    thumbSize: z.number().int().optional(),
    gap: z.string().max(64,).optional(),
    aspect: z.enum(['square', '4:3', '3:2', '16:9', 'original',],).optional(),
    fit: z.enum(['cover', 'contain',],).optional(),
    radius: z.string().max(64,).optional(),
    gutter: z.enum(['site', 'custom',],).optional(),
    customGutter: z.string().max(64,).optional(),
    padding: z.enum(['site', 'custom',],).optional(),
    customPadding: z.string().max(64,).optional(),
    maxWidth: z.enum(['site', 'custom',],).optional(),
    customMaxWidth: z.string().max(64,).optional(),
    showTitles: z.boolean().optional(),
    showCaptions: z.boolean().optional(),
    hoverZoom: z.boolean().optional(),
    perPage: z.number().int().optional(),
    videoBadge: z.boolean().optional(),
    showPublishedDate: z.boolean().optional(),
    thumbStrip: z.boolean().optional(),
    showCollectionsSidebar: z.boolean().optional(),
},);

const settingsBody = z.object({
    title: z.string().max(120,).optional(),
    description: z.string().max(4000,).optional(),
    baseUrl: z.string().max(80,).optional(),
    access: z.enum(['public', 'members', 'tier',],).optional(),
    minTierId: z.string().uuid().nullable().optional(),
    allowVideos: z.boolean().optional(),
    commentsEnabled: z.boolean().optional(),
    allowAnonymousComments: z.boolean().optional(),
    appearance: appearance.optional(),
},);

type U = { id?: string; role?: string; } | undefined;
const need = (user: U, key: string,) => permissions.requirePermission(viewerOf(user,) as never, key,);
/** Public reads: anyone with gallery:view (default everyone); staff read everything. */
const canView = (user: U,) => permissions.can(viewerOf(user,) as never, 'gallery:view',).catch(() => false);

/**
 * An item / collection that EXISTS but this viewer may not see: 403
 * `SIGN_IN_REQUIRED` (signed out) or `SUBSCRIPTION_REQUIRED` (signed in), so
 * the page can forward to the login page with the reason. A missing one stays
 * 404. Listings are unaffected (they just leave gated rows out).
 */
const denied = (user: U, what: string,) =>
    new AccessRequiredError(user?.id ? 'subscribe' : 'signin', null, user?.id ? `You may not view this gallery ${what}.` : 'Please sign in to view this.',);

export const galleryRoutes = [
    defineRoute({
        method: 'get', path: '/config', auth: 'optional',
        summary: 'Gallery title, route, appearance and whether THIS viewer may open it.',
        handler: async ({ user, },): Promise<GalleryConfigResponse> => {
            const cfg = await gallery.publicConfig(viewerOf(user,),);
            return (await canView(user,)) ? cfg : { ...cfg, canView: false, };
        },
    },),
    defineRoute({
        method: 'get', path: '/', auth: 'optional',
        summary: 'Query gallery items visible to the viewer (type, tag, search, ids, sort, limit, page). `listing=true` (gallery pages) leaves out items hidden from the gallery and items in hidden collections.',
        input: { query: listQuery, },
        handler: async ({ query, user, },): Promise<GalleryListResponse> => {
            if (!(await canView(user,))) return { items: [], total: 0, page: 1, limit: query.limit ?? 24, };
            return gallery.list(query, { viewer: viewerOf(user,), },);
        },
    },),
    defineRoute({
        method: 'get', path: '/items/:id', auth: 'optional',
        summary: 'One gallery item (404 when missing or its media is gone; 403 SIGN_IN_REQUIRED / SUBSCRIPTION_REQUIRED when the viewer may not see it).',
        input: { params: idParams, },
        handler: async ({ params, user, },): Promise<GalleryItemResponse> => {
            const open = await canView(user,);
            const { item, gated, } = await gallery.getForViewer(params.id, viewerOf(user,),);
            if (item && open) return item;
            if (item || gated) throw denied(user, 'item',);
            throw new NotFoundError('Gallery item',);
        },
    },),
    defineRoute({
        method: 'get', path: '/collections', auth: 'optional',
        summary: 'Collections visible to the viewer (sort order, name), each with the count of items the viewer can see and a cover. `listing=true` (gallery pages) leaves out collections hidden from the gallery.',
        input: { query: collectionsQuery, },
        handler: async ({ query, user, },): Promise<GalleryCollectionsResponse> => {
            if (!(await canView(user,))) return [];
            return gallery.listCollections(viewerOf(user,), undefined, { listing: query.listing, },);
        },
    },),
    defineRoute({
        method: 'get', path: '/collections/:id', auth: 'optional',
        summary: 'One collection (404 when missing; 403 SIGN_IN_REQUIRED / SUBSCRIPTION_REQUIRED when the viewer fails its access rule).',
        input: { params: idParams, },
        handler: async ({ params, user, },): Promise<GalleryCollectionResponse> => {
            const open = await canView(user,);
            const { collection, gated, } = await gallery.getCollectionForViewer(params.id, viewerOf(user,),);
            if (collection && open) return collection;
            if (collection || gated) throw denied(user, 'collection',);
            throw new NotFoundError('Gallery collection',);
        },
    },),

    // ─── Admin ───
    defineRoute({
        method: 'get', path: '/admin/collections', auth: 'staff',
        summary: 'Every gallery collection with counts of ALL its items.',
        handler: async ({ user, },): Promise<GalleryAdminCollectionsResponse> => {
            await need(user, 'gallery:manage',);
            return gallery.adminCollections();
        },
    },),
    defineRoute({
        method: 'post', path: '/admin/collections', auth: 'staff',
        summary: 'Create a gallery collection (name defaults to "Untitled"; placed first unless sortOrder is given).',
        input: { body: collectionBody, },
        handler: async ({ body, user, audit, },): Promise<GalleryCollectionResponse> => {
            await need(user, 'gallery:manage',);
            return gallery.createCollection(body, audit(),);
        },
    },),
    defineRoute({
        method: 'patch', path: '/admin/collections/:id', auth: 'staff',
        summary: 'Update a gallery collection (name, description, sort order, access rule, hidden from the gallery).',
        input: { params: idParams, body: collectionBody, },
        handler: async ({ params, body, user, audit, },): Promise<GalleryCollectionResponse> => {
            await need(user, 'gallery:manage',);
            return gallery.updateCollection(params.id, body, audit(),);
        },
    },),
    defineRoute({
        method: 'delete', path: '/admin/collections/:id', auth: 'staff',
        summary: 'Delete a collection: its items are deleted (media too with deleteMedia — media still used elsewhere is kept unless forceMedia), moved to the root, or moved to another collection.',
        input: { params: idParams, body: collectionDeleteBody, },
        handler: async ({ params, body, user, audit, },): Promise<GalleryCollectionDeleteResponse> => {
            await need(user, 'gallery:manage',);
            if (body.items === 'delete' && body.deleteMedia) await need(user, 'media:write',);
            return gallery.deleteCollection(params.id, body, audit(),);
        },
    },),
    defineRoute({
        method: 'post', path: '/admin/items/move', auth: 'staff',
        summary: 'Move gallery items into a collection (collectionId null = the gallery root).',
        input: { body: moveBody, },
        handler: async ({ body, user, audit, },): Promise<GalleryMoveItemsResponse> => {
            await need(user, 'gallery:manage',);
            return gallery.moveItems(body, audit(),);
        },
    },),
    defineRoute({
        method: 'get', path: '/admin/items', auth: 'staff',
        summary: 'Every gallery item in order, including ones whose media was deleted.',
        handler: async ({ user, },): Promise<GalleryAdminItemsResponse> => {
            await need(user, 'gallery:manage',);
            return gallery.adminList();
        },
    },),
    defineRoute({
        method: 'put', path: '/admin/items', auth: 'staff',
        summary: 'Publish the gallery draft: ordered items to keep (existing by id, new by mediaId) + removals (optionally deleting media; media still used elsewhere is kept unless forceMedia).',
        input: { body: syncBody, },
        handler: async ({ body, user, audit, },): Promise<GallerySyncResponse> => {
            await need(user, 'gallery:manage',);
            if (body.remove?.some((r,) => r.deleteMedia,)) await need(user, 'media:write',);
            return gallery.sync(body, audit(),);
        },
    },),
    defineRoute({
        method: 'patch', path: '/admin/items/:id', auth: 'staff',
        summary: 'Edit one gallery item (title/caption overrides, tags, visibility, comments, collection, access rule, hidden from the gallery).',
        input: { params: idParams, body: patch, },
        handler: async ({ params, body, user, audit, },): Promise<GalleryItemResponse> => {
            await need(user, 'gallery:manage',);
            return gallery.update(params.id, body, audit(),);
        },
    },),
    defineRoute({
        method: 'delete', path: '/admin/items/:id', auth: 'staff',
        summary: 'Remove a gallery item; `?deleteMedia=true` also deletes its media from the library (kept when still used elsewhere, unless `forceMedia=true`).',
        input: { params: idParams, query: z.object({ deleteMedia: z.enum(['true', 'false',],).optional(), forceMedia: z.enum(['true', 'false',],).optional(), },), },
        handler: async ({ params, query, user, audit, },): Promise<GalleryRemoveResponse> => {
            await need(user, 'gallery:manage',);
            if (query.deleteMedia === 'true') await need(user, 'media:write',);
            return gallery.remove(params.id, query.deleteMedia === 'true', audit(), query.forceMedia === 'true',);
        },
    },),
    defineRoute({
        method: 'get', path: '/admin/media-links', auth: 'staff',
        summary: 'Which of these media ids are already in the gallery (media id → item id).',
        input: { query: z.object({ ids: z.string().max(20_000,), },), },
        handler: async ({ query, user, },): Promise<Record<string, string>> => {
            await need(user, 'gallery:manage',);
            return Object.fromEntries(await gallery.itemsForMedia(query.ids.split(',',).map((x,) => x.trim()),),);
        },
    },),
    defineRoute({
        method: 'get', path: '/settings', auth: 'staff',
        summary: 'Gallery settings (route, access, comments, appearance).',
        handler: async ({ user, },): Promise<GallerySettingsResponse> => {
            await need(user, 'gallery:manage',);
            return gallery.getSettings();
        },
    },),
    defineRoute({
        method: 'put', path: '/settings', auth: 'admin',
        summary: 'Update gallery settings.',
        input: { body: settingsBody, },
        handler: async ({ body, user, audit, },): Promise<GallerySettingsResponse> => {
            await need(user, 'gallery.settings:manage',);
            return gallery.updateSettings(body as GallerySettingsBody, audit(),);
        },
    },),
];
