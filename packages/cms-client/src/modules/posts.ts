import type {
    RevisionSnapshotResponse, PostTypesResponse, PostLiveStateResponse, PostLiveTicketResponse, PostsSettingsResponse, PostsSettingsBody, LivePublishInfo, LivePlaybackInfo, LiveRecording,
    PostLiveRecordingStartBody, PostLiveRecordingPartUrlResponse,
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
    /** GET /posts/settings (staff) — General / per-type / Live Show provider settings (secrets masked) + provider catalogue. */
    settings(): Promise<PostsSettingsResponse> {
        return this.get<PostsSettingsResponse>('/posts/settings', { options: { cache: false, }, },);
    }

    /** PUT /posts/settings (admin, `posts.settings:write`) — partial; an echoed secret mask keeps the stored secret. */
    updateSettings(body: PostsSettingsBody,): Promise<PostsSettingsResponse> {
        return this.mutate<PostsSettingsResponse>('PUT', '/posts/settings', { body, },);
    }

    /** GET /posts/types — registered post types (built-in + site-defined). */
    types(): Promise<PostTypesResponse> {
        return this.get<PostTypesResponse>('/posts/types',);
    }

    /** POST /posts/:id/live/ticket — the signed per-room token live commands carry. */
    liveTicket(id: string,): Promise<PostLiveTicketResponse> {
        return this.mutate<PostLiveTicketResponse>('POST', '/posts/:id/live/ticket', { params: { id, }, },);
    }

    /** POST /posts/:id/live/publish (host) — the provider ingest (WHIP) for the host's camera. */
    livePublish(id: string,): Promise<LivePublishInfo> {
        return this.mutate<LivePublishInfo>('POST', '/posts/:id/live/publish', { params: { id, }, },);
    }

    /** GET /posts/:id/live/playback — how to watch the live stream (WHEP/HLS), for permitted viewers. */
    livePlayback(id: string,): Promise<LivePlaybackInfo> {
        return this.get<LivePlaybackInfo>('/posts/:id/live/playback', { params: { id, }, options: { cache: false, }, },);
    }

    /** Browser recording of a live show (host): start/resume, part URLs, complete, abort. */
    readonly liveRecording = {
        /** GET /posts/:id/live/recording — the open (or latest) recording, null when none. */
        get: (id: string,): Promise<LiveRecording | null> =>
            this.get<LiveRecording | null>('/posts/:id/live/recording', { params: { id, }, options: { cache: false, }, },),
        /** POST /posts/:id/live/recording — start, or resume the open one. */
        start: (id: string, body: PostLiveRecordingStartBody,): Promise<LiveRecording> =>
            this.mutate<LiveRecording>('POST', '/posts/:id/live/recording', { params: { id, }, body, },),
        /** POST /posts/:id/live/recording/:rid/part-url — presigned PUT for one part. */
        partUrl: (id: string, rid: string, partNumber: number,): Promise<PostLiveRecordingPartUrlResponse> =>
            this.mutate<PostLiveRecordingPartUrlResponse>('POST', '/posts/:id/live/recording/:rid/part-url', { params: { id, rid, }, body: { partNumber, }, },),
        /** POST /posts/:id/live/recording/:rid/complete — assemble the parts → video media (encoded into the replay). */
        complete: (id: string, rid: string,): Promise<LiveRecording> =>
            this.mutate<LiveRecording>('POST', '/posts/:id/live/recording/:rid/complete', { params: { id, rid, }, invalidates: ['posts', 'media',], },),
        /** DELETE /posts/:id/live/recording/:rid — discard. */
        abort: (id: string, rid: string,): Promise<{ message: string; }> =>
            this.mutate<{ message: string; }>('DELETE', '/posts/:id/live/recording/:rid', { params: { id, rid, }, },),
    };

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
