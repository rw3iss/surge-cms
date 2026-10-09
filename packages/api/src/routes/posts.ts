import { BANNER_HEIGHT_MAX, BANNER_POSITION_CUSTOM_MAX, isValidBannerHeight, isValidBannerPositionCustom, } from '@sitesurge/types';
import * as liveReplays from '../services/liveReplays';
import * as postSettings from '../services/postSettings';
import { requirePermission, } from '../services/permissions';
import type { PostsSettingsBody, } from '@sitesurge/types';
import { ALL_BLOCK_TYPES, isPostType, } from '@sitesurge/types';
import { z, } from 'zod';
import type {
    AssertCompatible,
    PostListQuery,
    PostReorderBlocksBody,
    PostSearchQuery,
} from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import { isAdminRole, } from '../api/roles';
import { NotFoundError, } from '../core/errors';
import * as posts from '../services/posts';
import * as postTypes from '../services/postTypes';
import * as liveRooms from '../services/liveRooms';
import * as liveShows from '../services/liveShows';
import * as liveRecordings from '../services/liveRecordings';
import type { PostLiveRecordingPartUrlBody, PostLiveRecordingStartBody, } from '@sitesurge/types';

// ─── Schemas ──────────────────────────────────────────────────────

const contentBlockSchema = z.object({
    id: z.string().optional(),
    // From the shared catalog — a hand-written copy silently drifts (this one
    // was missing entity/group/template) and rejects valid blocks as invalid.
    type: z.enum(ALL_BLOCK_TYPES,),
    sort_order: z.number().int().min(0,),
    data: z.record(z.string(), z.unknown(),).default({},),
},);

const postSchema = z.object({
    slug: z.string().min(1,).max(255,).regex(/^[a-z0-9-]+$/,),
    title: z.string().min(1,).max(255,),
    excerpt: z.string().optional(),
    content: z.string().optional().default('',),
    // Accepts a relative media path (/uploads/…) or an absolute URL; the
    // media library serves relative paths, so `.url()` would wrongly reject.
    featuredImage: z.string().max(2048,).nullish(),
    // Post author (a staff user id) — null clears it, omitted defaults to
    // the creating user on create.
    authorId: z.string().uuid().nullish(),
    status: z.enum(['draft', 'published', 'scheduled', 'archived', 'deleted',],).optional(),
    publishAt: z.string().datetime().nullable().optional(),
    isPrivate: z.boolean().optional(),
    tags: z.array(z.string(),).optional(),
    categories: z.array(z.string(),).optional(),
    metaTitle: z.string().max(255,).optional(),
    metaDescription: z.string().optional(),
    publishedAt: z.string().datetime().optional(),
    applyPostPadding: z.boolean().optional(),
    applySiteGutter: z.boolean().optional(),
    headerStyle: z.enum(['default', 'alt',],).optional(),
    headerPosition: z.enum(['static', 'float',],).optional(),
    bannerLayout: z.enum(['hero', 'hero-full', 'standalone', 'thumbnail',],).optional(),
    bannerImagePosition: z.enum(['start', 'center', 'end', 'custom',],).optional(),
    // Any CSS position, used when bannerImagePosition = 'custom'. Refused if it
    // could escape a style value (see isValidBannerPositionCustom).
    bannerImagePositionCustom: z.string().trim().max(BANNER_POSITION_CUSTOM_MAX,)
        .refine((v,) => v === '' || isValidBannerPositionCustom(v,), 'Not a valid background position',)
        .nullish(),
    showPhotoCredits: z.boolean().optional(),
    // Subscription gating ('' from a "None" select = public).
    requiredTierId: z.preprocess((v,) => (v === '' ? null : v), z.string().uuid().nullish(),),
    gateHidden: z.boolean().optional(),
    gateShowSample: z.boolean().optional(),
    gateSamplePercent: z.number().int().min(1,).max(100,).optional(),
    bannerHeight: z.string().trim().max(BANNER_HEIGHT_MAX,)
        .refine((v,) => v === '' || isValidBannerHeight(v,), 'Not a valid CSS height',)
        .nullish(),
    contentBlocks: z.array(contentBlockSchema,).optional(),
    // Post type (registered key, see @sitesurge/types utils/postTypes) +
    // its per-type options. Defaults: 'article', the type's settingsDefaults.
    postType: z.string().superRefine((v, ctx,) => {
        if (!isPostType(v,)) {
            ctx.addIssue({ code: 'custom', message: `Unknown post type "${v}". Valid types: ${postTypes.validKeys().join(', ',)}`, },);
        }
    },).optional(),
    typeSettings: z.record(z.string(), z.unknown(),).nullish(),
},);

const idParams = z.object({ id: z.string(), },);

const postsSettingsBody = z.object({
    general: z.object({ defaultPostType: z.string().max(32,), },).partial().optional(),
    types: z.record(z.string(), z.record(z.string(), z.unknown(),),).optional(),
    live: z.object({
        provider: z.string().max(32,).nullable().optional(),
        providers: z.record(z.string(), z.record(z.string(), z.unknown(),),).optional(),
    },).optional(),
},);

const recordingParams = z.object({ id: z.string(), rid: z.string().uuid(), },);
const recordingStartBody = z.object({ mimeType: z.string().min(1,).max(128,), },) satisfies z.ZodType<PostLiveRecordingStartBody>;
const recordingPartBody = z.object({ partNumber: z.number().int(), },) satisfies z.ZodType<PostLiveRecordingPartUrlBody>;
const liveTestBody = z.object({ provider: z.string().min(1,).max(32,), },);

/** Staff route + the `posts.live:host` permission. */
const requireHost = (user: { id?: string; role?: string; } | undefined,) =>
    requirePermission({ id: user?.id, role: user?.role, }, 'posts.live:host',);

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
    /** Post type filter (e.g. 'live'). */
    type: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/,).optional(),
},);

const searchQuery = z.object({
    q: z.string().min(1,),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(10,),
},);

const reorderBlocksBody = z.object({ blockIds: z.array(z.string(),), },) satisfies z.ZodType<PostReorderBlocksBody>;

// DTO bindings — drift between these zod schemas and the published DTOs
// is a compile error here. Query schemas coerce (string → number), so we
// assert z.infer compatibility rather than `satisfies z.ZodType<…>`.
type _AssertPostListQuery = AssertCompatible<z.infer<typeof listQuery>, PostListQuery>;
type _AssertPostSearchQuery = AssertCompatible<z.infer<typeof searchQuery>, PostSearchQuery>;

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
                    { status, search: query.search, sort: query.sort, postType: query.type, },
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
                    postType: query.type,
                    withContentBlocks: query.withBlocks === '1' || query.withBlocks === 'true',
                },
                pagination: { page: query.page, limit: query.limit, },
                anonymous: !user && !apiKey,
                isAdmin,
                user,
            },);
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/settings', auth: 'staff',
        summary: 'Posts settings (General, per type, Live Show provider — secrets masked) + the live provider catalogue.',
        handler: () => postSettings.getForClient(),
    },),

    defineRoute({
        method: 'put', path: '/settings', auth: 'admin',
        summary: 'Update posts settings (partial). A secret echoed as the mask is kept.',
        input: { body: postsSettingsBody, },
        handler: async ({ body, user, audit, },) => {
            await requirePermission({ id: user?.id, role: user?.role, }, 'posts.settings:write',);
            const result = await postSettings.update(body as PostsSettingsBody, audit(),);
            await liveShows.syncLiveCsp();
            return result;
        },
    },),

    defineRoute({
        method: 'post', path: '/settings/live/test', auth: 'admin',
        summary: 'Test a live provider\'s SAVED credentials (read-only call to the provider).',
        input: { body: liveTestBody, },
        handler: async ({ body, user, },) => {
            await requirePermission({ id: user?.id, role: user?.role, }, 'posts.settings:write',);
            return liveShows.testProvider(body.provider,);
        },
    },),

    defineRoute({
        method: 'get', path: '/search', auth: 'public',
        summary: 'Full-text search over published posts.',
        input: { query: searchQuery, },
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
        method: 'get', path: '/types', auth: 'public',
        summary: 'Registered post types (built-in + site-defined).',
        handler: () => postTypes.list(),
    },),

    defineRoute({
        method: 'post', path: '/bulk', auth: 'staff',
        summary: 'Bulk status change / soft-delete by id list.',
        handler: ({ body, audit, },) => posts.bulk(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/:id', auth: 'staff',
        summary: 'Fetch a post by id (any status).',
        input: { params: idParams, },
        handler: async ({ params, },) => {
            const post = await posts.getById(params.id,);
            if (!post) throw new NotFoundError('Post',);
            return post;
        },
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'staff',
        summary: 'Create a post.',
        input: { body: postSchema, },
        handler: async ({ body, audit, },) => {
            const post = await posts.create(body, audit(),);
            return reply(post, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/:id', auth: 'staff',
        summary: 'Update a post. Snapshots a revision first.',
        input: { params: idParams, body: postSchema.partial(), },
        handler: ({ params, body, audit, },) => posts.update(params.id, body, audit(),),
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'staff',
        summary: 'Delete a post.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await posts.remove(params.id, audit(),);
            return { message: 'Post deleted', };
        },
    },),

    defineRoute({
        method: 'get', path: '/:id/revisions', auth: 'staff',
        summary: 'List a post\'s saved revisions.',
        input: { params: idParams, },
        handler: ({ params, },) => posts.listRevisions(params.id,),
    },),

    defineRoute({
        method: 'post', path: '/:id/revisions', auth: 'staff',
        summary: 'Snapshot the post\'s current state as a revision.',
        input: { params: idParams, },
        handler: ({ params, audit, },) => posts.snapshotNow(params.id, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/:id/revisions/:version', auth: 'staff',
        summary: 'Fetch one revision snapshot.',
        input: { params: z.object({ id: z.string(), version: z.coerce.number().int(), },), },
        handler: ({ params, },) => posts.getRevision(params.id, params.version,),
    },),

    defineRoute({
        method: 'post', path: '/:id/revisions/:version/restore', auth: 'staff',
        summary: 'Restore a revision (snapshots current state first).',
        input: { params: z.object({ id: z.string(), version: z.coerce.number().int(), },), },
        handler: ({ params, audit, },) => posts.restoreRevision(params.id, params.version, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/:id/live', auth: 'optional',
        summary: 'A live show\'s room state (REST fallback to the /ws/live socket).',
        input: { params: idParams, },
        handler: ({ params, user, },) => liveRooms.getState(params.id, user,),
    },),

    defineRoute({
        method: 'post', path: '/:id/live/ticket', auth: 'optional',
        summary: 'Issue a short-lived signed ticket that live-room commands carry as `token`.',
        input: { params: idParams, },
        handler: ({ params, user, },) => liveRooms.issueTicketFor(params.id, user,),
    },),

    defineRoute({
        method: 'post', path: '/:id/live/publish', auth: 'staff',
        summary: 'Host ingest (WHIP) for a live show; creates the provider input on first use.',
        input: { params: idParams, },
        handler: async ({ params, user, },) => {
            await requireHost(user,);
            return liveShows.publish(params.id,);
        },
    },),

    defineRoute({
        method: 'get', path: '/:id/live/playback', auth: 'optional',
        summary: 'How to watch a live show now (WHEP), or { available: false, reason }. Per viewer, never cached.',
        input: { params: idParams, },
        handler: ({ params, user, res, },) => {
            // Per-viewer (subscription gate) — no shared/edge caching.
            res.set('Cache-Control', 'private, no-store',);
            return liveShows.playback(params.id, user,);
        },
    },),

    defineRoute({
        method: 'get', path: '/:id/live/recordings', auth: 'staff',
        summary: 'Saved recordings (versions) of a live show, newest first; `current` = shown on the post.',
        input: { params: idParams, },
        handler: async ({ params, user, },) => {
            await requireHost(user,);
            return liveReplays.listVersions(params.id,);
        },
    },),

    defineRoute({
        method: 'post', path: '/:id/live/recordings/:mediaId/select', auth: 'staff',
        summary: 'Show this recording version as the post\'s replay.',
        input: { params: z.object({ id: z.string(), mediaId: z.string().uuid(), },), },
        handler: async ({ params, user, audit, },) => {
            await requireHost(user,);
            return liveReplays.selectVersion(params.id, params.mediaId, audit(),);
        },
    },),

    defineRoute({
        method: 'delete', path: '/:id/live/recordings/:mediaId', auth: 'staff',
        summary: 'Delete a recording version and all its stored files (CDN included). The post stays; a removed shown replay reads "Video has been removed."',
        input: { params: z.object({ id: z.string(), mediaId: z.string().uuid(), },), },
        handler: async ({ params, user, audit, },) => {
            await requireHost(user,);
            return liveReplays.deleteVersion(params.id, params.mediaId, audit(),);
        },
    },),

    defineRoute({
        method: 'post', path: '/:id/live/restart', auth: 'staff',
        summary: 'Re-open an ended live show so it can go live again and record a new version.',
        input: { params: idParams, },
        handler: async ({ params, user, audit, },) => {
            await requireHost(user,);
            await liveReplays.restartShow(params.id, audit(),);
            return { message: 'Show reopened', };
        },
    },),

    defineRoute({
        method: 'get', path: '/:id/live/recording', auth: 'staff',
        summary: 'The show\'s open browser recording, else the latest one, else null.',
        input: { params: idParams, },
        handler: async ({ params, user, },) => {
            await requireHost(user,);
            return liveRecordings.current(params.id,);
        },
    },),

    defineRoute({
        method: 'post', path: '/:id/live/recording', auth: 'staff',
        summary: 'Start (or resume) the host browser recording: an object-store multipart upload of equal parts.',
        input: { params: idParams, body: recordingStartBody, },
        handler: async ({ params, body, user, audit, },) => {
            await requireHost(user,);
            return liveRecordings.start(params.id, body.mimeType, user, audit(),);
        },
    },),

    defineRoute({
        method: 'post', path: '/:id/live/recording/:rid/part-url', auth: 'staff',
        summary: 'Presigned PUT URL (1 h) for one recording part (1–10000).',
        input: { params: recordingParams, body: recordingPartBody, },
        handler: async ({ params, body, user, },) => {
            await requireHost(user,);
            return liveRecordings.partUrl(params.id, params.rid, body.partNumber,);
        },
    },),

    defineRoute({
        method: 'post', path: '/:id/live/recording/:rid/complete', auth: 'staff',
        summary: 'Assemble the recording → a video media item the pipeline encodes into the replay.',
        input: { params: recordingParams, },
        handler: async ({ params, user, audit, },) => {
            await requireHost(user,);
            return liveRecordings.complete(params.id, params.rid, audit(),);
        },
    },),

    defineRoute({
        method: 'delete', path: '/:id/live/recording/:rid', auth: 'staff',
        summary: 'Discard a recording (aborts the multipart upload).',
        input: { params: recordingParams, },
        handler: async ({ params, user, audit, },) => {
            await requireHost(user,);
            return liveRecordings.abort(params.id, params.rid, audit(),);
        },
    },),

    defineRoute({
        method: 'put', path: '/:id/blocks/reorder', auth: 'staff',
        summary: 'Reorder a post\'s content blocks.',
        input: {
            params: idParams,
            body: reorderBlocksBody,
        },
        handler: async ({ params, body, },) => {
            await posts.reorderContentBlocks(params.id, body.blockIds,);
            return { message: 'Blocks reordered', };
        },
    },),
];
