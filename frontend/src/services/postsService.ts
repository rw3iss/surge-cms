/**
 * PostsService — flexible post querying for the post-list block (and
 * any future feed-style consumer).
 *
 * Wraps `GET /posts` with normalized filter params, sends the
 * request through the generic `requestCache` (short TTL, hash-keyed)
 * so multiple block instances on the same page coalesce into one
 * network round-trip, and returns the typed result.
 *
 * The filter shape mirrors what PostListBlock saves to its block
 * settings, so callers can pass settings objects through with no
 * massaging — except for the `daysAgo` → ISO conversion, which lives
 * here so block consumers don't have to repeat the math.
 */
import type { Post, } from '@rw/cms-shared';
import { api, } from './api';
import { cached, invalidateNamespace, } from './requestCache';

/** Output of a post-list query. The list endpoint optionally hydrates
 *  `contentBlocks` when `withBlocks` is set; in 'short' / 'full' brevity
 *  modes this saves N+1 round-trips. */
export interface PostWithBlocks extends Post {
    contentBlocks?: Array<{
        id: string;
        type: string;
        sortOrder?: number;
        data?: Record<string, unknown>;
        // The repo column is `data` (json), but legacy rows may also
        // surface fields like `title` / `content` at top-level. Renderers
        // are tolerant of either shape.
        title?: string;
        content?: string;
        settings?: Record<string, unknown>;
    }>;
}

export interface PostListFilters {
    /** Max number of posts to return. Default 10. */
    count?: number;
    /** Show posts older than this many days. Translated to a
     *  `published_at < (now - X days)` constraint. */
    afterDaysAgo?: number;
    /** Show posts newer than this many days ago. Translated to a
     *  `published_at > (now - X days)` constraint. */
    beforeDaysAgo?: number;
    /** Free-text search across title + body (server-side full-text). */
    search?: string;
    /** Single tag filter. */
    tag?: string;
    /** Hand-picked post IDs. When provided, all other filters except the
     *  built-in public/published gates apply too. Order is preserved. */
    ids?: string[];
    /** Hydrate `contentBlocks` for each returned post. */
    withBlocks?: boolean;
}

const NAMESPACE = 'posts.list';
const DEFAULT_TTL_MS = 30_000; // 30s — short enough that admin edits surface quickly

/**
 * Translate a "days ago" number into a backend-friendly ISO timestamp.
 *
 * Returns `undefined` (i.e. "no filter") for any non-positive input —
 * including `0`, NaN, negative values, and stale empty-string values
 * that were coerced to a number. The previous behaviour treated `0`
 * as "now", which silently filtered out every post on the site if a
 * 0 ever leaked into the saved settings.
 */
function daysAgoToIso(days: number | undefined,): string | undefined {
    if (days === undefined || days === null) return undefined;
    const n = Number(days,);
    if (!Number.isFinite(n,) || n <= 0) return undefined;
    const t = Date.now() - n * 86400 * 1000;
    return new Date(t,).toISOString();
}

/**
 * Build the query-string params actually sent to the backend. Kept
 * separate so the cache key reflects the wire shape (i.e. two callers
 * passing equivalent `daysAgo` values produce the same hash).
 */
function buildBackendParams(f: PostListFilters,): Record<string, string> {
    const out: Record<string, string> = {};
    if (f.count) out.limit = String(f.count,);
    out.page = '1';
    const beforeIso = daysAgoToIso(f.beforeDaysAgo,);
    const afterIso = daysAgoToIso(f.afterDaysAgo,);
    // beforeDaysAgo (e.g. "5 days ago") = show RECENT posts published
    // after that point. afterDaysAgo (e.g. "30 days ago") = show
    // ARCHIVED posts older than that point. The wire names match the
    // operator's intent: ?after=ISO ⇒ posts published AFTER ISO.
    if (beforeIso) out.after = beforeIso;
    if (afterIso) out.before = afterIso;
    if (f.search?.trim()) out.search = f.search.trim();
    if (f.tag?.trim()) out.tag = f.tag.trim();
    if (f.ids && f.ids.length) out.ids = f.ids.join(',',);
    if (f.withBlocks) out.withBlocks = '1';
    return out;
}

/**
 * Run a post-list query. Returns the post array plus metadata. Cached
 * for `ttlMs` (default 30s) keyed by the normalized backend params.
 */
export async function fetchPostList(
    filters: PostListFilters,
    options: { ttlMs?: number; } = {},
): Promise<{ posts: PostWithBlocks[]; total: number; }> {
    const params = buildBackendParams(filters,);
    const ttl = options.ttlMs ?? DEFAULT_TTL_MS;

    return cached(NAMESPACE, params, ttl, async () => {
        const queryString = new URLSearchParams(params,).toString();
        const response = await api.get<PostWithBlocks[]>(`/posts?${queryString}`,);
        if (!response.success) {
            return { posts: [], total: 0, };
        }
        const data = (response as any).data as PostWithBlocks[] | undefined;
        const meta = (response as any).meta as { total?: number; } | undefined;
        return { posts: Array.isArray(data,) ? data : [], total: meta?.total ?? 0, };
    },);
}

/** Drop every cached post-list entry. Call after creating / editing /
 *  deleting a post so the next render picks up fresh data. */
export function invalidatePostListCache(): void {
    invalidateNamespace(NAMESPACE,);
}
