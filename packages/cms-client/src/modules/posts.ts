import type {
    PostListQuery, PostListResponse, PostSearchQuery, PostSearchResponse,
    PostBySlugQuery, PostBySlugResponse, PostByIdResponse, PostCreateBody,
    PostCreateResponse, PostUpdateBody, PostUpdateResponse, PostDeleteResponse,
    PostBulkBody, PostBulkResponse, PostRevisionListResponse, PostRevisionResponse,
    PostRevisionRestoreResponse, PostReorderBlocksBody, PostReorderBlocksResponse,
} from '@rw/cms-shared';
import { ModuleBase, } from './base';

/** /posts namespace — blog posts with content blocks, revisions, reorder. */
export class PostsModule extends ModuleBase {
    protected readonly module = 'posts';

    /** GET /posts — public published list (anon) / admin all-statuses with status|sort. */
    list(query?: PostListQuery,): Promise<PostListResponse> {
        return this.get<PostListResponse>('/posts', { query: query as Record<string, unknown>, },);
    }

    /** GET /posts/search — full-text over published posts. */
    search(query: PostSearchQuery,): Promise<PostSearchResponse> {
        return this.get<PostSearchResponse>('/posts/search', { query: query as unknown as Record<string, unknown>, },);
    }

    /** GET /posts/slug/:slug — throws ContentLockedError on gated content. */
    getBySlug(slug: string, query?: PostBySlugQuery,): Promise<PostBySlugResponse> {
        return this.get<PostBySlugResponse>('/posts/slug/:slug', { params: { slug, }, query: query as Record<string, unknown>, },);
    }

    /** GET /posts/:id (admin) — full post with blocks, any status. */
    getById(id: string,): Promise<PostByIdResponse> {
        return this.get<PostByIdResponse>('/posts/:id', { params: { id, }, },);
    }

    create(body: PostCreateBody,): Promise<PostCreateResponse> {
        return this.mutate<PostCreateResponse>('POST', '/posts', { body, invalidates: ['posts',], },);
    }

    update(id: string, body: PostUpdateBody,): Promise<PostUpdateResponse> {
        return this.mutate<PostUpdateResponse>('PUT', '/posts/:id', { params: { id, }, body, invalidates: ['posts',], },);
    }

    remove(id: string,): Promise<PostDeleteResponse> {
        return this.mutate<PostDeleteResponse>('DELETE', '/posts/:id', { params: { id, }, invalidates: ['posts',], },);
    }

    bulk(body: PostBulkBody,): Promise<PostBulkResponse> {
        return this.mutate<PostBulkResponse>('POST', '/posts/bulk', { body, invalidates: ['posts',], },);
    }

    // ─── Revisions ────────────────────────────────────────────────
    listRevisions(id: string,): Promise<PostRevisionListResponse> {
        return this.get<PostRevisionListResponse>('/posts/:id/revisions', { params: { id, }, },);
    }

    getRevision(id: string, version: number,): Promise<PostRevisionResponse> {
        return this.get<PostRevisionResponse>('/posts/:id/revisions/:version', { params: { id, version, }, },);
    }

    restoreRevision(id: string, version: number,): Promise<PostRevisionRestoreResponse> {
        return this.mutate<PostRevisionRestoreResponse>('POST', '/posts/:id/revisions/:version/restore', { params: { id, version, }, invalidates: ['posts',], },);
    }

    reorderBlocks(id: string, body: PostReorderBlocksBody,): Promise<PostReorderBlocksResponse> {
        return this.mutate<PostReorderBlocksResponse>('PUT', '/posts/:id/blocks/reorder', { params: { id, }, body, invalidates: ['posts',], },);
    }
}
