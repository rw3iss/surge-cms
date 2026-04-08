import type { SiteSettings, } from '@surge/shared';
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
},);

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

        const publicSettings: SiteSettings = {
            siteName: (settings.site_name as string) || 'Surge Media',
            siteDescription: (settings.site_description as string) || '',
            logo: settings.logo as string | undefined,
            favicon: settings.favicon as string | undefined,
            socialLinks: (settings.social_links as Record<string, string>) || {},
            contactEmail: (settings.contact_email as string) || '',
            analytics: settings.analytics as SiteSettings['analytics'],
            theme: settings.theme as SiteSettings['theme'],
            appearance: settings.site_appearance as SiteSettings['appearance'],
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

// ─── Site Colors ───

const DEFAULT_SITE_COLORS = [
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

// Get site colors (public, cached)
router.get('/site-colors', async (_req, res,) => {
    try {
        const cacheKey = 'settings:site_colors';
        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const result = await query(
            `SELECT value FROM site_settings WHERE key = 'site_colors'`,
        );

        const data = result.rows.length > 0 && Array.isArray(result.rows[0].value) ?
            result.rows[0].value :
            DEFAULT_SITE_COLORS;

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

        // Validate each color is a hex string
        const validColors = data.filter((c,) =>
            typeof c === 'string' && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(c,),
        );

        await query(
            `INSERT INTO site_settings (key, value, updated_by)
       VALUES ('site_colors', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
            [JSON.stringify(validColors,), req.userId,],
        );

        await cache.del('settings:site_colors',);
        await cache.invalidateSettingsCache();

        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'settings',
            entityId: 'site_colors',
            newValues: { count: validColors.length, },
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);

        sendSuccess(res, validColors,);
    } catch (error) {
        handleRouteError(res, error, 'save site colors',);
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

export default router;
