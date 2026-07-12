/**
 * Settings + features tools. The public projection, the admin all-rows dump,
 * one-key reads, site-config updates, the raw-key escape hatch, and the feature
 * lifecycle (enable/disable with cascade flags, and the destructive uninstall).
 *
 * Feature toggling: `set_feature` calls settings.update({ features: {...} });
 * a rejected toggle throws FeatureCascadeError (409) whose cascade plan the
 * framework error mapper surfaces — retry with enableDependencies /
 * disableDependents once the plan is understood.
 *
 * Site config (name/description/logo/…) and features share the same PUT
 * /settings endpoint; the tools keep them SEPARATE so an accidental feature
 * flip can't ride along with a name change.
 */
import { z, } from 'zod';
import type { SettingsUpdateBody, } from '@sitesurge/types';
import { defineTool, type ToolContext, type ToolDef, } from '../tool';

/** The site-config (non-feature) fields as an optional zod fragment. */
const configShape = {
    siteName: z.string().optional().describe('Site name.',),
    siteDescription: z.string().optional().describe('Site description / tagline.',),
    logo: z.string().optional().describe('Logo URL or media ref.',),
    favicon: z.string().optional().describe('Favicon URL or media ref.',),
    socialLinks: z.record(z.string(), z.string(),).optional().describe('Map of platform → profile URL (e.g. { twitter: "https://…" }).',),
    contactEmail: z.string().optional().describe('Public contact email.',),
    analytics: z.string().optional().describe('Analytics snippet / tracking id.',),
    theme: z.string().optional().describe('Named theme id.',),
};

const tools = [
    // ─── Read ─────────────────────────────────────────────────────
    defineTool({
        name: 'get_public_settings',
        description:
            'Get the curated PUBLIC site settings projection: name, description, logo/favicon, social links, contact email, theme, and the `features` map (which modules are enabled). Fast, cache-friendly. Use list_features for a flat enabled/disabled view.',
        handler: async (_args, ctx: ToolContext,) => {
            return ctx.cms.settings.getPublic();
        },
    },),
    defineTool({
        name: 'get_settings',
        description:
            'Get ALL settings rows (admin) keyed by setting key, each { value, updatedAt, updatedBy? }. This is the raw store behind the curated public projection — includes site-header/footer/appearance/branding blobs and any custom keys. Use get_setting to pick one key.',
        handler: async (_args, ctx: ToolContext,) => {
            return ctx.cms.settings.getAll();
        },
    },),
    defineTool({
        name: 'get_setting',
        description:
            'Read a SINGLE settings row by its key (from the admin all-rows dump). Returns { value, updatedAt, updatedBy? } or a not-found note. There is no dedicated single-key GET route, so this reads the full set and picks the key.',
        inputSchema: {
            key: z.string().describe('The settings key to read (e.g. "site_header", "appearance", or a custom key).',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const all = await ctx.cms.settings.getAll();
            const row = (all as Record<string, unknown>)[args.key];
            if (row === undefined) {
                return { key: args.key, found: false, keys: Object.keys(all as Record<string, unknown>,), };
            }
            return { key: args.key, found: true, ...(row as Record<string, unknown>), };
        },
    },),
    defineTool({
        name: 'list_features',
        description:
            'List every CMS feature module and whether it is enabled, derived from public settings: [{ key, enabled }]. Features: posts, campaigns, forms, messages, users, mailing_lists, patreon, shop. Use set_feature to toggle one (with dependency cascade), or uninstall_feature to permanently remove one.',
        handler: async (_args, ctx: ToolContext,) => {
            const settings = await ctx.cms.settings.getPublic();
            const features = (settings.features ?? {}) as Record<string, { enabled?: boolean; }>;
            return Object.entries(features,).map(([key, v,],) => ({ key, enabled: Boolean(v?.enabled,), }),);
        },
    },),

    // ─── Write ────────────────────────────────────────────────────
    defineTool({
        name: 'update_settings',
        description:
            'Update site CONFIG (partial — only provided fields change): siteName, siteDescription, logo, favicon, socialLinks, contactEmail, analytics, theme. This does NOT toggle features — use set_feature for that (kept separate so a config edit never accidentally flips a feature). GLOBAL site state. Returns a confirmation message.',
        write: true,
        inputSchema: configShape,
        handler: async (args, ctx: ToolContext,) => {
            const body: SettingsUpdateBody = {};
            for (const [k, v,] of Object.entries(args,)) {
                if (v !== undefined) (body as Record<string, unknown>)[k] = v;
            }
            return ctx.cms.settings.update(body,);
        },
    },),
    defineTool({
        name: 'set_setting',
        description:
            'Write a RAW settings row by key (escape hatch for any setting blob — header/footer/appearance/custom). `value` is stored verbatim as the row value. Prefer the typed tools (update_settings, update_appearance, update_site_header/footer) where they exist. GLOBAL site state.',
        write: true,
        inputSchema: {
            key: z.string().describe('The settings key to write.',),
            value: z.unknown().describe('The value to store (any JSON-able value; stored verbatim).',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.settings.setKey(args.key, { value: args.value, } as { value: unknown; },);
        },
    },),
    defineTool({
        name: 'delete_setting',
        description:
            'Delete a RAW settings row by key. Removes the row entirely. Returns a confirmation message.',
        write: true,
        inputSchema: {
            key: z.string().describe('The settings key to delete.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.settings.deleteKey(args.key,);
        },
    },),
    defineTool({
        name: 'set_feature',
        description:
            'Enable or disable ONE feature module (posts, campaigns, forms, messages, users, mailing_lists, patreon, shop). Enabling a feature may run lazy-install migrations; disabling may need dependents turned off first. If the dependency planner rejects the toggle it returns a CASCADE error carrying the plan (missing prerequisites to enable, or dependents to disable) — read it, then retry with enableDependencies:true (to also enable prerequisites) or disableDependents:true (to also disable dependents). GLOBAL, migration-bearing change.',
        write: true,
        inputSchema: {
            feature: z.string().describe('Feature key (e.g. "mailing_lists", "users", "shop").',),
            enabled: z.boolean().describe('true to enable, false to disable.',),
            enableDependencies: z.boolean().optional().describe('On enable: also enable any missing prerequisite features named in a cascade plan.',),
            disableDependents: z.boolean().optional().describe('On disable: also disable any dependent features named in a cascade plan.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const body: SettingsUpdateBody = {
                features: { [args.feature]: args.enabled, },
            };
            if (args.enableDependencies !== undefined) body.enableDependencies = args.enableDependencies;
            if (args.disableDependents !== undefined) body.disableDependents = args.disableDependents;
            return ctx.cms.settings.update(body,);
        },
    },),
    defineTool({
        name: 'uninstall_feature',
        description:
            'DESTRUCTIVE, IRREVERSIBLE: permanently uninstall a feature module. This DROPS its database TABLES and DELETES ALL its DATA (posts, campaigns, forms, subscribers, etc. depending on the feature). This is NOT the same as disabling (set_feature enabled:false), which only hides the feature. Only use when the operator explicitly wants the feature and all its data gone forever. Returns { message, droppedTables }.',
        write: true,
        inputSchema: {
            feature: z.string().describe('Feature key to uninstall (drops its tables + data).',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.settings.uninstallFeature(args.feature,);
        },
    },),
];

export const settingsTools: ToolDef[] = tools as unknown as ToolDef[];
