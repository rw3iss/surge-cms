import type {
    RevisionSnapshotResponse, PostTypesResponse, PostLiveStateResponse,
    PostListQuery, PostListResponse, PostSearchQuery, PostSearchResponse,
    PostBySlugQuery, PostBySlugResponse, PostByIdResponse, PostCreateBody,
    PostCreateResponse, PostUpdateBody, PostUpdateResponse, PostDeleteResponse,
    PostBulkBody, PostBulkResponse, PostRevisionListResponse, PostRevisionResponse,
    PostRevisionRestoreResponse, PostReorderBlocksBody, PostReorderBlocksResponse,
} from '@sitesurge/types';
import type { Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /posts namespace — blog posts with content blocks, revisions, reorder. */
export class PostsModule extends ModuleBase {
    protected readonly module = 'posts';

    /** GET /posts — public published list (anon) / admin all-statuses with status|sort. */
    list(query?: PostListQuery,): Promise<Paginated<PostListResponse[number]>> {
        return this.getPaged<PostListResponse[number]>('/posts', { query: query as Record<string, unknown>, },);
    }

    /** GET /posts/search — full-text over published posts. */
    search(query: PostSearchQuery,): Promise<Paginated<PostSearchResponse[number]>> {
        return this.getPaged<PostSearchResponse[number]>('/posts/search', { query: query as unknown as Record<string, unknown>, },);
    }

    /** GET /posts/slug/:slug — throws ContentLockedError on gated content. */
    /** GET /posts/types — registered post types (built-in + site-defined). */
    types(): Promise<PostTypesResponse> {
        return this.get<PostTypesResponse>('/posts/types',);
    }

    /** GET /posts/:id/live — a live show's room state (REST fallback to the WebSocket). */
    liveState(id: string,): Promise<PostLiveStateResponse> {
        return this.get<PostLiveStateResponse>('/posts/:id/live', { params: { id, }, options: { cache: false, }, },);
    }

    getBySlug(slug: string, query?: PostBySlugQuery,): Promise<PostBySlugResponse> {
        return this.get<PostBySlugResponse>('/posts/slug/:slug', { params: { slug, }, query: query as Record<string, unknown>, },);
    }

    /** GET /posts/:id (admin) — full post with blocks, any status. */
    getById(id: string,): Promise<PostByIdResponse> {
        return this.get<PostByIdResponse>('/posts/:id', { params: { id, }, },);
    }

    create(body: PostCreateBody,): Promise<PostCreateResponse> {
        return this.mutate<PostCreateResponse>('POST', '/posts', { body, invalidates: ['posts', 'entities',], },);
    }

    update(id: string, body: PostUpdateBody,): Promise<PostUpdateResponse> {
        return this.mutate<PostUpdateResponse>('PUT', '/posts/:id', { params: { id, }, body, invalidates: ['posts', 'entities',], },);
    }

    remove(id: string,): Promise<PostDeleteResponse> {
        return this.mutate<PostDeleteResponse>('DELETE', '/posts/:id', { params: { id, }, invalidates: ['posts', 'entities',], },);
    }

    bulk(body: PostBulkBody,): Promise<PostBulkResponse> {
        return this.mutate<PostBulkResponse>('POST', '/posts/bulk', { body, invalidates: ['posts', 'entities',], },);
    }

    // ─── Revisions ────────────────────────────────────────────────
    listRevisions(id: string,): Promise<PostRevisionListResponse> {
        // Never served from the SWR cache: the editor re-reads this the moment a
        // save finishes, and a stale hit would show the list WITHOUT the version
        // just saved — the exact thing the refetch exists to display.
        return this.get<PostRevisionListResponse>('/posts/:id/revisions', {
            params: { id, }, options: { cache: false, },
        },);
    }

    getRevision(id: string, version: number,): Promise<PostRevisionResponse> {
        return this.get<PostRevisionResponse>('/posts/:id/revisions/:version', { params: { id, version, }, },);
    }

    /** Snapshot the post as it is now — see the pages equivalent. */
    snapshotRevision(id: string,): Promise<RevisionSnapshotResponse> {
        return this.mutate<RevisionSnapshotResponse>('POST', '/posts/:id/revisions', { params: { id, }, },);
    }

    restoreRevision(id: string, version: number,): Promise<PostRevisionRestoreResponse> {
        return this.mutate<PostRevisionRestoreResponse>('POST', '/posts/:id/revisions/:version/restore', { params: { id, version, }, invalidates: ['posts', 'entities',], },);
    }

    reorderBlocks(id: string, body: PostReorderBlocksBody,): Promise<PostReorderBlocksResponse> {
        return this.mutate<PostReorderBlocksResponse>('PUT', '/posts/:id/blocks/reorder', { params: { id, }, body, invalidates: ['posts', 'entities',], },);
    }
}
