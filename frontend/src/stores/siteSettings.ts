import type { SiteSettings, } from '@rw/cms-shared';
import { createSignal, } from 'solid-js';
import { fetchSettings, } from '../services/api';
import { FEATURES, FeatureConfig, FeatureKey, getDependents as registryDependents, getFeature, } from '../config/features';

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

export const DEFAULT_SITE_NAME = 'RW';
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

/**
 * Force-refresh the cached settings. Called by the admin Settings
 * page after a successful save so the public Header / SiteLogo /
 * footer pick up the new logo / name / tagline immediately, instead
 * of waiting for a hard reload (the previous bug). Kept separate
 * from `loadSiteSettings()` so the lazy-load fast path stays cheap.
 */
export async function reloadSiteSettings(): Promise<SiteSettings | null> {
    fetchPromise = null;
    setSiteSettings(null,);
    return loadSiteSettings();
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

/** Optional tagline. Undefined when no tagline was configured — callers
 * should hide the rendering rather than substitute a default, so the
 * "Tagline (optional)" wizard field is honored. */
export function siteTagline(): string | undefined {
    return siteSettings()?.siteTagline;
}

/**
 * Whether the Patreon-driven membership flow should be shown to users.
 * Computed server-side as `admin_enabled AND provider_connected`; the
 * frontend just reads it. Defaults to `false` while settings load OR
 * when either condition is unmet, so UI that predicates on "Patreon
 * ready" stays hidden during the brief window before
 * `/settings/public` resolves.
 */
export function isPatreonEnabled(): boolean {
    return Boolean(siteSettings()?.features?.patreon.enabled,);
}

/**
 * Generic feature-flag accessor. Reads `siteSettings().features.<key>`
 * and returns the `enabled` boolean. Module flags (posts/campaigns/
 * forms/messages) default to `true` while settings haven't loaded so
 * the admin sidebar doesn't briefly hide all its links on first paint.
 * Provider flags (patreon) default to `false` for the opposite reason
 * — we don't want a Patreon login button to flash before we know
 * whether it should be there.
 */
const MODULE_FEATURES: ReadonlySet<string> = new Set(['posts', 'campaigns', 'forms', 'messages',],);

export function isFeatureEnabled(key: string,): boolean {
    const features = siteSettings()?.features;
    if (!features) {
        // Pre-load default: keep core modules visible, hide providers.
        return MODULE_FEATURES.has(key,);
    }
    const f = (features as unknown as Record<string, { enabled: boolean; }>)[key];
    return Boolean(f?.enabled,);
}

// ─── Feature dependency helpers ─────────────────────────────────────

export function getFeatureConfig(key: FeatureKey,): FeatureConfig {
    return getFeature(key,);
}

/** Prerequisites declared by `key` that aren't currently enabled. */
export function getMissingPrerequisites(key: FeatureKey,): FeatureKey[] {
    const cfg = getFeature(key,);
    return (cfg.requires ?? []).filter((r,) => !isFeatureEnabled(r,),);
}

/** Currently-enabled features that declare `key` as a prerequisite. */
export function getEnabledDependents(key: FeatureKey,): FeatureKey[] {
    return registryDependents(key,).filter((d,) => isFeatureEnabled(d,),);
}

export function allFeatures(): typeof FEATURES { return FEATURES; }

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
