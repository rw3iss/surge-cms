/**
 * /api/v1/gallery (feature `gallery`).
 *
 * Public (viewer-gated; `gallery:view` + the gallery/item access rules):
 *   GET /config, GET / (query), GET /items/:id
 * Staff (`gallery:manage`): GET/PUT /admin/items (PUT = publish the draft),
 *   PATCH/DELETE /admin/items/:id, GET /admin/media-links (media → item)
 * Admin (`gallery.settings:manage`): GET/PUT /settings
 */
import { z, } from 'zod';
import type {
    GalleryAdminItemsResponse, GalleryConfigResponse, GalleryItemResponse, GalleryItemUpdateBody, GalleryListResponse,
    GalleryRemoveResponse, GallerySettingsBody, GallerySettingsResponse, GallerySyncBody, GallerySyncResponse,
} from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import { NotFoundError, } from '../core/errors';
import { viewerOf, } from '../services/discussions/viewer';
import * as gallery from '../services/gallery';
import * as permissions from '../services/permissions';

const idParams = z.object({ id: z.string().uuid(), },);
const inherit = z.enum(['inherit', 'on', 'off',],);
const patch = z.object({
    titleOverride: z.string().max(300,).nullable().optional(),
    captionOverride: z.string().max(4000,).nullable().optional(),
    tags: z.array(z.string().max(40,),).max(30,).optional(),
    visibility: z.enum(['inherit', 'public', 'members', 'tier',],).optional(),
    minTierId: z.string().uuid().nullable().optional(),
    comments: inherit.optional(),
    anonymousComments: inherit.optional(),
},) satisfies z.ZodType<GalleryItemUpdateBody>;

const syncBody = z.object({
    items: z.array(patch.extend({ id: z.string().uuid().optional(), mediaId: z.string().uuid().optional(), },),).max(5000,),
    remove: z.array(z.object({ id: z.string().uuid(), deleteMedia: z.boolean().optional(), },),).max(5000,).optional(),
},) satisfies z.ZodType<GallerySyncBody>;

const listQuery = z.object({
    ids: z.string().max(10_000,).optional(),
    type: z.enum(['image', 'video', 'all',],).optional(),
    tag: z.string().max(400,).optional(),
    search: z.string().max(100,).optional(),
    sort: z.enum(['order', 'newest', 'oldest', 'title', 'random',],).optional(),
    limit: z.coerce.number().int().min(1,).max(200,).optional(),
    page: z.coerce.number().int().min(1,).optional(),
},);

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
        summary: 'Query gallery items visible to the viewer (type, tag, search, ids, sort, limit, page).',
        input: { query: listQuery, },
        handler: async ({ query, user, },): Promise<GalleryListResponse> => {
            if (!(await canView(user,))) return { items: [], total: 0, page: 1, limit: query.limit ?? 24, };
            return gallery.list(query, { viewer: viewerOf(user,), },);
        },
    },),
    defineRoute({
        method: 'get', path: '/items/:id', auth: 'optional',
        summary: 'One gallery item (404 when missing, its media is gone, or the viewer may not see it).',
        input: { params: idParams, },
        handler: async ({ params, user, },): Promise<GalleryItemResponse> => {
            const item = (await canView(user,)) ? await gallery.get(params.id, { viewer: viewerOf(user,), },) : null;
            if (!item) throw new NotFoundError('Gallery item',);
            return item;
        },
    },),

    // ─── Admin ───
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
        summary: 'Publish the gallery draft: ordered items to keep (existing by id, new by mediaId) + removals (optionally deleting media).',
        input: { body: syncBody, },
        handler: async ({ body, user, audit, },): Promise<GallerySyncResponse> => {
            await need(user, 'gallery:manage',);
            if (body.remove?.some((r,) => r.deleteMedia,)) await need(user, 'media:write',);
            return gallery.sync(body, audit(),);
        },
    },),
    defineRoute({
        method: 'patch', path: '/admin/items/:id', auth: 'staff',
        summary: 'Edit one gallery item (title/caption overrides, tags, visibility, comments).',
        input: { params: idParams, body: patch, },
        handler: async ({ params, body, user, audit, },): Promise<GalleryItemResponse> => {
            await need(user, 'gallery:manage',);
            return gallery.update(params.id, body, audit(),);
        },
    },),
    defineRoute({
        method: 'delete', path: '/admin/items/:id', auth: 'staff',
        summary: 'Remove a gallery item; `?deleteMedia=true` also deletes its media from the library.',
        input: { params: idParams, query: z.object({ deleteMedia: z.enum(['true', 'false',],).optional(), },), },
        handler: async ({ params, query, user, audit, },): Promise<GalleryRemoveResponse> => {
            await need(user, 'gallery:manage',);
            if (query.deleteMedia === 'true') await need(user, 'media:write',);
            return gallery.remove(params.id, query.deleteMedia === 'true', audit(),);
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
