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

// ─── GET /social/posts/:platform ──────────────────────────────────

/** Query accepted by GET /social/posts/:platform. */
export interface SocialPlatformPostsQuery {
    page?: number;
    limit?: number;
    search?: string;
    sort?: string;
    sortDir?: string;
}

/** GET /social/posts/:platform — stored posts for one platform. Page
 *  meta on the envelope. */
export type SocialPlatformPostsResponse = SocialPost[];
