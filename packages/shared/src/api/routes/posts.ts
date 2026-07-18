/**
 * Wire DTOs for the /posts module. Plain types only — the zod schemas
 * that validate them live next to the route definitions in
 * `packages/api/src/routes/posts.ts`.
 */

import type { ContentAccessLevel, Post, Revision, } from '../../types/content';
import type { BulkActionResult, } from './_shared';

// ─── Entities carried on the wire ─────────────────────────────────
// `PostWithBlocks` is the wire shape returned by the admin/by-id and
// by-slug endpoints. It lives in shared (not the API repo) so every
// consumer types against one definition.

/** A post content block as stored/returned for the post body. */
export interface PostContentBlock {
    id: string;
    type: string;
    sortOrder: number;
    data: Record<string, unknown>;
}

/** A post plus its hydrated content blocks. */
export interface PostWithBlocks extends Post {
    contentBlocks: PostContentBlock[];
    blockCount?: number;
}

// ─── GET /posts ───────────────────────────────────────────────────

/** Query accepted by GET /posts. */
export interface PostListQuery {
    page?: number;
    limit?: number;
    /** public filters */
    tag?: string;
    category?: string;
    search?: string;
    /** ISO dates — published-before / published-after */
    before?: string;
    after?: string;
    /** comma-separated post ids (pinned feeds) */
    ids?: string;
    /** '1' | 'true' to include content blocks in list items */
    withBlocks?: string;
    /** admin-only: presence of status or sort switches to the admin
     *  (all-statuses) listing. 'all' or '' means no status filter. */
    status?: string;
    sort?: string;
}

/** GET /posts — list items (public gate or admin all-statuses). Page meta
 *  rides the ApiResponse envelope. */
export type PostListResponse = Post[];

// ─── GET /posts/search ────────────────────────────────────────────

/** Query accepted by GET /posts/search. */
export interface PostSearchQuery {
    q: string;
    page?: number;
    limit?: number;
}

/** GET /posts/search — full-text matches. Page meta on the envelope. */
export type PostSearchResponse = Post[];

// ─── GET /posts/slug/:slug ────────────────────────────────────────

/** Params for GET /posts/slug/:slug. */
export interface PostBySlugParams {
    slug: string;
}

/** Query for GET /posts/slug/:slug. `preview=admin` lets admins see drafts. */
export interface PostBySlugQuery {
    preview?: string;
}

/** GET /posts/slug/:slug — the resolved post with blocks. */
export type PostBySlugResponse = PostWithBlocks;

/** details payload on a CONTENT_LOCKED error from GET /posts/slug/:slug */
export interface ContentLockedDetails {
    locked: true;
    accessLevel: ContentAccessLevel;
    preview: {
        title: string;
        description: string | null;
        featuredImage: string | null;
    };
}

// ─── POST /posts/bulk ─────────────────────────────────────────────

/** Body for POST /posts/bulk. */
export interface PostBulkBody {
    ids: string[];
    action: 'delete' | 'status';
    /** status value when action='status' */
    value?: string;
}

/** POST /posts/bulk — count + action performed. */
export type PostBulkResponse = BulkActionResult;

// ─── GET /posts/:id (admin) ───────────────────────────────────────

/** Params for the post-by-id family of routes. */
export interface PostIdParams {
    id: string;
}

/** GET /posts/:id — full post with blocks, any status. */
export type PostByIdResponse = PostWithBlocks;

// ─── POST /posts ──────────────────────────────────────────────────

/** Body for POST /posts (create). */
export interface PostCreateBody {
    slug: string;
    title: string;
    excerpt?: string;
    content?: string;
    /** Banner/featured image URL. `null` clears it. */
    featuredImage?: string | null;
    /** Post author = a staff user id. `null` clears; omitted on create
     *  defaults to the creating user. */
    authorId?: string | null;
    status?: 'draft' | 'published' | 'scheduled' | 'archived' | 'deleted';
    publishAt?: string | null;
    isPrivate?: boolean;
    accessLevel?: ContentAccessLevel;
    tags?: string[];
    categories?: string[];
    metaTitle?: string;
    metaDescription?: string;
    publishedAt?: string;
    applyPostPadding?: boolean;
    applySiteGutter?: boolean;
    headerStyle?: 'default' | 'alt';
    headerPosition?: 'static' | 'float';
    bannerLayout?: 'hero' | 'standalone' | 'thumbnail';
    contentBlocks?: PostCreateContentBlock[];
}

/** A content block as supplied on create/update. */
export interface PostCreateContentBlock {
    id?: string;
    type:
        | 'text' | 'rich_text' | 'social' | 'image' | 'video'
        | 'document' | 'url_link' | 'hero' | 'html' | 'campaign'
        | 'form' | 'post' | 'post_list' | 'gallery' | 'carousel' | 'spacer';
    sort_order: number;
    data?: Record<string, unknown>;
}

/** POST /posts (201) — the created post with blocks. */
export type PostCreateResponse = PostWithBlocks;

// ─── PUT /posts/:id ───────────────────────────────────────────────

/** Body for PUT /posts/:id — partial create body. */
export type PostUpdateBody = Partial<PostCreateBody>;

/** PUT /posts/:id — the updated post with blocks. */
export type PostUpdateResponse = PostWithBlocks;

// ─── DELETE /posts/:id ────────────────────────────────────────────

/** DELETE /posts/:id — confirmation message. */
export interface PostDeleteResponse {
    message: string;
}

// ─── Revisions ────────────────────────────────────────────────────

/** GET /posts/:id/revisions — saved revision list. */
export type PostRevisionListResponse = Revision[];

/** Params for GET /posts/:id/revisions/:version (+ restore). */
export interface PostRevisionParams {
    id: string;
    version: number;
}

/** GET /posts/:id/revisions/:version — one snapshot. */
export type PostRevisionResponse = Revision;

/** POST /posts/:id/revisions/:version/restore — the restored post. */
export type PostRevisionRestoreResponse = PostWithBlocks;

// ─── PUT /posts/:id/blocks/reorder ────────────────────────────────

/** Body for PUT /posts/:id/blocks/reorder. */
export interface PostReorderBlocksBody {
    blockIds: string[];
}

/** PUT /posts/:id/blocks/reorder — confirmation message. */
export interface PostReorderBlocksResponse {
    message: string;
}
