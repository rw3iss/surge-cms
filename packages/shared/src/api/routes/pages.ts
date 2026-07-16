/**
 * Wire DTOs for the /pages module. Mirrors the /posts module: pages carry
 * blocks, support revisions, and the public slug fetch can yield a
 * CONTENT_LOCKED error (see `ContentLockedDetails` in `./posts`, shared by
 * both modules). Validation schemas live in `packages/api/src/routes/pages.ts`.
 */

import type { Block, BlockType, ContentAccessLevel, NavigationItem, Page, Revision, } from '../../types/content';
import type { BulkActionResult, } from './_shared';

// ─── Entities carried on the wire ─────────────────────────────────
// The `Page` entity already carries `blocks: Block[]`, so the by-id /
// by-slug / homepage endpoints all return `Page` directly — there is no
// separate `PageWithBlocks` shape the way posts need `PostWithBlocks`.

/** A page with its hydrated block tree. Alias of `Page` (which already
 *  embeds `blocks`), named for parity with `PostWithBlocks`. */
export type PageWithBlocks = Page;

// ─── GET /pages/navigation ────────────────────────────────────────

/** GET /pages/navigation — the main navigation tree (public, cached). */
export type PageNavigationResponse = NavigationItem[];

// ─── GET /pages/homepage ──────────────────────────────────────────

/** GET /pages/homepage — the page flagged as homepage, with blocks. */
export type PageHomepageResponse = PageWithBlocks;

// ─── GET /pages/slug/:slug ────────────────────────────────────────

/** Params for GET /pages/slug/:slug. */
export interface PageBySlugParams {
    slug: string;
}

/** Query for GET /pages/slug/:slug. `preview=admin` lets admins see
 *  unpublished pages. */
export interface PageBySlugQuery {
    preview?: string;
}

/**
 * GET /pages/slug/:slug — the resolved page with blocks. Gated content
 * yields a CONTENT_LOCKED error whose `error.details` is the shared
 * `ContentLockedDetails` shape (defined in `./posts`).
 */
export type PageBySlugResponse = PageWithBlocks;

// ─── GET /pages (admin) ───────────────────────────────────────────

/** Query accepted by GET /pages. */
export interface PageListQuery {
    status?: string;
    search?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

/** GET /pages — list items (any status). Page meta rides the ApiResponse
 *  envelope. */
export type PageListResponse = Page[];

// ─── POST /pages/bulk ─────────────────────────────────────────────

/** Body for POST /pages/bulk (unified bulk runner). */
export interface PageBulkBody {
    ids: string[];
    action: 'delete' | 'status';
    /** status value when action='status' */
    value?: string;
}

/** POST /pages/bulk — count + action performed. */
export type PageBulkResponse = BulkActionResult;

// ─── Revisions ────────────────────────────────────────────────────

/** Params for the page-by-id family of routes. */
export interface PageIdParams {
    id: string;
}

/** GET /pages/:id/revisions — saved revision list. */
export type PageRevisionListResponse = Revision[];

/** Params for GET /pages/:id/revisions/:version (+ restore). */
export interface PageRevisionParams {
    id: string;
    version: number;
}

/** GET /pages/:id/revisions/:version — one snapshot. */
export type PageRevisionResponse = Revision;

/** POST /pages/:id/revisions/:version/restore — the restored page. */
export type PageRevisionRestoreResponse = PageWithBlocks;

// ─── Block CRUD ───────────────────────────────────────────────────

/** Body for creating/updating a page block. A client-supplied `id`
 *  (v4 UUID) lets the editor reference a parent before its create
 *  response returns. */
export interface PageBlockBody {
    id?: string;
    parentBlockId?: string | null;
    type: BlockType;
    title?: string;
    content?: string;
    settings?: Record<string, unknown>;
    order?: number;
    isVisible?: boolean;
    style?: Record<string, unknown> | null;
}

/** Params for POST /pages/:pageId/blocks. */
export interface PageBlockCreateParams {
    pageId: string;
}

/** POST /pages/:pageId/blocks (201) — the created block. */
export type PageBlockCreateResponse = Block;

/** Params for PUT|DELETE /pages/:pageId/blocks/:blockId. */
export interface PageBlockParams {
    pageId: string;
    blockId: string;
}

/** Body for PUT /pages/:pageId/blocks/:blockId — partial block body. */
export type PageBlockUpdateBody = Partial<PageBlockBody>;

/** PUT /pages/:pageId/blocks/:blockId — the updated block. */
export type PageBlockUpdateResponse = Block;

/** DELETE /pages/:pageId/blocks/:blockId — confirmation message. */
export interface PageBlockDeleteResponse {
    message: string;
}

// ─── PUT /pages/:pageId/blocks/reorder ────────────────────────────

/** Params for PUT /pages/:pageId/blocks/reorder. */
export interface PageReorderBlocksParams {
    pageId: string;
}

/** Body for PUT /pages/:pageId/blocks/reorder. Reorder is scoped to one
 *  parent; `parentBlockId` null/absent reorders top-level blocks. */
export interface PageReorderBlocksBody {
    blockIds: string[];
    parentBlockId?: string | null;
}

/** PUT /pages/:pageId/blocks/reorder — confirmation message. */
export interface PageReorderBlocksResponse {
    message: string;
}

// ─── GET /pages/:id (admin) ───────────────────────────────────────

/** GET /pages/:id — full page with blocks, any status. */
export type PageByIdResponse = PageWithBlocks;

// ─── POST /pages ──────────────────────────────────────────────────

/** Body for POST /pages (create). */
export interface PageCreateBody {
    slug: string;
    title: string;
    titleAlignment?: 'left' | 'center' | 'right';
    description?: string;
    metaTitle?: string;
    metaDescription?: string;
    metaKeywords?: string[];
    ogImage?: string;
    status?: 'draft' | 'published' | 'scheduled' | 'archived' | 'deleted';
    /** ISO date-time */
    publishAt?: string | null;
    isHomepage?: boolean;
    showTitle?: boolean;
    applyPagePadding?: boolean;
    applySiteGutter?: boolean;
    headerStyle?: 'default' | 'alt';
    showInNav?: boolean;
    navOrder?: number;
    isPrivate?: boolean;
    accessLevel?: ContentAccessLevel;
}

/** POST /pages (201) — the created page with blocks. */
export type PageCreateResponse = PageWithBlocks;

// ─── PUT /pages/:id ───────────────────────────────────────────────

/** Body for PUT /pages/:id — partial create body. */
export type PageUpdateBody = Partial<PageCreateBody>;

/** PUT /pages/:id — the updated page with blocks. */
export type PageUpdateResponse = PageWithBlocks;

// ─── DELETE /pages/:id ────────────────────────────────────────────

/** DELETE /pages/:id — confirmation message. */
export interface PageDeleteResponse {
    message: string;
}
