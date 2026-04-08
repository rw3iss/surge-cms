import type { SiteSettings, } from '@surge/shared';
import { createSignal, } from 'solid-js';
import { fetchSettings, } from '../services/api';

/**
 * Global site settings singleton.
 *
 * Fetches /settings/public once on first access and caches the result.
 * Components that need the dynamic site name, description, logo, etc.
 * can read it synchronously via `siteSettings()`.
 *
 * During server-side rendering or before the first fetch completes,
 * `siteSettings()` returns `null` — callers should fall back to
 * `DEFAULT_SITE_NAME`.
 */

export const DEFAULT_SITE_NAME = 'Surge Media';
export const DEFAULT_SITE_DESCRIPTION = 'Independent journalism for the people';

const [siteSettings, setSiteSettings,] = createSignal<SiteSettings | null>(null,);
let fetchPromise: Promise<SiteSettings | null> | null = null;

/**
 * Load settings if not already loaded. Safe to call many times —
 * subsequent calls return the in-flight promise.
 */
export function loadSiteSettings(): Promise<SiteSettings | null> {
    if (siteSettings()) return Promise.resolve(siteSettings(),);
    if (fetchPromise) return fetchPromise;
    fetchPromise = (async () => {
        try {
            const response = await fetchSettings();
            if (response.success && response.data) {
                const data = response.data as SiteSettings;
                setSiteSettings(data,);
                return data;
            }
        } catch {
            /* ignore, caller uses defaults */
        }
        return null;
    })();
    return fetchPromise;
}

/** Current site settings — null until loaded. */
export { siteSettings, };

/** Current site name with fallback to the default. */
export function siteName(): string {
    return siteSettings()?.siteName || DEFAULT_SITE_NAME;
}

/** Current site description with fallback to the default. */
export function siteDescription(): string {
    return siteSettings()?.siteDescription || DEFAULT_SITE_DESCRIPTION;
}

/** Site logo URL, if set. */
export function siteLogo(): string | undefined {
    return siteSettings()?.logo;
}

/**
 * Format a page title as "{Site Name} - {Page Title}".
 * If `pageTitle` is empty, returns just the site name.
 * If `pageTitle` already starts with the site name, returns it unchanged.
 */
export function formatPageTitle(pageTitle?: string | null,): string {
    const site = siteName();
    if (!pageTitle || !pageTitle.trim()) return site;
    const t = pageTitle.trim();
    if (t === site || t.startsWith(`${site} -`,) || t.startsWith(`${site} |`,)) return t;
    return `${site} - ${t}`;
}
