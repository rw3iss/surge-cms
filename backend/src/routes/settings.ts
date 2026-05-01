import type { SiteSettings, } from '@rw/shared';
import { Router, } from 'express';
import { z, } from 'zod';
import { config, } from '../config';
import { query, } from '../db';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { ValidationError, } from '../middleware/error';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import { handleRouteError, sendSuccess, } from '../utils/response';

const router = Router();

const settingsSchema = z.object({
    siteName: z.string().min(1,).max(255,).optional(),
    siteDescription: z.string().optional(),
    logo: z.string().url().optional().nullable(),
    favicon: z.string().url().optional().nullable(),
    socialLinks: z.record(z.string(),).optional(),
    contactEmail: z.string().email().optional(),
    analytics: z.object({
        googleAnalyticsId: z.string().optional(),
        facebookPixelId: z.string().optional(),
    },).optional(),
    theme: z.object({
        primaryColor: z.string().optional(),
        secondaryColor: z.string().optional(),
        accentColor: z.string().optional(),
    },).optional(),
    /**
     * Feature toggles. The admin Features panel sends this object;
     * each key writes a `<feature>_enabled` row in `site_settings`.
     * Adding a new feature: extend this shape and the seeder
     * defaults — `computePublicFeatures` will pick it up.
     */
    features: z.object({
        patreon: z.boolean().optional(),
        posts: z.boolean().optional(),
        campaigns: z.boolean().optional(),
        forms: z.boolean().optional(),
        messages: z.boolean().optional(),
        users: z.boolean().optional(),
    },).optional(),
},);

/** Map from `features.<key>` payload field to the underlying
 * `site_settings.<row>` key. Centralized so the toggle list stays
 * consistent with `computePublicFeatures`. */
const FEATURE_TO_SETTING_KEY: Record<string, string> = {
    patreon: 'patreon_enabled',
    posts: 'posts_enabled',
    campaigns: 'campaigns_enabled',
    forms: 'forms_enabled',
    messages: 'messages_enabled',
    users: 'users_enabled',
};

// Get public settings (public)
router.get('/public', async (_req, res,) => {
    try {
        const cacheKey = 'settings:public';

        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const result = await query(`SELECT key, value FROM site_settings`,);

        const settings: Record<string, unknown> = {};
        for (const row of result.rows) {
            settings[row.key] = row.value;
        }

        // Compute feature flags. Each flag is the AND of an admin
        // setting and the runtime conditions required for the feature
        // to actually work. The frontend reads `features.<x>.enabled`
        // verbatim and never recomputes.
        const features = await computePublicFeatures(settings,);

        const tagline = (settings.site_tagline as string | undefined)?.trim();

        // Logo and favicon live inside the `site_branding` row, not as
        // top-level keys — that's where Settings → Site Branding writes
        // them. Pull the URL out so the public consumer sees a plain
        // string. The legacy top-level `logo` / `favicon` keys are kept
        // as a fallback for older installs that wrote there directly.
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

        sendSuccess(res, publicSettings,);
    } catch (error) {
        handleRouteError(res, error, 'fetch public settings',);
    }
},);

// Get all settings (admin)
router.get('/', authenticate(), requireAdmin, async (_req: AuthenticatedRequest, res,) => {
    try {
        const result = await query(
            `SELECT s.key, s.value, s.updated_at, u.display_name as updated_by_name
       FROM site_settings s
       LEFT JOIN users u ON s.updated_by = u.id`,
        );

        const settings: Record<string, { value: unknown; updatedAt: Date; updatedBy?: string; }> = {};
        for (const row of result.rows) {
            settings[row.key] = {
                value: row.value,
                updatedAt: row.updated_at,
                updatedBy: row.updated_by_name,
            };
        }

        sendSuccess(res, settings,);
    } catch (error) {
        handleRouteError(res, error, 'fetch settings',);
    }
},);

// Update settings (admin)
router.put('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = settingsSchema.parse(req.body,);

        const settingsMap: Record<string, unknown> = {
            site_name: data.siteName,
            site_description: data.siteDescription,
            logo: data.logo,
            favicon: data.favicon,
            social_links: data.socialLinks,
            contact_email: data.contactEmail,
            analytics: data.analytics,
            theme: data.theme,
        };

        // Feature toggles flatten into individual `<feature>_enabled`
        // rows. Treating them as separate keys (rather than a single
        // JSON blob) means partial updates are easy and the rows are
        // queryable for ad-hoc checks.
        if (data.features) {
            for (const [featureKey, value,] of Object.entries(data.features,)) {
                if (value === undefined) continue;
                const settingKey = FEATURE_TO_SETTING_KEY[featureKey];
                if (settingKey) settingsMap[settingKey] = value;
            }
        }

        for (const [key, value,] of Object.entries(settingsMap,)) {
            if (value !== undefined) {
                await query(
                    `INSERT INTO site_settings (key, value, updated_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET
             value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
                    [key, JSON.stringify(value,), req.userId,],
                );
            }
        }

        await cache.invalidateSettingsCache();

        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'settings',
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);

        sendSuccess(res, { message: 'Settings updated', },);
    } catch (error) {
        handleRouteError(res, error, 'update settings',);
    }
},);

// Get homepage hero settings (public, cached)
router.get('/homepage-hero', async (_req, res,) => {
    try {
        const cacheKey = 'settings:homepage_hero';
        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const result = await query(
            `SELECT value FROM site_settings WHERE key = 'homepage_hero'`,
        );

        const data = result.rows.length > 0 ?
            result.rows[0].value :
            {
                items: [],
                options: {
                    autoScroll: false,
                    autoScrollInterval: 3000,
                    repeat: true,
                    customHeight: false,
                    height: '50vh',
                },
            };

        await cache.set(cacheKey, data, 600,);
        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'fetch homepage hero settings',);
    }
},);

// Update homepage hero settings (admin)
router.put('/homepage-hero', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = req.body;

        await query(
            `INSERT INTO site_settings (key, value, updated_by)
       VALUES ('homepage_hero', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
            [JSON.stringify(data,), req.userId,],
        );

        await cache.del('settings:homepage_hero',);
        await cache.invalidateSettingsCache();

        // Audit log
        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'settings',
            entityId: 'homepage_hero',
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);

        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'save homepage hero settings',);
    }
},);

// Get site header settings (public, cached)
router.get('/site-header', async (_req, res,) => {
    try {
        const cacheKey = 'settings:site_header';
        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const result = await query(
            `SELECT value FROM site_settings WHERE key = 'site_header'`,
        );

        const data = result.rows.length > 0 ?
            result.rows[0].value :
            { items: [], backgroundColor: undefined, padding: undefined, margin: undefined, };

        await cache.set(cacheKey, data, 600,);
        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'fetch site header settings',);
    }
},);

// Update site header settings (admin)
router.put('/site-header', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = req.body;

        await query(
            `INSERT INTO site_settings (key, value, updated_by)
       VALUES ('site_header', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
            [JSON.stringify(data,), req.userId,],
        );

        await cache.del('settings:site_header',);
        await cache.invalidateSettingsCache();

        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'settings',
            entityId: 'site_header',
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);

        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'save site header settings',);
    }
},);

// ─── Admin appearance ───
// Color tokens applied to the admin chrome (sidebar bg / sidebar text /
// page bg / page text / panel bg). Stored at site_settings.admin_appearance
// as one JSON blob so a partial admin save can't accidentally clobber
// unrelated settings rows.
//
// All fields default to undefined on the wire; AdminLayout maps them to
// `--admin-*` CSS custom properties and the SCSS uses
// `var(--admin-x, fallback)` so unset values inherit the static admin
// theme. The endpoint is authenticated admin-only because admin
// appearance is operator-only — no point exposing it publicly.
router.get('/admin-appearance', authenticate(), requireAdmin, async (_req: AuthenticatedRequest, res,) => {
    try {
        const result = await query(
            `SELECT value FROM site_settings WHERE key = 'admin_appearance'`,
        );
        const data = result.rows.length > 0 ? result.rows[0].value : {};
        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'fetch admin appearance settings',);
    }
},);

router.put('/admin-appearance', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = req.body;
        await query(
            `INSERT INTO site_settings (key, value, updated_by)
             VALUES ('admin_appearance', $1, $2)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
            [JSON.stringify(data,), req.userId,],
        );
        await cache.invalidateSettingsCache();

        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'settings',
            entityId: 'admin_appearance',
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);

        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'save admin appearance settings',);
    }
},);

// ─── Site Footer ───
// Stored at site_settings.site_footer. Public GET so the renderer can
// read it on every page load; the structure has no privileged data.
router.get('/site-footer', async (_req, res,) => {
    try {
        const cacheKey = 'settings:site_footer';
        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const result = await query(
            `SELECT value FROM site_settings WHERE key = 'site_footer'`,
        );

        // Defaults: footer disabled, no rows. The renderer treats
        // `enabled: false` as "render nothing", so a brand-new install
        // shows no footer until the admin opts in.
        const data = result.rows.length > 0
            ? result.rows[0].value
            : { enabled: false, rows: [], };

        await cache.set(cacheKey, data, 600,);
        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'fetch site footer settings',);
    }
},);

router.put('/site-footer', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = req.body;

        await query(
            `INSERT INTO site_settings (key, value, updated_by)
             VALUES ('site_footer', $1, $2)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
            [JSON.stringify(data,), req.userId,],
        );

        await cache.del('settings:site_footer',);
        await cache.invalidateSettingsCache();

        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'settings',
            entityId: 'site_footer',
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);

        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'save site footer settings',);
    }
},);

// Get site branding settings (public, cached)
router.get('/site-branding', async (_req, res,) => {
    try {
        const cacheKey = 'settings:site_branding';
        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const result = await query(
            `SELECT value FROM site_settings WHERE key = 'site_branding'`,
        );

        const data = result.rows.length > 0 ?
            result.rows[0].value :
            { logo: { mediaId: undefined, url: undefined, }, favicon: { mediaId: undefined, url: undefined, }, };

        await cache.set(cacheKey, data, 600,);
        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'fetch site branding settings',);
    }
},);

// Update site branding settings (admin)
router.put('/site-branding', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = req.body;

        await query(
            `INSERT INTO site_settings (key, value, updated_by)
       VALUES ('site_branding', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
            [JSON.stringify(data,), req.userId,],
        );

        await cache.del('settings:site_branding',);
        await cache.invalidateSettingsCache();

        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'settings',
            entityId: 'site_branding',
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);

        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'save site branding settings',);
    }
},);

// Get appearance settings (public, cached)
router.get('/appearance', async (_req, res,) => {
    try {
        const cacheKey = 'settings:site_appearance';
        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const result = await query(
            `SELECT value FROM site_settings WHERE key = 'site_appearance'`,
        );

        const data = result.rows.length > 0 ?
            result.rows[0].value :
            { backgroundColor: '#ffffff', fontSize: 16, gutterWidth: '', };

        await cache.set(cacheKey, data, 600,);
        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'fetch appearance settings',);
    }
},);

// Update appearance settings (admin)
router.put('/appearance', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = req.body;

        await query(
            `INSERT INTO site_settings (key, value, updated_by)
       VALUES ('site_appearance', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
            [JSON.stringify(data,), req.userId,],
        );

        await cache.del('settings:site_appearance',);
        await cache.invalidateSettingsCache();

        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'settings',
            entityId: 'site_appearance',
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);

        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'save appearance settings',);
    }
},);

// ─── Site Colors / Swatches ───
//
// Storage shape: `SiteSwatch[]` — each entry has a stable id, a hex
// value, and an optional name. Anywhere in the app, a color field can
// hold either a raw `#rrggbb` string OR `swatch:{id}`; the frontend
// resolver dereferences swatch refs to live hex values via CSS custom
// properties, so editing a swatch updates every consumer reactively.
//
// Legacy installs stored `string[]` (just hex values). On first read
// we transparently migrate to the object shape and persist back, so
// downstream code only ever sees the new shape.

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
// Swatch IDs: alphanumeric + dash/underscore, 1–32 chars. Tight enough
// to prevent injecting characters that would break CSS custom property
// names or LIKE-pattern scans of JSONB columns.
const SWATCH_ID_RE = /^[a-zA-Z0-9_-]{1,32}$/;

interface SiteSwatchRow { id: string; hex: string; name?: string; }

const DEFAULT_SITE_COLOR_HEXES = [
    '#ffffff',
    '#000000',
    '#3498cf',
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

function generateSwatchId(): string {
    // 8-char URL-safe random id; ~5 trillion possibilities so collision
    // within a single site's swatch list is practically zero.
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 8; i++) id += alphabet[Math.floor(Math.random() * alphabet.length,)];
    return id;
}

function buildDefaultSwatches(): SiteSwatchRow[] {
    return DEFAULT_SITE_COLOR_HEXES.map((hex,) => ({ id: generateSwatchId(), hex, }));
}

/**
 * Read swatches from `site_settings.site_colors` and migrate the legacy
 * `string[]` shape on the way out. The migration is persisted so the
 * next read returns the object form directly.
 */
async function loadSwatches(): Promise<SiteSwatchRow[]> {
    const result = await query(
        `SELECT value FROM site_settings WHERE key = 'site_colors'`,
    );
    if (result.rows.length === 0) return buildDefaultSwatches();
    const raw = result.rows[0].value;
    if (!Array.isArray(raw,)) return buildDefaultSwatches();

    // Already in object form — sanity-fill missing IDs and drop bad rows.
    if (raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null) {
        const seen = new Set<string>();
        const objects = (raw as Array<Partial<SiteSwatchRow>>).flatMap((entry,) => {
            if (!entry || typeof entry.hex !== 'string' || !HEX_RE.test(entry.hex,)) return [];
            let id = typeof entry.id === 'string' && SWATCH_ID_RE.test(entry.id,) ? entry.id : generateSwatchId();
            // Ensure uniqueness within the list — duplicate IDs would
            // make CSS custom properties collide.
            while (seen.has(id,)) id = generateSwatchId();
            seen.add(id,);
            const out: SiteSwatchRow = { id, hex: entry.hex, };
            if (typeof entry.name === 'string' && entry.name.trim()) out.name = entry.name.trim();
            return [out,];
        },);
        return objects;
    }

    // Legacy `string[]` shape: assign IDs and persist back.
    const migrated: SiteSwatchRow[] = (raw as unknown[]).flatMap((c,) => {
        if (typeof c !== 'string' || !HEX_RE.test(c,)) return [];
        return [{ id: generateSwatchId(), hex: c, },];
    },);
    if (migrated.length > 0) {
        await query(
            `UPDATE site_settings SET value = $1, updated_at = NOW() WHERE key = 'site_colors'`,
            [JSON.stringify(migrated,),],
        );
    }
    return migrated.length > 0 ? migrated : buildDefaultSwatches();
}

// Get site colors (public, cached)
router.get('/site-colors', async (_req, res,) => {
    try {
        const cacheKey = 'settings:site_colors';
        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const data = await loadSwatches();
        await cache.set(cacheKey, data, 600,);
        sendSuccess(res, data,);
    } catch (error) {
        handleRouteError(res, error, 'fetch site colors',);
    }
},);

// Update site colors (admin)
router.put('/site-colors', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = req.body;

        if (!Array.isArray(data,)) {
            throw new ValidationError('Site colors must be an array',);
        }

        const seen = new Set<string>();
        const validSwatches: SiteSwatchRow[] = [];
        for (const entry of data) {
            if (!entry || typeof entry !== 'object') continue;
            const e = entry as Partial<SiteSwatchRow>;
            if (typeof e.hex !== 'string' || !HEX_RE.test(e.hex,)) continue;
            let id = typeof e.id === 'string' && SWATCH_ID_RE.test(e.id,) ? e.id : generateSwatchId();
            // Reject duplicate IDs from the client — a custom ID typed
            // by the user must be unique. If the client sent dupes we
            // fall through to a fresh random ID for the conflicting
            // entry rather than silently merging.
            if (seen.has(id,)) {
                id = generateSwatchId();
                while (seen.has(id,)) id = generateSwatchId();
            }
            seen.add(id,);
            const swatch: SiteSwatchRow = { id, hex: e.hex, };
            if (typeof e.name === 'string' && e.name.trim()) swatch.name = e.name.trim().slice(0, 64,);
            validSwatches.push(swatch,);
        }

        await query(
            `INSERT INTO site_settings (key, value, updated_by)
       VALUES ('site_colors', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
            [JSON.stringify(validSwatches,), req.userId,],
        );

        await cache.del('settings:site_colors',);
        await cache.invalidateSettingsCache();

        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'settings',
            entityId: 'site_colors',
            newValues: { count: validSwatches.length, },
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);

        sendSuccess(res, validSwatches,);
    } catch (error) {
        handleRouteError(res, error, 'save site colors',);
    }
},);

// Count swatch references across the database. Used by the swatch
// editor's delete-confirm UI so the operator knows how many places
// will fall back to the default if they remove the swatch. The scan
// is JSONB-text based — we LIKE-search for the substring `swatch:{id}`
// in every column that can hold a color value. Cheap (one query per
// table, bounded number of tables) and tolerant: if any sub-query
// fails we still return the partial total.
router.get('/site-colors/usages/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { id, } = req.params;
        if (!SWATCH_ID_RE.test(id,)) throw new ValidationError('Invalid swatch id',);
        const needle = `%swatch:${id}%`;

        // (label, SQL) pairs — each query returns a single int count.
        const sources: Array<{ label: string; sql: string; }> = [
            { label: 'Page blocks', sql: `SELECT COUNT(*)::int AS n FROM blocks WHERE settings::text ILIKE $1 OR style::text ILIKE $1`, },
            { label: 'Post content blocks', sql: `SELECT COUNT(*)::int AS n FROM post_content_blocks WHERE data::text ILIKE $1`, },
            { label: 'Block style templates', sql: `SELECT COUNT(*)::int AS n FROM block_styles WHERE style::text ILIKE $1`, },
            { label: 'Site settings', sql: `SELECT COUNT(*)::int AS n FROM site_settings WHERE key <> 'site_colors' AND value::text ILIKE $1`, },
        ];

        const breakdown: Array<{ source: string; count: number; }> = [];
        let total = 0;
        for (const s of sources) {
            try {
                const r = await query(s.sql, [needle,],);
                const n = Number((r.rows[0] as any)?.n ?? 0,);
                if (n > 0) {
                    breakdown.push({ source: s.label, count: n, },);
                    total += n;
                }
            } catch {
                // Table may not exist on older installs; skip silently.
            }
        }

        sendSuccess(res, { total, breakdown, },);
    } catch (error) {
        handleRouteError(res, error, 'count swatch usages',);
    }
},);

// Update single setting (admin)
router.put('/:key', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { key, } = req.params;
        const { value, } = req.body;

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
            [key, JSON.stringify(value,), req.userId,],
        );

        await cache.invalidateSettingsCache();

        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'settings',
            entityId: key,
            newValues: { [key]: value, },
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);

        sendSuccess(res, { message: 'Setting updated', },);
    } catch (error) {
        handleRouteError(res, error, 'update setting',);
    }
},);

// Delete setting (admin)
router.delete('/:key', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { key, } = req.params;

        await query('DELETE FROM site_settings WHERE key = $1', [key,],);

        await cache.invalidateSettingsCache();

        sendSuccess(res, { message: 'Setting deleted', },);
    } catch (error) {
        handleRouteError(res, error, 'delete setting',);
    }
},);

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
): Promise<import('@rw/shared').SiteFeatures> {
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
        // `users` is opt-in (admin-only by default). Public registration
        // / "join" flows and the admin Users sidebar key off this flag.
        users: { enabled: settings.users_enabled === true, },
    };
}

export default router;
