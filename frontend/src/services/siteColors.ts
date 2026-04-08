/**
 * Site colors service — caches the user-configurable color swatches
 * used in the ColorPicker presets throughout the admin UI.
 */
import { api, } from './api';

const DEFAULT_COLORS = [
    '#ffffff',
    '#000000',
    '#e63946',
    '#1d3557',
    '#f1faee',
    '#457b9d',
    '#2a9d8f',
    '#e9c46a',
    '#f4a261',
    '#e76f51',
    '#264653',
    '#6b705c',
    '#a8dadc',
    '#ff006e',
    '#8338ec',
];

let cache: string[] | null = null;
const subscribers = new Set<(colors: string[],) => void>();

export async function getSiteColors(forceRefresh = false,): Promise<string[]> {
    if (cache && !forceRefresh) return cache;

    try {
        const response = await api.get('/settings/site-colors',);
        if (response.success && Array.isArray((response as any).data,)) {
            cache = (response as any).data;
        } else {
            cache = [...DEFAULT_COLORS,];
        }
    } catch {
        cache = [...DEFAULT_COLORS,];
    }
    return cache!;
}

export async function saveSiteColors(colors: string[],): Promise<boolean> {
    const response = await api.put('/settings/site-colors', colors,);
    if (response.success) {
        cache = colors;
        notifySubscribers();
        return true;
    }
    return false;
}

export function invalidateSiteColorsCache(): void {
    cache = null;
}

/** Subscribe to site color changes — returns an unsubscribe function */
export function subscribeSiteColors(fn: (colors: string[],) => void,): () => void {
    subscribers.add(fn,);
    return () => subscribers.delete(fn,);
}

function notifySubscribers(): void {
    if (cache) {
        for (const fn of subscribers) fn(cache,);
    }
}

export const SITE_COLOR_DEFAULTS = DEFAULT_COLORS;
