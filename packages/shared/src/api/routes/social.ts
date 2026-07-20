/**
 * Wire DTOs for the /social module. Validation schemas live in
 * `packages/api/src/routes/social.ts`.
 */

import type { SocialPlatform, SocialPost, } from '../../types/content';

// ─── GET /social/posts ────────────────────────────────────────────

/** Query accepted by GET /social/posts. */
export interface SocialPostsQuery {
    platform?: string;
    page?: number;
    limit?: number;
}

/** GET /social/posts — stored posts across platforms. Page meta on the
 *  envelope. */
export type SocialPostsResponse = SocialPost[];

// ─── GET /social/feed ─────────────────────────────────────────────

/** Query accepted by GET /social/feed and GET /social/feed/:platform. */
export interface SocialFeedQuery {
    limit?: number;
}

/** GET /social/feed — live merged feed (no pagination meta). */
export type SocialFeedResponse = SocialPost[];

// ─── GET /social/feed/:platform ───────────────────────────────────

/** Params for the platform-scoped feed/posts routes. */
export interface SocialPlatformParams {
    platform: string;
}

/** GET /social/feed/:platform — live feed for one platform. */
export type SocialPlatformFeedResponse = SocialPost[];

// ─── GET /social/homepage ─────────────────────────────────────────

/** GET /social/homepage — the selected (or fallback) homepage posts. */
export type SocialHomepageResponse = SocialPost[];

// ─── PUT /social/homepage ─────────────────────────────────────────

/** Body for PUT /social/homepage. */
export interface SocialHomepageSetBody {
    postIds: string[];
}

/** PUT /social/homepage — confirmation message. */
export interface SocialHomepageSetResponse {
    message: string;
}

// ─── POST /social/sync ────────────────────────────────────────────

/** Body for POST /social/sync. Omit `platform` to sync every connected
 *  provider. */
export interface SocialSyncBody {
    platform?: SocialPlatform;
}

/** POST /social/sync — per-platform count of posts synced, keyed by
 *  platform name. */
export interface SocialSyncResponse {
    message: string;
    results: Record<string, number>;
}

// ─── DELETE /social/posts/:id ─────────────────────────────────────

/** Params for DELETE /social/posts/:id. */
export interface SocialPostDeleteParams {
    id: string;
}

/** DELETE /social/posts/:id — confirmation message. */
export interface SocialPostDeleteResponse {
    message: string;
}

// ─── POST /social/posts/manual ────────────────────────────────────

/** Body for POST /social/posts/manual — capture a post by pasting its URL. */
export interface SocialManualPostBody {
    url: string;
}

/** POST /social/posts/manual — the stored post. */
export type SocialManualPostResponse = SocialPost;

// ─── PATCH /social/posts/:id ──────────────────────────────────────

/** Params for PATCH /social/posts/:id. */
export interface SocialPostPatchParams {
    id: string;
}

/** Body for PATCH /social/posts/:id — curate a stored post. */
export interface SocialPostPatchBody {
    isHidden?: boolean;
    sortOrder?: number;
}

/** PATCH /social/posts/:id — confirmation message. */
export interface SocialPostPatchResponse {
    message: string;
}

// ─── GET /social/posts/:id/embed ──────────────────────────────────

/** Params for GET /social/posts/:id/embed. */
export interface SocialEmbedParams {
    id: string;
}

/** GET /social/posts/:id/embed — a renderable card or sanitized oEmbed HTML. */
export interface SocialEmbedResponse {
    mode: 'card' | 'oembed';
    html?: string;
    card?: SocialPost;
}

// ─── GET /social/posts/:platform ──────────────────────────────────

/** Query accepted by GET /social/posts/:platform. */
export interface SocialPlatformPostsQuery {
    page?: number;
    limit?: number;
    search?: string;
    sort?: string;
    sortDir?: string;
    /** Admin-only: include hidden posts (for curation). Ignored for anon. */
    includeHidden?: boolean;
}

/** GET /social/posts/:platform — stored posts for one platform. Page
 *  meta on the envelope. */
export type SocialPlatformPostsResponse = SocialPost[];
