import { z, } from 'zod';
import type { SettingsUpdateBody, } from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import * as serverLogs from '../services/serverLogs';
import * as settings from '../services/settings';
import * as swatches from '../services/swatches';
import * as systemUpdate from '../services/systemUpdate';

// ─── Schemas ──────────────────────────────────────────────────────────

const settingsSchema = z.object({
    siteName: z.string().min(1,).max(255,).optional(),
    siteDescription: z.string().optional(),
    logo: z.string().url().optional().nullable(),
    favicon: z.string().url().optional().nullable(),
    socialLinks: z.record(z.string(), z.string(),).optional(),
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
     * Feature toggles. The admin Features panel sends this object; each
     * key writes a `<feature>_enabled` row in `site_settings`.
     * Dependency-aware: keys must exist in `FEATURE_REGISTRY`.
     */
    features: z.record(z.string(), z.boolean(),).optional(),
    /**
     * When toggling a feature on, also enable any prerequisites that
     * aren't already enabled. Set by the frontend's FeatureDependencyModal
     * after the operator confirms the cascade.
     */
    enableDependencies: z.boolean().optional(),
    /**
     * Symmetric: when toggling a feature off, also disable any enabled
     * features that declare it as a prerequisite.
     */
    disableDependents: z.boolean().optional(),
},) satisfies z.ZodType<SettingsUpdateBody>;

const keyParams = z.object({ key: z.string(), },);

// ─── Routes ───────────────────────────────────────────────────────────
// Order matters: literal paths (/public, /site-colors/usages/:id, …)
// must precede the /:key catch-all.

export const settingsRoutes = [

    defineRoute({
        method: 'get', path: '/public', auth: 'public',
        summary: 'Public site settings projection (cached 600s).',
        handler: () => settings.getPublicSettings(),
    },),

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'All settings rows with last-editor metadata.',
        handler: () => settings.getAllSettings(),
    },),

    defineRoute({
        method: 'put', path: '/', auth: 'admin',
        summary: 'Update settings; feature toggles run the dependency cascade + lazy migrations.',
        input: { body: settingsSchema, },
        // A feature-cascade rejection throws FeatureCascadeError, which the
        // error middleware maps to a 409 carrying the planner result verbatim
        // (the FeatureDependencyModal reads that exact shape).
        handler: ({ body, audit, },) => settings.updateSettings(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/homepage-hero', auth: 'public',
        summary: 'Homepage hero settings (cached 600s).',
        handler: () => settings.getHomepageHero(),
    },),

    defineRoute({
        method: 'put', path: '/homepage-hero', auth: 'admin',
        summary: 'Update homepage hero settings.',
        handler: ({ body, audit, },) => settings.setHomepageHero(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/site-header', auth: 'public',
        summary: 'Site header settings (cached 600s).',
        handler: () => settings.getSiteHeader(),
    },),

    defineRoute({
        method: 'put', path: '/site-header', auth: 'admin',
        summary: 'Update site header settings.',
        handler: ({ body, audit, },) => settings.setSiteHeader(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/admin-appearance', auth: 'admin',
        summary: 'Admin chrome appearance tokens (operator-only).',
        handler: () => settings.getAdminAppearance(),
    },),

    defineRoute({
        method: 'put', path: '/admin-appearance', auth: 'admin',
        summary: 'Update admin chrome appearance tokens.',
        handler: ({ body, audit, },) => settings.setAdminAppearance(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/site-footer', auth: 'public',
        summary: 'Site footer settings (cached 600s).',
        handler: () => settings.getSiteFooter(),
    },),

    defineRoute({
        method: 'put', path: '/site-footer', auth: 'admin',
        summary: 'Update site footer settings.',
        handler: ({ body, audit, },) => settings.setSiteFooter(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/site-branding', auth: 'public',
        summary: 'Site branding (logo / favicon) settings (cached 600s).',
        handler: () => settings.getSiteBranding(),
    },),

    defineRoute({
        method: 'put', path: '/site-branding', auth: 'admin',
        summary: 'Update site branding settings.',
        handler: ({ body, audit, },) => settings.setSiteBranding(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/appearance', auth: 'public',
        summary: 'Public appearance settings (cached 600s).',
        handler: () => settings.getAppearance(),
    },),

    defineRoute({
        method: 'put', path: '/appearance', auth: 'admin',
        summary: 'Update appearance settings.',
        handler: ({ body, audit, },) => settings.setAppearance(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/site-colors', auth: 'public',
        summary: 'Site color swatches (cached 600s; auto-migrates legacy shape).',
        handler: () => swatches.list(),
    },),

    defineRoute({
        method: 'put', path: '/site-colors', auth: 'admin',
        summary: 'Replace the site color swatch palette.',
        input: { body: z.array(z.record(z.string(), z.unknown(),),), },
        handler: ({ body, audit, },) => swatches.replace(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/site-colors/usages/:id', auth: 'admin',
        summary: 'Count swatch:{id} references across the DB (delete-confirm UI).',
        input: { params: z.object({ id: z.string(), },), },
        handler: ({ params, },) => swatches.usages(params.id,),
    },),

    defineRoute({
        method: 'post', path: '/features/:key/uninstall', auth: 'admin',
        summary: 'Permanently remove a feature: drop its tables + data. Irreversible.',
        input: {
            params: z.object({ key: z.string(), },),
            body: z.object({ confirm: z.literal(true,), },),
        },
        handler: async ({ params, audit, },) => {
            const result = await settings.uninstallFeature(params.key as never, audit(),);
            return { message: `Removed ${params.key}`, ...result, };
        },
    },),

    defineRoute({
        method: 'get', path: '/server-logs', auth: 'admin',
        summary: 'Tail of the server combined log (admin diagnostics panel).',
        input: { query: z.object({ lines: z.coerce.number().int().min(1,).max(10000,).optional(), },), },
        handler: ({ query, },) => serverLogs.getServerLogs((query as { lines?: number; }).lines,),
    },),

    defineRoute({
        method: 'get', path: '/cms-version', auth: 'admin',
        summary: 'Installed CMS version + latest published version (update check).',
        handler: () => systemUpdate.getVersionInfo(),
    },),

    defineRoute({
        method: 'post', path: '/update-cms', auth: 'admin',
        summary: 'Install the latest CMS packages and restart the server. Irreversible; brief downtime.',
        handler: ({ audit, },) => systemUpdate.runUpdate(audit(),),
    },),

    defineRoute({
        method: 'put', path: '/:key', auth: 'admin',
        summary: 'Upsert an arbitrary settings row by key.',
        input: { params: keyParams, body: z.object({ value: z.unknown(), },), },
        handler: ({ params, body, audit, },) => settings.setRawKey(params.key, (body as { value: unknown; }).value, audit(),),
    },),

    defineRoute({
        method: 'delete', path: '/:key', auth: 'admin',
        summary: 'Delete an arbitrary settings row by key.',
        input: { params: keyParams, },
        handler: ({ params, },) => settings.deleteRawKey(params.key,),
    },),
];

export default settingsRoutes;
