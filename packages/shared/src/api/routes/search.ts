/**
 * Wire DTOs for the /search module. Validation schemas live in
 * `packages/api/src/routes/search.ts`.
 *
 * Both endpoints reply with a `results` map keyed by content type; the
 * total count rides the ApiResponse `meta`. The public surface returns
 * curated projections; the admin surface returns raw row projections,
 * so their result shapes differ.
 */

// ─── GET /api/v1/search (public) ──────────────────────────────────

/** Query for GET /api/v1/search. `q` must be ≥2 chars. */
export interface SearchQuery {
    q: string;
    /** Restrict to one type: 'posts' | 'pages' | 'campaigns'. Omit for all. */
    type?: string;
    page?: number;
    limit?: number;
}

export interface PublicSearchPostHit {
    id: string;
    type: 'post';
    slug: string;
    title: string;
    excerpt: string | null;
    featuredImage: string | null;
    publishedAt: string | null;
    relevance: number;
}

export interface PublicSearchPageHit {
    id: string;
    type: 'page';
    slug: string;
    title: string;
    description: string | null;
    relevance: number;
}

export interface PublicSearchCampaignHit {
    id: string;
    type: 'campaign';
    slug: string;
    title: string;
    description: string | null;
    featuredImage: string | null;
    goalAmountCents: number;
    currentAmountCents: number;
}

/** GET /api/v1/search — grouped public hits. Total on the envelope. */
export interface SearchResponse {
    posts?: PublicSearchPostHit[];
    pages?: PublicSearchPageHit[];
    campaigns?: PublicSearchCampaignHit[];
}

// ─── GET /api/v1/search/admin (admin) ─────────────────────────────

/** Query for GET /api/v1/search/admin. Same shape; broader scope. */
export type AdminSearchQuery = SearchQuery;

/**
 * GET /api/v1/search/admin — grouped raw row projections across all
 * content types, any status. Rows are returned as-queried (snake_case
 * columns), so each group is loosely typed.
 */
export interface AdminSearchResponse {
    posts?: Record<string, unknown>[];
    pages?: Record<string, unknown>[];
    users?: Record<string, unknown>[];
    campaigns?: Record<string, unknown>[];
    forms?: Record<string, unknown>[];
    messages?: Record<string, unknown>[];
}
