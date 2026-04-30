/**
 * Generic in-memory cache primitive used by `adminData` and
 * `recentItems`. Exposes a tiny API:
 *
 *   const cache = createEntityCache<MyItem>({
 *       fetch: () => api.get('/things'),
 *       parse: (raw) => raw,            // optional shape transform
 *   });
 *   await cache.get();           // lazy-fetch (cached)
 *   await cache.get(true);       // force-refresh
 *   cache.peek();                // sync read; null if not loaded
 *   cache.invalidate();          // drop cache; re-tick reactive
 *
 * The reactive tick lets components re-read `peek()` from a `createMemo`
 * and refresh on invalidation without piping through a signal manually.
 */
import { createSignal, } from 'solid-js';
import type { ApiResponse, } from '@rw/shared';
import { api, } from './api';

export interface EntityCacheOptions<TItem> {
    /** API path (e.g. '/campaigns', '/forms?sort=created_desc&limit=10'). */
    path: string;
    /** Map the raw API row to the cached shape. Defaults to identity. */
    parse?: (raw: unknown,) => TItem;
}

export interface EntityCache<TItem> {
    get(forceRefresh?: boolean,): Promise<TItem[]>;
    peek(): TItem[] | null;
    invalidate(): void;
}

export function createEntityCache<TItem>(opts: EntityCacheOptions<TItem>,): EntityCache<TItem> {
    let cached: TItem[] | null = null;
    let inflight: Promise<TItem[]> | null = null;
    const [tick, setTick,] = createSignal(0,);
    const parse = opts.parse ?? ((r: unknown,) => r as TItem);

    return {
        get(forceRefresh = false,): Promise<TItem[]> {
            if (cached && !forceRefresh) return Promise.resolve(cached,);
            if (inflight) return inflight;

            inflight = (async () => {
                try {
                    const response = await api.get(opts.path,) as ApiResponse<unknown>;
                    const raw = response.success ? ((response as unknown as { data: unknown[]; }).data ?? []) : [];
                    cached = (raw as unknown[]).map(parse,);
                    setTick(t => t + 1,);
                    return cached;
                } catch {
                    cached = [];
                    setTick(t => t + 1,);
                    return cached;
                } finally {
                    inflight = null;
                }
            })();
            return inflight;
        },

        peek(): TItem[] | null {
            // Touch the signal so callers wrapped in createMemo / effects
            // re-run when the cache is invalidated or a fetch lands.
            void tick();
            return cached;
        },

        invalidate(): void {
            cached = null;
            inflight = null;
            setTick(t => t + 1,);
        },
    };
}
