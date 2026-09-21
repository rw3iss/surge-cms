import type { CacheAdapter, CacheEntry, QueryOptions, } from '../types';
import { Emitter, } from '../events';

interface CacheManagerOpts {
    adapter: CacheAdapter;
    enabled: boolean;
    defaultTtl: number;
    /** See {@link DEFAULT_MAX_STALE_MS}. */
    maxStaleMs?: number;
}

/**
 * How long past its expiry an entry may still be served without waiting for a
 * fresh copy. Absolute, not a multiple of the TTL.
 *
 * **Why a bound is needed at all.** `read()` served ANY cached entry however
 * old, on the assumption that the background revalidation would quietly bring
 * it up to date. It does not always: the refreshed value is written to storage
 * and announced on the emitter, but the caller that is rendering right now has
 * already been handed the stale value and returned. With the localStorage
 * adapter the entry then survives reloads, so a page could — and did — render
 * a record that had expired **22 hours earlier**, indefinitely, with no error
 * anywhere to suggest anything was wrong.
 *
 * Invalidation does not save you either: a mutation clears the cache of the
 * browser that performed it and of no other. Every OTHER visitor's copy is
 * bounded by nothing except this rule.
 *
 * **Absolute rather than `ttl × factor`** because a factor collapses to zero
 * at `ttl: 0` — a legitimate setting meaning "always serve instantly, always
 * refresh behind" — and would silently turn that into "always block". The
 * bound should limit how WRONG a value may be, which is a wall-clock quantity
 * and has nothing to do with how long the entry was fresh.
 */
export const DEFAULT_MAX_STALE_MS = 300_000; // 5 minutes

/** SWR cache. read() returns cached data instantly while it is fresh or only
 *  mildly stale, kicks a background revalidation when stale, and BLOCKS on a
 *  fetch once an entry is more than `DEFAULT_MAX_STALE_MS` past expiry.
 *  Notifies subscribers when a revalidated value differs. Mutations call
 *  invalidatePrefix(). */
export class CacheManager {
    private adapter: CacheAdapter;
    private enabled: boolean;
    private defaultTtl: number;
    private maxStaleMs: number;
    private emitter = new Emitter<Record<string, unknown>>();
    private inFlight = new Map<string, Promise<unknown>>();

    constructor(opts: CacheManagerOpts,) {
        this.adapter = opts.adapter; this.enabled = opts.enabled; this.defaultTtl = opts.defaultTtl;
        this.maxStaleMs = opts.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
    }

    subscribe<T>(key: string, cb: (value: T,) => void,): () => void {
        return this.emitter.on(key, cb as (v: unknown,) => void,);
    }

    async read<T>(key: string, fetcher: () => Promise<T>, opts: QueryOptions = {},): Promise<T> {
        if (!this.enabled || opts.cache === false) return fetcher();
        const ttl = opts.ttl ?? this.defaultTtl;
        const cached = await this.adapter.get<T>(key,);
        if (cached) {
            // `Date.now() >= undefined` is false, so an entry with a missing or
            // malformed `expiresAt` — one written by an older build, or a
            // corrupted localStorage row — used to read as permanently FRESH
            // and was served forever without even a background refresh. An
            // entry whose age cannot be established is stale by definition.
            const hasExpiry = typeof cached.expiresAt === 'number';
            const stale = !hasExpiry || Date.now() >= cached.expiresAt;
            // Past the bound, AWAIT a fetch so the caller receives current
            // data. Without this the stale value below is returned
            // unconditionally, and an entry whose revalidation never lands is
            // served forever.
            //
            // On failure fall BACK to the stale value rather than throwing:
            // offline, or against a server that is briefly down, very old data
            // still beats an error — the caller had a usable value a moment
            // ago and nothing is gained by taking it away.
            if (stale && this.tooStale(cached,)) {
                try {
                    return await this.revalidate(key, fetcher, ttl, cached.value,);
                } catch {
                    return cached.value;
                }
            }
            if (stale) {
                // Background refresh, so its failure is nobody's to await.
                //
                // `void` alone left the rejection unhandled: the caller has
                // already been given the cached value and returned, so a 404
                // here surfaced as `Uncaught (in promise)` in the console with
                // no call site able to catch it. A page holding a reference to
                // a record that has since been deleted (a curated product
                // carousel, say) produced one of these per stale entry, per
                // load, forever.
                //
                // Swallowing is correct for a background pass: the caller
                // already has a usable value, and the entry simply stays stale
                // so the next read tries again.
                void this.revalidate(key, fetcher, ttl, cached.value,).catch(() => {});
            }
            return cached.value;
        }
        return this.revalidate(key, fetcher, ttl, undefined,);
    }

    /**
     * Is this entry too far past its TTL to serve without checking?
     *
     * Measured from `expiresAt`, so the allowance is the stale window itself
     * and is independent of how long the entry was fresh. An entry written by
     * an older build may carry no `expiresAt`; treat a missing or malformed
     * timestamp as too stale, because the alternative is serving something of
     * entirely unknown age.
     */
    private tooStale(entry: CacheEntry<unknown>,): boolean {
        if (typeof entry.expiresAt !== 'number') return true;
        return Date.now() - entry.expiresAt > this.maxStaleMs;
    }

    /** Run the fetcher (de-duped per key), write the entry, notify on change. */
    private async revalidate<T>(key: string, fetcher: () => Promise<T>, ttl: number, prev: T | undefined,): Promise<T> {
        const existing = this.inFlight.get(key,) as Promise<T> | undefined;
        if (existing) return existing;
        const p = (async () => {
            try {
                const value = await fetcher();
                const entry: CacheEntry<T> = { value, storedAt: Date.now(), expiresAt: Date.now() + ttl, };
                await this.adapter.set(key, entry,);
                if (prev !== undefined && JSON.stringify(prev,) !== JSON.stringify(value,)) {
                    this.emitter.emit(key, value as never,);
                }
                return value;
            } finally { this.inFlight.delete(key,); }
        })();
        this.inFlight.set(key, p,);
        return p;
    }

    async set<T>(key: string, value: T, ttl?: number,): Promise<void> {
        if (!this.enabled) return;
        const t = ttl ?? this.defaultTtl;
        await this.adapter.set(key, { value, storedAt: Date.now(), expiresAt: Date.now() + t, },);
    }

    async invalidate(key: string,): Promise<void> { await this.adapter.delete(key,); }
    async invalidatePrefix(prefix: string,): Promise<void> { await this.adapter.deletePrefix(prefix,); }
    async clear(): Promise<void> { await this.adapter.clear(); }
}
