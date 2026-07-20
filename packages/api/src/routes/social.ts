import type {
    AssertCompatible,
    SocialFeedQuery,
    SocialHomepageSetBody,
    SocialManualPostBody,
    SocialPlatform,
    SocialPlatformPostsQuery,
    SocialPostPatchBody,
    SocialPostsQuery,
} from '@sitesurge/types';
import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import { AppError, NotFoundError, } from '../core/errors';
import * as social from '../services/socialFeed';

// ─── Schemas ──────────────────────────────────────────────────────

const postsQuery = z.object({
    platform: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(20,),
},);

const platformPostsQuery = z.object({
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).default(10,),
    search: z.string().optional(),
    sort: z.string().optional(),
    sortDir: z.string().optional(),
    includeHidden: z.coerce.boolean().optional(),
},);

const feedQuery = z.object({
    limit: z.coerce.number().int().optional(),
},);

const homepageSetBody = z.object({
    postIds: z.array(z.string().uuid(),),
},) satisfies z.ZodType<SocialHomepageSetBody>;

const manualPostBody = z.object({
    url: z.string().min(1,),
},) satisfies z.ZodType<SocialManualPostBody>;

const postPatchBody = z.object({
    isHidden: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
},) satisfies z.ZodType<SocialPostPatchBody>;

// platform is a free string at the schema level; the handler narrows it
// to SocialPlatform (invalid values are ignored / treated as "all").
const syncBody = z.object({
    platform: z.string().optional(),
},).optional();

const platformParams = z.object({ platform: z.string(), },);

// Query schemas coerce (string → number), so assert z.infer compatibility.
type _AssertSocialPostsQuery = AssertCompatible<z.infer<typeof postsQuery>, SocialPostsQuery>;
type _AssertSocialFeedQuery = AssertCompatible<z.infer<typeof feedQuery>, SocialFeedQuery>;
type _AssertSocialPlatformPostsQuery = AssertCompatible<z.infer<typeof platformPostsQuery>, SocialPlatformPostsQuery>;

function assertPlatform(p: string,): SocialPlatform {
    if (!social.VALID_PLATFORMS.includes(p as SocialPlatform,)) {
        throw new AppError(400, 'BAD_REQUEST', 'Invalid platform',);
    }
    return p as SocialPlatform;
}

// ─── Routes ───────────────────────────────────────────────────────
// Literal /posts, /feed, /homepage before parameterized variants.

export const socialRoutes = [

    // Stored posts across platforms (public).
    defineRoute({
        method: 'get', path: '/posts', auth: 'public',
        summary: 'List stored social posts (optionally filtered by platform).',
        input: { query: postsQuery, },
        handler: async ({ query, },) => {
            const result = await social.listPosts(
                query.platform as SocialPlatform | undefined,
                query.page,
                query.limit,
            );
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    // Live feed from all connected providers (public).
    defineRoute({
        method: 'get', path: '/feed', auth: 'public',
        summary: 'Live feed across connected providers (API-cached, no DB).',
        input: { query: feedQuery, },
        handler: ({ query, },) => social.liveFeeds(Math.min(query.limit || 10, 50,),),
    },),

    // Live feed for one platform (public + admin picker).
    defineRoute({
        method: 'get', path: '/feed/:platform', auth: 'public',
        summary: 'Live feed for one platform.',
        input: { params: platformParams, query: feedQuery, },
        handler: ({ params, query, },) => {
            const platform = assertPlatform(params.platform,);
            return social.liveFeed(platform, Math.min(query.limit || 10, 50,),);
        },
    },),

    // Homepage selection (public read).
    defineRoute({
        method: 'get', path: '/homepage', auth: 'public',
        summary: 'Posts selected for the homepage (falls back to latest per platform).',
        handler: () => social.homepagePosts(),
    },),

    // Homepage selection (admin write).
    defineRoute({
        method: 'put', path: '/homepage', auth: 'admin',
        summary: 'Set the homepage social post selection.',
        input: { body: homepageSetBody, },
        handler: async ({ body, userId, },) => {
            await social.setHomepagePosts(body.postIds, userId,);
            return { message: 'Homepage posts updated', };
        },
    },),

    // Sync stored posts (admin).
    defineRoute({
        method: 'post', path: '/sync', auth: 'admin',
        summary: 'Sync social posts from one or all platforms.',
        input: { body: syncBody, },
        handler: async ({ body, },) => {
            const platform = body?.platform as SocialPlatform | undefined;
            const results = await social.sync(platform,);
            return { message: 'Sync completed', results, };
        },
    },),

    // Delete a stored post (admin). Distinct from GET /posts/:platform.
    defineRoute({
        method: 'delete', path: '/posts/:id', auth: 'admin',
        summary: 'Delete a stored social post by id.',
        input: { params: z.object({ id: z.string(), },), },
        handler: async ({ params, },) => {
            const deleted = await social.deletePost(params.id,);
            if (!deleted) throw new NotFoundError('Social post',);
            return { message: 'Post deleted', };
        },
    },),

    // Capture a post by pasting its URL (admin). Free-path Option B.
    defineRoute({
        method: 'post', path: '/posts/manual', auth: 'admin',
        summary: 'Add a stored post by pasting its permalink (X/Twitter).',
        input: { body: manualPostBody, },
        handler: ({ body, userId, },) => social.addManualPost(body.url, userId,),
    },),

    // Curate a stored post: hide/show and/or reorder (admin).
    defineRoute({
        method: 'patch', path: '/posts/:id', auth: 'admin',
        summary: 'Hide/show or reorder a stored social post.',
        input: { params: z.object({ id: z.string(), },), body: postPatchBody, },
        handler: async ({ params, body, },) => {
            const found = await social.patchPost(params.id, body,);
            if (!found) throw new NotFoundError('Social post',);
            return { message: 'Post updated', };
        },
    },),

    // Resolve a stored post to a renderable card or oEmbed HTML (public).
    defineRoute({
        method: 'get', path: '/posts/:id/embed', auth: 'public',
        summary: 'Resolve a stored post to a card or sanitized oEmbed HTML.',
        input: { params: z.object({ id: z.string(), },), },
        handler: async ({ params, },) => {
            const embed = await social.getEmbed(params.id,);
            if (!embed) throw new NotFoundError('Social post',);
            return embed;
        },
    },),

    // Stored posts for one platform with search/sort (public).
    defineRoute({
        method: 'get', path: '/posts/:platform', auth: 'optional',
        summary: 'List stored posts for one platform with search/sort.',
        input: { params: platformParams, query: platformPostsQuery, },
        handler: async ({ params, query, userId, },) => {
            const platform = assertPlatform(params.platform,);
            const result = await social.listPlatformPosts({
                platform,
                page: query.page,
                limit: Math.min(query.limit, 50,),
                search: query.search,
                sort: query.sort,
                sortDir: query.sortDir,
                // Hidden posts are only visible to an authenticated admin (for
                // curation); anonymous callers always get the public view.
                includeHidden: Boolean(query.includeHidden && userId,),
            },);
            return reply(result.data, { meta: result.meta, },);
        },
    },),
];
