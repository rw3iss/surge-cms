/**
 * Admin reference data: full lists of campaigns, forms, posts.
 * Backed by the generic `entityCache` primitive — only the API path
 * and the cached shape live here.
 *
 * Invalidation also busts the AddBlockMenu's recent-items cache for
 * the matching source so submenus stay fresh after a save / delete.
 */
import { createEntityCache, } from './entityCache';
import { invalidateRecent, } from './recentItems';

export interface CachedItem {
    id: string;
    title: string;
    slug: string;
    status?: string;
    [key: string]: unknown;
}

const campaignsCache = createEntityCache<CachedItem>({ path: '/campaigns?all=true', },);
const formsCache = createEntityCache<CachedItem>({ path: '/forms', },);

export const getCampaigns = (forceRefresh = false,): Promise<CachedItem[]> =>
    campaignsCache.get(forceRefresh,);

export const getForms = (forceRefresh = false,): Promise<CachedItem[]> =>
    formsCache.get(forceRefresh,);

export function invalidateCampaignsCache(): void {
    campaignsCache.invalidate();
    invalidateRecent('campaigns',);
}

export function invalidateFormsCache(): void {
    formsCache.invalidate();
    invalidateRecent('forms',);
}

/** Posts have no full-list admin cache (the admin list is paginated),
 *  but the AddBlockMenu's recent-items cache still needs a bust on
 *  save / delete — call this from PostEditor. */
export function invalidatePostsCache(): void {
    invalidateRecent('posts',);
}
