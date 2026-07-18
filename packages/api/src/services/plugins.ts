/**
 * Plugins service — canonical business logic for the plugin system.
 * Reconciles the on-disk PLUGINS_DIR with the `plugins` table, runs the
 * lifecycle hooks (install/enable/disable/update/uninstall) transactionally
 * with an advisory lock, serves client bundles, and exposes the inherent
 * public projection the running site loads. Admin-gated at the route layer.
 */
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type {
    MarketplacePlugin,
    Plugin,
    PluginManifest,
    PluginUpdateResult,
    PublicPlugin,
} from '@sitesurge/types';
import * as repo from '../repositories/plugins.repo';
import { setPluginCspOrigins, type PluginCspOrigins } from '../middleware/csp';
import { logAudit } from './audit';
import type { AuditContext } from './types';
import { AppError, NotFoundError, ValidationError } from '../middleware/error';
import { logger } from '../utils/logger';
import {
    buildContext,
    discoverCatalog,
    discoverOnDisk,
    getServerModule,
    pluginsRootDir,
    readManifestAt,
    withPluginTxn,
    type DiscoveredPlugin,
} from '../plugins/loader';

// ── helpers ───────────────────────────────────────────────────────────────────
/** Whether the on-disk plugin's server module exports an `update()` hook. */
function pluginHasUpdateHook(name: string): boolean {
    try {
        const d = diskMap().get(name);
        if (!d) return false;
        const mod = getServerModule(d.dir, d.manifest);
        return typeof mod?.update === 'function';
    } catch {
        return false;
    }
}

function withUpdateFlag(p: Plugin): Plugin {
    return {
        ...p,
        updateAvailable: Boolean(p.installed && p.installedVersion && p.installedVersion !== p.version),
        hasUpdateHook: pluginHasUpdateHook(p.name),
    };
}

function diskMap(): Map<string, DiscoveredPlugin> {
    return new Map(discoverOnDisk().map((d) => [d.name, d]));
}

function mustFindOnDisk(name: string): DiscoveredPlugin {
    const d = diskMap().get(name);
    if (!d) throw new NotFoundError(`Plugin "${name}" on disk`);
    return d;
}

async function mustGetRow(name: string): Promise<Plugin> {
    const p = await repo.getByName(name);
    if (!p) throw new NotFoundError(`Plugin "${name}"`);
    return p;
}

async function audit(action: string, name: string, ctx: AuditContext): Promise<void> {
    await logAudit({
        userId: ctx.userId,
        action,
        entityType: 'plugin',
        entityId: name,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    });
}

// ── discovery / reconciliation ──────────────────────────────────────────────────
/** Reconcile PLUGINS_DIR with the DB: insert new folders, refresh manifests. */
export async function rescan(): Promise<Plugin[]> {
    const onDisk = diskMap();
    const rows = await repo.listPlugins();
    const byName = new Map(rows.map((r) => [r.name, r]));

    for (const [name, d] of onDisk) {
        const existing = byName.get(name);
        if (!existing) {
            await repo.insertDiscovered({
                name,
                label: d.manifest.label,
                version: d.manifest.version,
                source: 'manual',
                location: name,
                manifest: d.manifest,
            });
        } else if (existing.version !== d.manifest.version || existing.label !== d.manifest.label) {
            await repo.reconcileManifest(name, {
                version: d.manifest.version,
                label: d.manifest.label,
                manifest: d.manifest,
            });
        }
    }
    // Flag rows whose folder vanished (keep the row; surface an error).
    for (const row of rows) {
        if (!onDisk.has(row.name) && !row.error) {
            await repo.setError(row.name, 'Plugin folder missing from disk');
        }
    }
    return list();
}

export async function list(): Promise<Plugin[]> {
    return (await repo.listPlugins()).map(withUpdateFlag);
}

export async function getOne(name: string): Promise<Plugin> {
    return withUpdateFlag(await mustGetRow(name));
}

// ── generic action dispatch ─────────────────────────────────────────────────────
/**
 * Invoke a plugin-defined backend action (`server.js` `actions[action]`). Reused
 * by any plugin that needs server-side operations (e.g. proxying a secret-keyed
 * third-party API) without registering its own Express routes. NOT wrapped in
 * `withPluginTxn` — actions typically make external HTTP calls and must not hold
 * the plugin advisory lock across network I/O; an action that mutates plugin
 * tables should manage its own transaction.
 */
export async function dispatchAction(
    name: string,
    action: string,
    payload: Record<string, unknown>,
    ctx: AuditContext,
): Promise<unknown> {
    const row = await mustGetRow(name);
    if (!row.enabled || !row.installed || row.error) {
        throw new AppError(409, 'PLUGIN_UNAVAILABLE', `Plugin "${name}" is not enabled`);
    }
    const disk = mustFindOnDisk(name);
    const mod = getServerModule(disk.dir, disk.manifest);
    const fn = mod?.actions?.[action];
    if (!fn) throw new AppError(404, 'ACTION_NOT_FOUND', `Plugin "${name}" has no action "${action}"`);
    const pctx = buildContext({
        name, dir: disk.dir, manifest: disk.manifest,
        config: row.config, installedVersion: row.installedVersion,
    });
    try {
        const result = await fn(pctx, payload ?? {});
        await audit(`plugin.action:${action}`, name, ctx);
        return result;
    } catch (err) {
        pctx.logger.error(`action "${action}" failed`, {
            error: err instanceof Error ? err.message : err,
        });
        throw err instanceof AppError
            ? err
            : new AppError(502, 'PLUGIN_ACTION_FAILED', err instanceof Error ? err.message : 'Action failed');
    }
}

// ── inherent public projection ──────────────────────────────────────────────────
export async function listEnabledPublic(): Promise<PublicPlugin[]> {
    const rows = (await repo.listPlugins()).filter((p) => p.enabled && p.installed && !p.error);
    return rows.map((p) => {
        const secretKeys = new Set(
            (p.manifest.configSchema ?? []).filter((f) => f.secret || f.type === 'secret').map((f) => f.key),
        );
        const publicConfig: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(p.config)) {
            if (!secretKeys.has(k)) publicConfig[k] = v;
        }
        return {
            name: p.name,
            label: p.label,
            version: p.version,
            capabilities: p.manifest.capabilities ?? [],
            clientUrl: p.manifest.client ? `/api/v1/plugins/${p.name}/client.js` : null,
            config: publicConfig,
            adminOnly: p.config.adminOnly === true,
        };
    });
}

// ── serving client bundle + assets (traversal-guarded) ──────────────────────────
export function clientBundlePath(name: string): string | null {
    const d = diskMap().get(name);
    if (!d?.manifest.client) return null;
    const p = path.resolve(d.dir, d.manifest.client);
    if (!p.startsWith(path.resolve(d.dir)) || !fs.existsSync(p)) return null;
    return p;
}

export function assetPath(name: string, rel: string): string | null {
    const d = diskMap().get(name);
    if (!d) return null;
    const base = path.resolve(d.dir, 'client');
    const p = path.resolve(base, rel);
    if (!p.startsWith(base) || !fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
    return p;
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
export async function install(name: string, ctx: AuditContext): Promise<Plugin> {
    const row = await mustGetRow(name);
    const disk = mustFindOnDisk(name);
    const mod = getServerModule(disk.dir, disk.manifest);
    try {
        await withPluginTxn(name, async (client) => {
            const pctx = buildContext({
                name, dir: disk.dir, manifest: disk.manifest,
                config: row.config, installedVersion: row.installedVersion, client,
            });
            await pctx.db.migrate();
            await mod?.install?.(pctx);
        });
    } catch (err) {
        await repo.setError(name, (err as Error).message);
        throw new AppError(500, 'PLUGIN_INSTALL_FAILED', `Install failed: ${(err as Error).message}`);
    }
    const updated = await repo.setInstalled(name, disk.manifest.version);
    await audit('plugin.install', name, ctx);
    return withUpdateFlag(updated);
}

export async function saveConfig(name: string, cfg: Record<string, unknown>, ctx: AuditContext): Promise<Plugin> {
    const row = await mustGetRow(name);
    const disk = diskMap().get(name);
    const mod = disk ? getServerModule(disk.dir, disk.manifest) : null;
    if (mod?.validateConfig) {
        const res = mod.validateConfig(cfg);
        if (!res.ok) throw new ValidationError('Invalid plugin config', res.errors);
    }
    const merged = { ...row.config, ...cfg };
    const updated = await repo.setConfig(name, merged);
    await refreshPluginCsp();
    await audit('plugin.configure', name, ctx);
    return withUpdateFlag(updated);
}

export async function enable(name: string, ctx: AuditContext): Promise<Plugin> {
    const row = await mustGetRow(name);
    if (!row.installed) throw new ValidationError('Install the plugin before enabling it');
    const disk = mustFindOnDisk(name);
    const mod = getServerModule(disk.dir, disk.manifest);
    try {
        await withPluginTxn(name, async (client) => {
            const pctx = buildContext({
                name, dir: disk.dir, manifest: disk.manifest,
                config: row.config, installedVersion: row.installedVersion, client,
            });
            await mod?.onEnable?.(pctx);
            await mod?.onLoad?.(pctx);
        });
    } catch (err) {
        await repo.setError(name, (err as Error).message);
        throw new AppError(500, 'PLUGIN_ENABLE_FAILED', `Enable failed: ${(err as Error).message}`);
    }
    const updated = await repo.setEnabled(name, true);
    await refreshPluginCsp();
    await audit('plugin.enable', name, ctx);
    return withUpdateFlag(updated);
}

export async function disable(name: string, ctx: AuditContext): Promise<Plugin> {
    const row = await mustGetRow(name);
    const disk = diskMap().get(name);
    if (disk) {
        const mod = getServerModule(disk.dir, disk.manifest);
        try {
            await withPluginTxn(name, async (client) => {
                const pctx = buildContext({
                    name, dir: disk.dir, manifest: disk.manifest,
                    config: row.config, installedVersion: row.installedVersion, client,
                });
                await mod?.onDisable?.(pctx);
            });
        } catch (err) {
            logger.warn(`Plugin ${name} onDisable failed`, { error: (err as Error).message });
        }
    }
    const updated = await repo.setEnabled(name, false);
    await refreshPluginCsp();
    await audit('plugin.disable', name, ctx);
    return withUpdateFlag(updated);
}

export async function update(name: string, ctx: AuditContext): Promise<{ plugin: Plugin; result: PluginUpdateResult }> {
    const row = await mustGetRow(name);
    if (!row.installed) throw new ValidationError('Install the plugin before updating it');
    const disk = mustFindOnDisk(name);
    const mod = getServerModule(disk.dir, disk.manifest, /* reload */ true);
    let result: PluginUpdateResult = {
        fromVersion: row.installedVersion ?? row.version,
        toVersion: disk.manifest.version,
        migrated: false,
    };
    try {
        await withPluginTxn(name, async (client) => {
            const pctx = buildContext({
                name, dir: disk.dir, manifest: disk.manifest,
                config: row.config, installedVersion: row.installedVersion, client,
            });
            const ran = await pctx.db.migrate();
            if (mod?.update) {
                result = await mod.update(pctx);
            } else {
                result.migrated = ran.length > 0;
            }
        });
    } catch (err) {
        await repo.setError(name, (err as Error).message);
        throw new AppError(500, 'PLUGIN_UPDATE_FAILED', `Update failed: ${(err as Error).message}`);
    }
    const updated = await repo.setInstalled(name, disk.manifest.version);
    await audit('plugin.update', name, ctx);
    return { plugin: withUpdateFlag(updated), result };
}

export async function uninstall(name: string, ctx: AuditContext): Promise<{ droppedTables: string[] }> {
    const row = await mustGetRow(name);
    const disk = diskMap().get(name);
    let droppedTables: string[] = [];
    await withPluginTxn(name, async (client) => {
        if (disk) {
            const mod = getServerModule(disk.dir, disk.manifest);
            const pctx = buildContext({
                name, dir: disk.dir, manifest: disk.manifest,
                config: row.config, installedVersion: row.installedVersion, client,
            });
            await mod?.uninstall?.(pctx);
        }
        // Drop this plugin's owned tables (catalog-sourced, prefix-validated).
        const tables = await client.query<{ tablename: string }>(
            `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE $1`,
            [`plugin_${name}_%`],
        );
        for (const t of tables.rows) {
            if (!/^plugin_[a-z0-9_]+$/.test(t.tablename)) continue;
            await client.query(`DROP TABLE IF EXISTS ${t.tablename} CASCADE`);
        }
        droppedTables = tables.rows.map((t) => t.tablename);
        await client.query('DELETE FROM plugin_migrations WHERE plugin = $1', [name]);
    });
    await repo.deleteByName(name);
    // Remove the folder (guarded to PLUGINS_DIR).
    if (disk) {
        const root = pluginsRootDir();
        const abs = path.resolve(disk.dir);
        if (abs.startsWith(path.resolve(root) + path.sep)) {
            try { fs.rmSync(abs, { recursive: true, force: true }); } catch (err) {
                logger.warn(`Could not remove plugin folder ${abs}`, { error: (err as Error).message });
            }
        }
    }
    await refreshPluginCsp();
    await audit('plugin.uninstall', name, ctx);
    return { droppedTables };
}

// ── upload (zip) ────────────────────────────────────────────────────────────────
export async function installFromZip(buffer: Buffer, ctx: AuditContext): Promise<Plugin> {
    const root = pluginsRootDir();
    fs.mkdirSync(root, { recursive: true });
    const zip = new AdmZip(buffer);
    // Guard against zip-slip: reject entries escaping the root.
    for (const e of zip.getEntries()) {
        const target = path.resolve(root, e.entryName);
        if (!target.startsWith(path.resolve(root) + path.sep)) {
            throw new ValidationError('Unsafe zip: entry escapes the plugins directory');
        }
    }
    // Extract into a temp dir first to read the manifest and learn the plugin name.
    const tmp = path.join(root, `.upload-${Date.now()}`);
    zip.extractAllTo(tmp, true);
    try {
        // Manifest may be at the root of the zip or one level down.
        let manifestDir = tmp;
        if (!fs.existsSync(path.join(tmp, 'plugin.json'))) {
            const sub = fs.readdirSync(tmp, { withFileTypes: true }).find((d) => d.isDirectory());
            if (sub && fs.existsSync(path.join(tmp, sub.name, 'plugin.json'))) {
                manifestDir = path.join(tmp, sub.name);
            }
        }
        const manifestPath = path.join(manifestDir, 'plugin.json');
        if (!fs.existsSync(manifestPath)) throw new ValidationError('Zip has no plugin.json');
        const manifest = readManifestAt(manifestDir);
        const dest = path.join(root, manifest.name);
        if (fs.existsSync(dest)) {
            throw new ValidationError(`Plugin "${manifest.name}" already exists — uninstall it first`);
        }
        fs.renameSync(manifestDir, dest);
        // Register as discovered + disabled.
        const existing = await repo.getByName(manifest.name);
        const plugin = existing
            ? await repo.reconcileManifest(manifest.name, { version: manifest.version, label: manifest.label, manifest })
            : await repo.insertDiscovered({
                name: manifest.name, label: manifest.label, version: manifest.version,
                source: 'upload', location: manifest.name, manifest,
            });
        await audit('plugin.upload', manifest.name, ctx);
        return withUpdateFlag(plugin);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// ── marketplace (first-party bundled catalog) ────────────────────────────────────
// The catalog is the set of first-party plugins bundled inside
// @sitesurge/server (dist/plugins-catalog). marketplaceInstall copies the
// chosen plugin into the consumer's PLUGINS_DIR and runs the normal
// install lifecycle — no external registry / network fetch of the plugin
// itself (a plugin's own install() may still fetch its vendor bundle).
export async function marketplaceSearch(q?: string): Promise<MarketplacePlugin[]> {
    const installed = new Set((await repo.listPlugins()).map((p) => p.name));
    const catalog: MarketplacePlugin[] = discoverCatalog().map((d) => {
        const m = d.manifest as PluginManifest & { description?: string; author?: string; homepage?: string; };
        return {
            id: d.name,
            name: d.name,
            label: m.label ?? d.name,
            description: m.description ?? '',
            version: m.version,
            author: m.author,
            homepage: m.homepage,
            installed: installed.has(d.name),
        };
    });
    const needle = (q ?? '').trim().toLowerCase();
    return needle
        ? catalog.filter((c) => `${c.name} ${c.label} ${c.description}`.toLowerCase().includes(needle))
        : catalog;
}

export async function marketplaceInstall(id: string, ctx: AuditContext): Promise<Plugin> {
    const entry = discoverCatalog().find((d) => d.name === id);
    if (!entry) throw new NotFoundError(`Marketplace plugin "${id}"`);

    const root = pluginsRootDir();
    fs.mkdirSync(root, { recursive: true });
    const dest = path.join(root, entry.name);
    if (fs.existsSync(dest)) {
        throw new ValidationError(`Plugin "${entry.name}" is already present — uninstall it first`);
    }
    // Copy the bundled plugin into the consumer's PLUGINS_DIR. The vendor
    // bundle (client/) isn't bundled; the plugin's install() fetches it.
    fs.cpSync(entry.dir, dest, { recursive: true });

    // Register as discovered, then run the standard install lifecycle
    // (migrations + install() hook) so it lands installed + ready to enable.
    const existing = await repo.getByName(entry.name);
    if (!existing) {
        await repo.insertDiscovered({
            name: entry.name, label: entry.manifest.label, version: entry.manifest.version,
            source: 'marketplace', location: entry.name, manifest: entry.manifest,
        });
    } else {
        await repo.reconcileManifest(entry.name, {
            version: entry.manifest.version, label: entry.manifest.label, manifest: entry.manifest,
        });
    }
    await audit('plugin.marketplace-install', entry.name, ctx);
    return install(entry.name, ctx);
}

// ── boot ────────────────────────────────────────────────────────────────────────
/** Called at server boot: reconcile disk, then onLoad each enabled plugin. Isolated. */
export async function bootPlugins(): Promise<void> {
    try {
        await rescan();
    } catch (err) {
        logger.warn('Plugin rescan at boot failed', { error: (err as Error).message });
        return;
    }
    const rows = await repo.listPlugins();
    for (const row of rows) {
        if (!row.enabled || !row.installed) continue;
        const disk = diskMap().get(row.name);
        if (!disk) continue;
        try {
            const mod = getServerModule(disk.dir, disk.manifest);
            if (!mod?.onLoad) continue;
            await withPluginTxn(row.name, async (client) => {
                const pctx = buildContext({
                    name: row.name, dir: disk.dir, manifest: disk.manifest,
                    config: row.config, installedVersion: row.installedVersion, client,
                });
                await mod.onLoad!(pctx);
            });
            logger.info(`Plugin loaded: ${row.name}@${row.version}`);
        } catch (err) {
            logger.error(`Plugin ${row.name} onLoad failed`, { error: (err as Error).message });
            await repo.setError(row.name, (err as Error).message);
        }
    }
    await refreshPluginCsp();
}

// ── CSP ───────────────────────────────────────────────────────────────────────
function toOrigin(v: unknown): string | null {
    if (typeof v !== 'string' || !v.trim()) return null;
    try { return new URL(v.trim()).origin; } catch { return null; }
}

/**
 * Recompute the CSP origins contributed by ENABLED plugins and push them
 * to the CSP middleware. Origins come from each plugin's `type:'url'`
 * config values (→ connect-src) plus its manifest `csp` block. Called at
 * boot and on every enable/disable/configure/uninstall so the browser can
 * reach a widget's backend without loosening the base policy.
 */
export async function refreshPluginCsp(): Promise<void> {
    const rows = (await repo.listPlugins()).filter((p) => p.enabled && p.installed && !p.error);
    const origins: PluginCspOrigins = { connectSrc: [], scriptSrc: [], styleSrc: [], imgSrc: [], frameSrc: [] };
    for (const p of rows) {
        for (const f of p.manifest.configSchema ?? []) {
            if (f.type === 'url') {
                const o = toOrigin(p.config[f.key]);
                if (o) {
                    origins.connectSrc.push(o);
                    // A widget that reaches its backend over http(s) often also opens
                    // a WebSocket to the same host (e.g. PageLoop's wss://…/ws). A
                    // connect-src http(s) origin does NOT cover the ws(s) scheme, so
                    // add the ws(s) twin explicitly.
                    const ws = o.replace(/^http(s?):\/\//, 'ws$1://');
                    if (ws !== o) origins.connectSrc.push(ws);
                }
            }
        }
        const csp = p.manifest.csp;
        if (csp) {
            origins.connectSrc.push(...(csp.connectSrc ?? []));
            origins.scriptSrc.push(...(csp.scriptSrc ?? []));
            origins.styleSrc.push(...(csp.styleSrc ?? []));
            origins.imgSrc.push(...(csp.imgSrc ?? []));
            origins.frameSrc.push(...(csp.frameSrc ?? []));
        }
    }
    setPluginCspOrigins(origins);
}
