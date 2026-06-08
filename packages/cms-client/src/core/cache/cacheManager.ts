import type { CacheAdapter, CacheEntry, QueryOptions, } from '../types';
import { Emitter, } from '../events';

interface CacheManagerOpts { adapter: CacheAdapter; enabled: boolean; defaultTtl: number; }

/** SWR cache. read() returns cached data instantly (even stale), kicks a
 *  background revalidation when stale/missing, and notifies subscribers
 *  when the value changes. Mutations call invalidatePrefix(). */
export class CacheManager {
    private adapter: CacheAdapter;
    private enabled: boolean;
    private defaultTtl: number;
    private emitter = new Emitter<Record<string, unknown>>();
    private inFlight = new Map<string, Promise<unknown>>();

    constructor(opts: CacheManagerOpts,) {
        this.adapter = opts.adapter; this.enabled = opts.enabled; this.defaultTtl = opts.defaultTtl;
    }

    subscribe<T>(key: string, cb: (value: T,) => void,): () => void {
        return this.emitter.on(key, cb as (v: unknown,) => void,);
    }

    async read<T>(key: string, fetcher: () => Promise<T>, opts: QueryOptions = {},): Promise<T> {
        if (!this.enabled || opts.cache === false) return fetcher();
        const ttl = opts.ttl ?? this.defaultTtl;
        const cached = await this.adapter.get<T>(key,);
        if (cached) {
            const stale = Date.now() >= cached.expiresAt;
            if (stale) void this.revalidate(key, fetcher, ttl, cached.value,);
            return cached.value;
        }
        return this.revalidate(key, fetcher, ttl, undefined,);
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
