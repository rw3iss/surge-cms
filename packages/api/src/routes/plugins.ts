/**
 * Plugins module routes. Admin-only except the two inherent public reads the
 * running site uses to self-load widgets: `GET /enabled` and the same-origin
 * client bundle/assets. Mounted feature-gated (`plugins`) — 404 when disabled.
 */
import { z } from 'zod';
import multer from 'multer';
import type {
    PluginConfigBody,
    PluginMarketplaceQuery,
    PluginUninstallBody,
} from '@sitesurge/types';
import { defineRoute, reply } from '../api/defineRoute';
import { AppError } from '../core/errors';
import { config } from '../config';
import * as permissions from '../services/permissions';
import * as plugins from '../services/plugins';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.upload.maxSizeMb * 1024 * 1024 },
});

const nameParams = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/) });
const configBody = z.object({ config: z.record(z.string(), z.unknown()) }) satisfies z.ZodType<PluginConfigBody>;
const uninstallBody = z.object({ confirm: z.literal(true) }) satisfies z.ZodType<PluginUninstallBody>;
const marketplaceQuery = z.object({ q: z.string().optional() }) satisfies z.ZodType<PluginMarketplaceQuery>;

/**
 * Every admin plugin route also needs `plugins:manage` (default admin +
 * sysadmin, so today's access is unchanged). An `ssk_` API key has already
 * passed its scope check in the `admin` tier.
 */
type Caller = { user?: { id?: string; role?: string; }; apiKey?: unknown; };
const manage = async ({ user, apiKey, }: Caller,): Promise<void> => {
    if (apiKey) return;
    await permissions.requirePermission({ id: user?.id, role: user?.role, } as never, 'plugins:manage',);
};

export const pluginsRoutes = [
    // ── inherent public ──
    defineRoute({
        method: 'get', path: '/enabled', auth: 'public',
        summary: 'List enabled plugins + client bundle URLs (the running site self-loads these).',
        handler: () => plugins.listEnabledPublic(),
    }),
    defineRoute({
        method: 'get', path: '/:name/client.js', auth: 'public', raw: true,
        summary: 'Serve a plugin\'s browser ESM bundle (same-origin).',
        input: { params: nameParams },
        handler: ({ params, res }) => {
            const p = plugins.clientBundlePath(params.name);
            if (!p) { res.status(404).end(); return; }
            res.type('application/javascript');
            res.sendFile(p);
        },
    }),
    defineRoute({
        method: 'get', path: '/:name/assets/:file', auth: 'public', raw: true,
        summary: 'Serve a plugin static asset from its client/ folder.',
        input: { params: nameParams.extend({ file: z.string() }) },
        handler: ({ params, res }) => {
            const p = plugins.assetPath(params.name, params.file);
            if (!p) { res.status(404).end(); return; }
            res.sendFile(p);
        },
    }),

    // ── admin: reads ──
    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List all installed/discovered plugins (admin table view).',
        handler: async (c) => { await manage(c); return plugins.list(); },
    }),
    defineRoute({
        method: 'get', path: '/marketplace', auth: 'admin',
        summary: 'Search the plugin marketplace (stubbed).',
        input: { query: marketplaceQuery },
        handler: async (c) => { await manage(c); return plugins.marketplaceSearch(c.query.q); },
    }),
    defineRoute({
        method: 'get', path: '/:name', auth: 'admin',
        summary: 'Get one plugin (detail + config + manifest).',
        input: { params: nameParams },
        handler: async (c) => { await manage(c); return plugins.getOne(c.params.name); },
    }),

    // ── admin: mutations ──
    defineRoute({
        method: 'post', path: '/rescan', auth: 'admin',
        summary: 'Re-scan PLUGINS_DIR and reconcile with the DB.',
        handler: async (c) => { await manage(c); return plugins.rescan(); },
    }),
    defineRoute({
        method: 'post', path: '/upload', auth: 'admin',
        summary: 'Upload a plugin .zip (unzipped into PLUGINS_DIR, registered disabled).',
        pre: [upload.single('file')],
        handler: async ({ req, audit, user, apiKey }) => {
            await manage({ user, apiKey });
            const file = (req as { file?: { buffer: Buffer } }).file;
            if (!file) throw new AppError(400, 'BAD_REQUEST', 'No file uploaded (field "file")');
            return reply(await plugins.installFromZip(file.buffer, audit()), { status: 201 });
        },
    }),
    defineRoute({
        method: 'post', path: '/marketplace/:id/install', auth: 'admin',
        summary: 'Install a plugin from the marketplace (stubbed).',
        input: { params: z.object({ id: z.string() }) },
        handler: async (c) => { await manage(c); return plugins.marketplaceInstall(c.params.id, c.audit()); },
    }),
    defineRoute({
        method: 'post', path: '/:name/install', auth: 'admin',
        summary: 'Run the plugin\'s install() hook.',
        input: { params: nameParams },
        handler: async (c) => { await manage(c); return plugins.install(c.params.name, c.audit()); },
    }),
    defineRoute({
        method: 'put', path: '/:name/config', auth: 'admin',
        summary: 'Save (merge) a plugin\'s config.',
        input: { params: nameParams, body: configBody },
        handler: async (c) => { await manage(c); return plugins.saveConfig(c.params.name, c.body.config, c.audit()); },
    }),
    defineRoute({
        method: 'post', path: '/:name/action/:action', auth: 'admin',
        summary: 'Dispatch a plugin-defined backend action.',
        input: {
            params: nameParams.extend({ action: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/) }),
            body: z.record(z.string(), z.unknown()).optional(),
        },
        handler: async (c) => {
            await manage(c);
            return plugins.dispatchAction(c.params.name, c.params.action, (c.body ?? {}) as Record<string, unknown>, c.audit());
        },
    }),
    defineRoute({
        method: 'post', path: '/:name/enable', auth: 'admin',
        summary: 'Enable a plugin.',
        input: { params: nameParams },
        handler: async (c) => { await manage(c); return plugins.enable(c.params.name, c.audit()); },
    }),
    defineRoute({
        method: 'post', path: '/:name/disable', auth: 'admin',
        summary: 'Disable a plugin (data preserved).',
        input: { params: nameParams },
        handler: async (c) => { await manage(c); return plugins.disable(c.params.name, c.audit()); },
    }),
    defineRoute({
        method: 'post', path: '/:name/update', auth: 'admin',
        summary: 'Run the plugin\'s update() hook.',
        input: { params: nameParams },
        handler: async (c) => { await manage(c); return plugins.update(c.params.name, c.audit()); },
    }),
    defineRoute({
        method: 'post', path: '/:name/uninstall', auth: 'admin',
        summary: 'Uninstall a plugin: run uninstall(), drop owned tables, remove folder.',
        input: { params: nameParams, body: uninstallBody },
        handler: async ({ params, audit, user, apiKey }) => {
            await manage({ user, apiKey });
            const { droppedTables } = await plugins.uninstall(params.name, audit());
            return { message: `Removed ${params.name}`, droppedTables };
        },
    }),
];
