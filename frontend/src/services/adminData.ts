/**
 * Lightweight in-memory cache for admin reference data (campaigns, forms, etc.).
 * Loaded once on first access, then served from memory.
 */
import { api, } from './api';

interface CachedItem {
    id: string;
    title: string;
    slug: string;
    status?: string;
    [key: string]: unknown;
}

let campaignsCache: CachedItem[] | null = null;
let formsCache: CachedItem[] | null = null;

export async function getCampaigns(forceRefresh = false,): Promise<CachedItem[]> {
    if (campaignsCache && !forceRefresh) return campaignsCache;

    const response = await api.get('/campaigns',);
    if (response.success) {
        campaignsCache = (response as any).data || [];
    } else {
        campaignsCache = [];
    }
    return campaignsCache!;
}

export async function getForms(forceRefresh = false,): Promise<CachedItem[]> {
    if (formsCache && !forceRefresh) return formsCache;

    const response = await api.get('/forms',);
    if (response.success) {
        formsCache = (response as any).data || [];
    } else {
        formsCache = [];
    }
    return formsCache!;
}

export function invalidateCampaignsCache(): void {
    campaignsCache = null;
}

export function invalidateFormsCache(): void {
    formsCache = null;
}
