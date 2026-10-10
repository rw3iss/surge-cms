/**
 * /api/v1/forum — categories, threads and the forum settings. A thread's
 * replies are read/written through /api/v1/discussions with
 * `target = forum_thread:<id>`.
 */
import type { ForumCategory, ForumSettings, ForumThread, ForumThreadDetail, ForumThreadStatus, } from '../../types/forum';

export type ForumSettingsResponse = ForumSettings;
export type ForumSettingsBody = Partial<ForumSettings>;

// ─── Categories ──────────────────────────────────────────────────────

export type ForumCategoriesResponse = ForumCategory[];

export interface ForumCategoryBody {
    name: string;
    slug?: string;
    description?: string | null;
    parentId?: string | null;
    readMinRank?: number | null;
    postMinRank?: number | null;
    locked?: boolean;
    sortOrder?: number;
}
export type ForumCategoryResponse = ForumCategory;
export interface ForumCategoryReorderBody { ids: string[]; }

// ─── Threads ─────────────────────────────────────────────────────────

export interface ForumThreadsQuery {
    page?: number;
    limit?: number;
}
/** GET /forum/categories/:slug/threads — pinned first, then by last activity. */
export interface ForumCategoryThreadsResponse {
    category: ForumCategory;
    threads: ForumThread[];
}

/** GET /forum/threads (staff) — every thread, filterable. */
export interface ForumAdminThreadsQuery {
    status?: ForumThreadStatus | 'all';
    category?: string;
    search?: string;
    pinned?: boolean;
    page?: number;
    limit?: number;
}
export type ForumAdminThreadsResponse = ForumThread[];

export type ForumThreadDetailResponse = ForumThreadDetail;

export interface ForumThreadCreateBody {
    categoryId: string;
    title: string;
    body: string;
}
export type ForumThreadCreateResponse = ForumThreadDetail;

export interface ForumThreadUpdateBody {
    title?: string;
    categoryId?: string;
}

export type ForumThreadAction = 'pin' | 'unpin' | 'lock' | 'unlock' | 'approve' | 'hide' | 'restore' | 'delete';
export interface ForumThreadActResponse { id: string; status: ForumThreadStatus; pinned: boolean; locked: boolean; }
