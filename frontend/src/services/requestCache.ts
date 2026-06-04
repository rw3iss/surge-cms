/**
 * Generic in-memory request cache with TTL + parameter hashing.
 *
 * Usage:
 *
 *   const result = await cached(
 *       'posts.list',
 *       { tag: 'news', limit: 10 },
 *       30_000,
 *       () => api.get('/posts?...'),
 *   );
 *
 * The same `(namespace, params)` pair returns the cached result while
 * the entry is still fresh (within `ttlMs`); after that the fetcher
 * runs again and the cache is replaced.
 *
 * Caches are keyed by a stable hash of the parameter object — keys are
 * sorted before serialization so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }`
 * collapse to the same entry. Nested arrays/objects are walked
 * recursively. Functions and symbols are dropped.
 *
 * Concurrency: in-flight fetches are deduped — if two callers ask for
 * the same key while a fetch is pending, both receive the same Promise
 * and only one network call goes out.
 *
 * Designed as a one-stop shop for any service that wants short-lived
 * memoization (PostsService is the first user; siteSettings / swatch
 * services are bigger custom stores and don't need this).
 */

interface CacheEntry<T = unknown> {
    value: T;
    expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Stable JSON serialization. Object keys are sorted at every nesting
 * level so two structurally-equal objects with different key orders
 * produce the same string. Arrays preserve order (their order is
 * meaningful). Undefined values and functions are dropped — they would
 * vanish from JSON anyway, but we want consistent behavior across
 * platforms.
 */
function stableStringify(value: unknown,): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value,);
    }
    if (Array.isArray(value,)) {
        return '[' + value.map(stableStringify,).join(',',) + ']';
    }
    const keys = Object.keys(value as Record<string, unknown>,).toSorted();
    const parts: string[] = [];
    for (const k of keys) {
        const v = (value as Record<string, unknown>)[k];
        if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'undefined') continue;
        parts.push(JSON.stringify(k,) + ':' + stableStringify(v,),);
    }
    return '{' + parts.join(',',) + '}';
}

/** Public hash helper — exposed in case callers want the same key
 *  derivation for their own bookkeeping. */
export function paramHash(params: unknown,): string {
    return stableStringify(params,);
}

/**
 * Run `fetcher` and cache the resolved value under
 * `${namespace}:${paramHash(params)}` for `ttlMs` milliseconds.
 *
 * If the cached entry is still fresh, the fetcher does not run.
 * If a different caller is already fetching the same key, the
 * in-flight Promise is shared.
 */
export async function cached<T,>(
    namespace: string,
    params: unknown,
    ttlMs: number,
    fetcher: () => Promise<T>,
): Promise<T> {
    const key = `${namespace}:${paramHash(params,)}`;
    const now = Date.now();
    const hit = cache.get(key,);
    if (hit && hit.expiresAt > now) {
        return hit.value as T;
    }

    const pending = inflight.get(key,);
    if (pending) return pending as Promise<T>;

    const p = (async () => {
        try {
            const value = await fetcher();
            cache.set(key, { value, expiresAt: Date.now() + ttlMs, },);
            return value;
        } finally {
            inflight.delete(key,);
        }
    })();
    inflight.set(key, p,);
    return p;
}

/** Invalidate every cached entry under a namespace. Used after writes
 *  so the next read picks up fresh data. */
export function invalidateNamespace(namespace: string,): void {
    const prefix = `${namespace}:`;
    // Map iteration is safe with concurrent delete of the current key
    // (the spec guarantees a deleted-while-iterating key is skipped),
    // so we don't need to snapshot the key set first.
    for (const k of cache.keys()) {
        if (k.startsWith(prefix,)) cache.delete(k,);
    }
}

/** Invalidate one specific cached entry. */
export function invalidate(namespace: string, params: unknown,): void {
    cache.delete(`${namespace}:${paramHash(params,)}`,);
}

/** Drop the entire cache (useful on logout / settings flush). */
export function clearAll(): void {
    cache.clear();
    inflight.clear();
}
