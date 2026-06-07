/**
 * Wire DTOs for the /posts module. Plain types only — the zod schemas
 * that validate them live next to the route definitions in
 * `backend/src/routes/posts.ts`.
 */

import type { ContentAccessLevel, } from '../../types/content';

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
