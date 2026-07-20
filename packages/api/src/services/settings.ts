/**
 * Settings service — the `site_settings` JSONB key/value store plus the
 * route-level orchestration that used to live in `routes/settings.ts`:
 * the public-settings projection, the per-key cached JSON getters/setters
 * (homepage hero, site header/footer, branding, appearance), and the
 * feature dependency planner + lazy-install migration applier.
 *
 *   const branding = await cms.settings.get<SiteBranding>('site_branding');
 *   await cms.settings.set('site_branding', updated, ctx);
 *
 * Reads are cached via the shared settings cache helpers; writes
 * invalidate that cache and log an audit row.
 *
 * Actor columns (`updated_by`) bind through `uuidOrNull()` so a write
 * authenticated by an API key (synthetic `api-key:<name>` actor) lands a
 * NULL FK rather than violating the users(id) reference.
 */
import type { SiteSettings, } from '@sitesurge/types';
import { config, } from '../config';
import { query, } from '../db';
import { ValidationError, } from '../middleware/error';
import { logAudit, } from './audit';
import { cache, } from './cache';
import { FEATURE_REGISTRY, FeatureKey, featureSettingKey, } from '../features/registry';
import { uuidOrNull, } from '../utils/uuid';
import type { AuditContext, } from './types';

/** Read a single settings row. Returns `null` when the key isn't
 *  present so callers can distinguish missing from "value is null". */
export async function get<T = unknown,>(key: string,): Promise<T | null> {
    const result = await query<{ value: T; }>(
        `SELECT value FROM site_settings WHERE key = $1`,
        [key,],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].value;
}

/** Server-side feature check. Reads the `<key>_enabled` row; when the
 *  row is absent, falls back to the registry-declared default. Used by
 *  the `requireFeature` route guard. */
export async function isFeatureEnabledServer(key: FeatureKey,): Promise<boolean> {
    const row = await get<unknown>(featureSettingKey(key,),);
    if (row === null) return FEATURE_REGISTRY[key].defaultEnabled;
    return row === true || row === 'true';
}

/** List every settings row. Useful for boot-time hydration of admin
 *  panels that surface multiple keys at once. */
export async function list(): Promise<Array<{ key: string; value: unknown; }>> {
    const result = await query<{ key: string; value: unknown; }>(
        `SELECT key, value FROM site_settings ORDER BY key ASC`,
    );
    return result.rows;
}

/** Upsert a settings row. Audit-logs the write and invalidates the
 *  shared settings cache so the next public read reloads. */
export async function set<T,>(
    key: string,
    value: T,
    ctx: AuditContext,
): Promise<T> {
    await query(
        `INSERT INTO site_settings (key, value, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [key, JSON.stringify(value,), uuidOrNull(ctx.userId,),],
    );

    // invalidateSettingsCache() runs delPattern('settings:*'), which already
    // busts the per-key `settings:<key>` entry — no separate del needed. If
    // that call is ever removed from this path, restore an explicit per-key
    // bust here.
    await cache.invalidateSettingsCache();

    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'settings',
        entityId: key,
        newValues: typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : { value, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return value;
}

/** Drop a settings row. Returns `true` when something was removed,
 *  `false` when the key didn't exist. */
export async function remove(key: string, ctx: AuditContext,): Promise<boolean> {
    const result = await query(
        `DELETE FROM site_settings WHERE key = $1 RETURNING key`,
        [key,],
    );
    if (result.rows.length === 0) return false;

    // invalidateSettingsCache() (delPattern 'settings:*') already busts the
    // per-key `settings:<key>` entry.
    await cache.invalidateSettingsCache();

    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'settings',
        entityId: key,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return true;
}

// ─── Public settings projection ───────────────────────────────────────

/**
 * Compute the public `features` object.
 *
 * Two kinds of flags:
 *   - **Provider flags** (e.g. patreon) — gated on BOTH an admin
 *     opt-in (`<feature>_enabled` in site_settings) AND a runtime
 *     condition (a connected provider row). Default OFF.
 *   - **Module flags** (posts / campaigns / forms / messages) — gated
 *     only on the admin toggle. Default ON. These hide / show the
 *     corresponding admin sidebar link and public routes.
 *
 * Adding a new feature is a one-place change here + a default in the
 * seeder. The frontend reads `features.<x>.enabled` verbatim.
 */
async function computePublicFeatures(
    settings: Record<string, unknown>,
): Promise<import('@sitesurge/types').SiteFeatures> {
    // Module flags default to ON when the row is absent (existing
    // installs predating the feature shouldn't suddenly hide things).
    const moduleEnabled = (key: string,): boolean => settings[key] !== false;

    const patreonAdminEnabled = settings.patreon_enabled === true;
    let patreonConnected = false;
    if (patreonAdminEnabled) {
        try {
            const r = await query<{ exists: boolean; }>(
                `SELECT EXISTS(
                    SELECT 1 FROM social_connections
                    WHERE provider = 'patreon' AND is_connected = true AND is_enabled = true
                ) AS exists`,
            );
            patreonConnected = Boolean(r.rows[0]?.exists,);
        } catch {
            // social_connections may not exist yet on a freshly-installed
            // instance whose migrations haven't reached 010 — treat as off.
            patreonConnected = false;
        }
    }

    return {
        patreon: { enabled: patreonAdminEnabled && patreonConnected, },
        posts: { enabled: moduleEnabled('posts_enabled',), },
        campaigns: { enabled: moduleEnabled('campaigns_enabled',), },
        forms: { enabled: moduleEnabled('forms_enabled',), },
        messages: { enabled: moduleEnabled('messages_enabled',), },
        // Social hub (feed capture / compose / connections). Module flag,
        // default ON — the social_connections + social_posts tables are base.
        social: { enabled: moduleEnabled('social_enabled',), },
        // `users` is opt-in (admin-only by default). Public registration
        // / "join" flows and the admin Users sidebar key off this flag.
        users: { enabled: settings.users_enabled === true, },
        // Mailing Lists is opt-in. Requires `users`; the toggle endpoint
        // enforces the prerequisite — once on, the row will be `true`
        // (and `users_enabled` will be too).
        mailing_lists: { enabled: settings.mailing_lists_enabled === true, },
        // Shop is opt-in. Requires `users`. Disabled until the admin
        // installs the feature and the `shop_enabled` row flips to true.
        shop: { enabled: settings.shop_enabled === true, },
        // Plugins is opt-in. Disabled until the admin installs the feature.
        plugins: { enabled: settings.plugins_enabled === true, },
    };
}

/**
 * Public settings projection (cached 600s). PUBLIC-SHAPED ONLY: this
 * reads every site_settings row but emits a fixed, curated subset
 * (`SiteSettings`) — no admin-only keys, no updated_by/audit data, no
 * per-role branching. There is no admin bypass, so the single cache
 * entry is safe to serve to everyone (anonymous, member, admin, key).
 */
export async function getPublicSettings(): Promise<SiteSettings> {
    const cacheKey = cache.CACHE_KEYS.settingsPublic;

    const cached = await cache.get<SiteSettings>(cacheKey,);
    if (cached) return cached;

    const result = await query(`SELECT key, value FROM site_settings`,);

    const settings: Record<string, unknown> = {};
    for (const row of result.rows) {
        settings[row.key] = row.value;
    }

    // Compute feature flags. Each flag is the AND of an admin setting
    // and the runtime conditions required for the feature to actually
    // work. The frontend reads `features.<x>.enabled` verbatim and never
    // recomputes.
    const features = await computePublicFeatures(settings,);

    const tagline = (settings.site_tagline as string | undefined)?.trim();

    // Logo and favicon live inside the `site_branding` row, not as
    // top-level keys — that's where Settings → Site Branding writes
    // them. Pull the URL out so the public consumer sees a plain string.
    // The legacy top-level `logo` / `favicon` keys are kept as a fallback
    // for older installs that wrote there directly.
    const branding = (settings.site_branding as
        | { logo?: { url?: string; mediaId?: string; }; favicon?: { url?: string; mediaId?: string; }; }
        | undefined) || {};
    const logoUrl = branding.logo?.url || (settings.logo as string | undefined);
    const faviconUrl = branding.favicon?.url || (settings.favicon as string | undefined);

    const publicSettings: SiteSettings = {
        siteName: (settings.site_name as string) || 'RW',
        siteTagline: tagline || undefined,
        siteDescription: (settings.site_description as string) || '',
        logo: logoUrl,
        favicon: faviconUrl,
        socialLinks: (settings.social_links as Record<string, string>) || {},
        contactEmail: (settings.contact_email as string) || '',
        analytics: settings.analytics as SiteSettings['analytics'],
        theme: settings.theme as SiteSettings['theme'],
        appearance: settings.site_appearance as SiteSettings['appearance'],
        features,
    };

    // Include Shopify config if configured (storefront tokens are public)
    if (config.shopify.storeDomain && config.shopify.storefrontAccessToken) {
        (publicSettings as any).shopifyDomain = config.shopify.storeDomain;
        (publicSettings as any).shopifyStorefrontToken = config.shopify.storefrontAccessToken;
    }

    await cache.set(cacheKey, publicSettings, 600,);

    return publicSettings;
}

// ─── Admin: full settings map ─────────────────────────────────────────

export interface AdminSettingRow {
    value: unknown;
    updatedAt: Date;
    updatedBy?: string;
}

/** Every settings row with its updated_at / display-name of the last
 *  editor — the admin Settings panel hydrates from this. */
export async function getAllSettings(): Promise<Record<string, AdminSettingRow>> {
    const result = await query(
        `SELECT s.key, s.value, s.updated_at, u.display_name as updated_by_name
         FROM site_settings s
         LEFT JOIN users u ON s.updated_by = u.id`,
    );

    const settings: Record<string, AdminSettingRow> = {};
    for (const row of result.rows) {
        settings[row.key] = {
            value: row.value,
            updatedAt: row.updated_at,
            updatedBy: row.updated_by_name,
        };
    }
    return settings;
}

// ─── Admin: settings update (incl. feature cascade) ───────────────────

export { uninstallFeature, UninstallError, } from './featureUninstall';

// Feature dependency-cascade orchestration lives in ./features/cascade.
// Re-exported here so existing importers keep resolving unchanged:
//   - routes/settings.ts        → settings.updateSettings
//   - middleware/error.ts       → import { FeatureCascadeError } from '../services/settings'
//   - sdk barrel (cms.settings) → export * from '../services/settings'
export { FeatureCascadeError, updateSettings, } from './features/cascade';
export type { UpdateSettingsInput, } from './features/cascade';

// ─── Per-key cached JSON settings ─────────────────────────────────────
// Homepage hero, site header/footer, branding, appearance: each is one
// JSONB row read on every page load, so each gets its own `settings:<x>`
// cache key (600s) and a typed default for fresh installs.

interface KeyedSetting {
    /** site_settings.key */
    key: string;
    /** settings:<cacheKey> */
    cacheKey: string;
    /** entityId for audit logs */
    entityId: string;
    /** value returned when the row is absent */
    fallback: unknown;
}

const HOMEPAGE_HERO: KeyedSetting = {
    key: 'homepage_hero',
    cacheKey: 'settings:homepage_hero',
    entityId: 'homepage_hero',
    fallback: {
        items: [],
        options: {
            autoScroll: false,
            autoScrollInterval: 3000,
            repeat: true,
            customHeight: false,
            height: '50vh',
        },
    },
};

const SITE_HEADER: KeyedSetting = {
    key: 'site_header',
    cacheKey: 'settings:site_header',
    entityId: 'site_header',
    fallback: { items: [], backgroundColor: undefined, padding: undefined, margin: undefined, },
};

const SITE_FOOTER: KeyedSetting = {
    key: 'site_footer',
    cacheKey: 'settings:site_footer',
    entityId: 'site_footer',
    // Footer disabled by default; the renderer treats `enabled: false` as
    // "render nothing", so a brand-new install shows no footer until the
    // admin opts in.
    fallback: { enabled: false, rows: [], },
};

const SITE_BRANDING: KeyedSetting = {
    key: 'site_branding',
    cacheKey: 'settings:site_branding',
    entityId: 'site_branding',
    fallback: { logo: { mediaId: undefined, url: undefined, }, favicon: { mediaId: undefined, url: undefined, }, },
};

const SITE_APPEARANCE: KeyedSetting = {
    key: 'site_appearance',
    cacheKey: 'settings:site_appearance',
    entityId: 'site_appearance',
    fallback: { backgroundColor: '#ffffff', fontSize: 16, gutterWidth: '', },
};

/** Read one keyed JSON setting (cached 600s), with a typed fallback. */
async function getKeyed(def: KeyedSetting,): Promise<unknown> {
    const cached = await cache.get(def.cacheKey,);
    if (cached) return cached;

    const result = await query(
        `SELECT value FROM site_settings WHERE key = $1`,
        [def.key,],
    );
    const data = result.rows.length > 0 ? result.rows[0].value : def.fallback;
    await cache.set(def.cacheKey, data, 600,);
    return data;
}

/** Upsert one keyed JSON setting; busts its cache + the global settings
 *  cache and audit-logs. */
async function setKeyed(def: KeyedSetting, value: unknown, ctx: AuditContext,): Promise<unknown> {
    await query(
        `INSERT INTO site_settings (key, value, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
        [def.key, JSON.stringify(value,), uuidOrNull(ctx.userId,),],
    );

    // def.cacheKey is a `settings:site_*` entry inside the settings:*
    // namespace, so invalidateSettingsCache() (delPattern 'settings:*')
    // already busts it — no separate per-key del needed.
    await cache.invalidateSettingsCache();

    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'settings',
        entityId: def.entityId,
        newValues: value as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return value;
}

export const getHomepageHero = () => getKeyed(HOMEPAGE_HERO,);
export const setHomepageHero = (value: unknown, ctx: AuditContext,) => setKeyed(HOMEPAGE_HERO, value, ctx,);
export const getSiteHeader = () => getKeyed(SITE_HEADER,);
export const setSiteHeader = (value: unknown, ctx: AuditContext,) => setKeyed(SITE_HEADER, value, ctx,);
export const getSiteFooter = () => getKeyed(SITE_FOOTER,);
export const setSiteFooter = (value: unknown, ctx: AuditContext,) => setKeyed(SITE_FOOTER, value, ctx,);
export const getSiteBranding = () => getKeyed(SITE_BRANDING,);
export const setSiteBranding = (value: unknown, ctx: AuditContext,) => setKeyed(SITE_BRANDING, value, ctx,);
export const getAppearance = () => getKeyed(SITE_APPEARANCE,);
export const setAppearance = (value: unknown, ctx: AuditContext,) => setKeyed(SITE_APPEARANCE, value, ctx,);

// ─── Admin appearance (operator-only, not cached) ─────────────────────
// Color tokens applied to the admin chrome. Stored at
// site_settings.admin_appearance as one JSON blob so a partial admin
// save can't clobber unrelated rows. Admin-only — no public exposure,
// so no caching.

export async function getAdminAppearance(): Promise<unknown> {
    const result = await query(
        `SELECT value FROM site_settings WHERE key = 'admin_appearance'`,
    );
    return result.rows.length > 0 ? result.rows[0].value : {};
}

export async function setAdminAppearance(value: unknown, ctx: AuditContext,): Promise<unknown> {
    await query(
        `INSERT INTO site_settings (key, value, updated_by)
         VALUES ('admin_appearance', $1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
        [JSON.stringify(value,), uuidOrNull(ctx.userId,),],
    );
    await cache.invalidateSettingsCache();

    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'settings',
        entityId: 'admin_appearance',
        newValues: value as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return value;
}

// ─── Single-key admin upsert / delete ─────────────────────────────────

/** PUT /:key — upsert an arbitrary settings row by key. */
export async function setRawKey(key: string, value: unknown, ctx: AuditContext,): Promise<{ message: string; }> {
    if (value === undefined) {
        throw new ValidationError('Value is required',);
    }

    await query(
        `INSERT INTO site_settings (key, value, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [key, JSON.stringify(value,), uuidOrNull(ctx.userId,),],
    );

    await cache.invalidateSettingsCache();

    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'settings',
        entityId: key,
        newValues: { [key]: value, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return { message: 'Setting updated', };
}

/** DELETE /:key — drop an arbitrary settings row. */
export async function deleteRawKey(key: string,): Promise<{ message: string; }> {
    await query('DELETE FROM site_settings WHERE key = $1', [key,],);
    await cache.invalidateSettingsCache();
    return { message: 'Setting deleted', };
}
