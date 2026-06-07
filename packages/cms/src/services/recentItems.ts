/**
 * Recent-items cache for AddBlockMenu submenus.
 *
 * Lazily fetches the N most recent campaigns / forms / posts the first
 * time a submenu opens; caches per-source until explicitly invalidated.
 * Invalidation hooks live in the relevant editors (CampaignEditor /
 * FormEditor / PostEditor) and fire on save + delete so the next menu
 * open re-fetches.
 *
 * The backend list endpoints already support sort + limit, so this is
 * a thin client cache — no extra API surface needed.
 */
import { createSignal, } from 'solid-js';
import { api, } from './api';
import type { RecentSource, } from '../config/blockTypes';

export interface RecentItem {
    id: string;
    title: string;
    slug?: string;
    /** ISO timestamp — used for diagnostic logs only. */
    updatedAt?: string;
}

const LIMIT = 10;

// The admin list endpoints use slightly different query shapes:
//   • /posts:     ?sort=date_desc       (single string switched in repo)
//   • /campaigns: ?sortBy=created_at&sortOrder=desc
//   • /forms:     ?sortBy=updated_at&sortOrder=desc
// All accept `?limit=N`. We pin "newest-first, top 10" explicitly so
// the submenu order doesn't depend on the route's default.
const ENDPOINTS: Record<RecentSource, string> = {
    campaigns: '/campaigns?all=true&sortBy=created_at&sortOrder=desc&limit=10',
    forms: '/forms?all=true&sortBy=updated_at&sortOrder=desc&limit=10',
    posts: '/posts?sort=date_desc&limit=10',
};

interface CacheEntry {
    data: RecentItem[];
    fetchedAt: number;
}

const cache = new Map<RecentSource, CacheEntry>();
const inflight = new Map<RecentSource, Promise<RecentItem[]>>();

// Reactive signal so menu components re-render when a fetch completes
// or the cache is busted. The value is just a tick — consumers read
// `getRecent` after touching it.
const [tick, setTick,] = createSignal(0,);

export function getRecent(source: RecentSource,): RecentItem[] | null {
    void tick();
    return cache.get(source,)?.data ?? null;
}

export function fetchRecent(source: RecentSource,): Promise<RecentItem[]> {
    const existing = inflight.get(source,);
    if (existing) return existing;

    const p = (async () => {
        try {
            const response = await api.get(ENDPOINTS[source],);
            if (!response.success) return [];
            const raw = ((response as any).data ?? []) as Array<Record<string, unknown>>;
            const items: RecentItem[] = raw.slice(0, LIMIT,).map(r => ({
                id: String(r.id,),
                title: String(r.title ?? r.name ?? r.slug ?? '(untitled)',),
                slug: r.slug ? String(r.slug,) : undefined,
                updatedAt: r.updatedAt ? String(r.updatedAt,) : undefined,
            }),);
            cache.set(source, { data: items, fetchedAt: Date.now(), },);
            setTick(t => t + 1,);
            return items;
        } catch {
            cache.set(source, { data: [], fetchedAt: Date.now(), },);
            setTick(t => t + 1,);
            return [];
        } finally {
            inflight.delete(source,);
        }
    })();

    inflight.set(source, p,);
    return p;
}

/** Drop the cache for one source (e.g. after the admin saves a new
 *  campaign) so the next submenu open re-fetches. */
export function invalidateRecent(source: RecentSource,): void {
    cache.delete(source,);
    inflight.delete(source,);
    setTick(t => t + 1,);
}

/** Drop every cached source. Used on logout / admin-context teardown. */
export function clearRecentCache(): void {
    cache.clear();
    inflight.clear();
    setTick(t => t + 1,);
}
