import type {
    SocialPostsQuery, SocialPostsResponse, SocialFeedQuery, SocialFeedResponse,
    SocialPlatformFeedResponse, SocialHomepageResponse, SocialHomepageSetBody,
    SocialHomepageSetResponse, SocialSyncBody, SocialSyncResponse,
    SocialPostDeleteResponse, SocialPlatformPostsQuery, SocialPlatformPostsResponse,
    SocialManualPostBody, SocialManualPostResponse, SocialPostPatchBody,
    SocialPostPatchResponse, SocialEmbedResponse,
} from '@sitesurge/types';
import type { Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /social namespace — stored posts + live feeds + sync + homepage selection. */
export class SocialModule extends ModuleBase {
    protected readonly module = 'social';

    /** GET /social/posts — stored posts across platforms; optional platform filter. */
    listPosts(query?: SocialPostsQuery,): Promise<Paginated<SocialPostsResponse[number]>> {
        return this.getPaged<SocialPostsResponse[number]>('/social/posts', { query: query as Record<string, unknown>, },);
    }

    /** GET /social/posts/:platform — stored posts for one platform. */
    platformPosts(platform: string, query?: SocialPlatformPostsQuery,): Promise<Paginated<SocialPlatformPostsResponse[number]>> {
        return this.getPaged<SocialPlatformPostsResponse[number]>('/social/posts/:platform', { params: { platform, }, query: query as Record<string, unknown>, },);
    }

    /** GET /social/feed — live merged feed (no pagination). */
    feed(query?: SocialFeedQuery,): Promise<SocialFeedResponse> {
        return this.get<SocialFeedResponse>('/social/feed', { query: query as Record<string, unknown>, },);
    }

    /** GET /social/feed/:platform — live feed for one platform. */
    platformFeed(platform: string, query?: SocialFeedQuery,): Promise<SocialPlatformFeedResponse> {
        return this.get<SocialPlatformFeedResponse>('/social/feed/:platform', { params: { platform, }, query: query as Record<string, unknown>, },);
    }

    /** GET /social/homepage — selected (or fallback) homepage posts. */
    homepage(): Promise<SocialHomepageResponse> {
        return this.get<SocialHomepageResponse>('/social/homepage',);
    }

    /** PUT /social/homepage — set the homepage selection. */
    setHomepage(body: SocialHomepageSetBody,): Promise<SocialHomepageSetResponse> {
        return this.mutate<SocialHomepageSetResponse>('PUT', '/social/homepage', { body, invalidates: ['social',], },);
    }

    /** POST /social/sync — sync one platform or all connected providers. */
    sync(body?: SocialSyncBody,): Promise<SocialSyncResponse> {
        return this.mutate<SocialSyncResponse>('POST', '/social/sync', { body, invalidates: ['social',], },);
    }

    /** DELETE /social/posts/:id — remove a stored post. */
    deletePost(id: string,): Promise<SocialPostDeleteResponse> {
        return this.mutate<SocialPostDeleteResponse>('DELETE', '/social/posts/:id', { params: { id, }, invalidates: ['social',], },);
    }

    /** POST /social/posts/manual — capture a post by pasting its URL. */
    addManualPost(body: SocialManualPostBody,): Promise<SocialManualPostResponse> {
        return this.mutate<SocialManualPostResponse>('POST', '/social/posts/manual', { body, invalidates: ['social',], },);
    }

    /** PATCH /social/posts/:id — hide/show or reorder a stored post. */
    patchPost(id: string, body: SocialPostPatchBody,): Promise<SocialPostPatchResponse> {
        return this.mutate<SocialPostPatchResponse>('PATCH', '/social/posts/:id', { params: { id, }, body, invalidates: ['social',], },);
    }

    /** GET /social/posts/:id/embed — resolve a stored post to card / oEmbed. */
    getEmbed(id: string,): Promise<SocialEmbedResponse> {
        return this.get<SocialEmbedResponse>('/social/posts/:id/embed', { params: { id, }, },);
    }
}
