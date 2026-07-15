/**
 * Plugin loader: filesystem discovery, Node module loading, scoped context
 * construction, plugin-owned migrations, and transactional hook execution.
 *
 * Plugins live under PLUGINS_DIR (default ./plugins, resolved from cwd) so they
 * live in the CONSUMER project and survive @sitesurge/server npm upgrades.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { PoolClient } from 'pg';
import type { PluginManifest } from '@sitesurge/types';
import { config } from '../config';
import { getPool } from '../db/client';
import { logger } from '../utils/logger';
import type {
    PluginDb,
    PluginServerContext,
    PluginServerModule,
    PluginStorage,
} from './types';

const requirePlugin = createRequire(__filename);

/** Current plugin API contract version. Manifests must match. */
export const PLUGIN_API_VERSION = 1;

export interface DiscoveredPlugin {
    name: string;
    dir: string;
    manifest: PluginManifest;
}

/** Absolute PLUGINS_DIR. */
export function pluginsRootDir(): string {
    return path.resolve(process.cwd(), config.pluginsDir);
}

function isSafeName(name: string): boolean {
    return /^[a-z0-9][a-z0-9-]{0,62}$/.test(name);
}

/** Read + validate a plugin.json at `dir`. Throws on invalid. */
export function readManifestAt(dir: string): PluginManifest {
    const file = path.join(dir, 'plugin.json');
    const raw = fs.readFileSync(file, 'utf-8');
    const m = JSON.parse(raw) as PluginManifest;
    if (!m.name || !isSafeName(m.name)) throw new Error(`plugin.json: invalid name "${m.name}"`);
    if (path.basename(dir) !== m.name) {
        throw new Error(`plugin "${m.name}" must live in a folder named "${m.name}" (found ${path.basename(dir)})`);
    }
    if (!m.version) throw new Error(`plugin "${m.name}": missing version`);
    if (typeof m.apiVersion !== 'number') throw new Error(`plugin "${m.name}": missing apiVersion`);
    if (m.apiVersion > PLUGIN_API_VERSION) {
        throw new Error(`plugin "${m.name}" requires plugin API v${m.apiVersion}; host supports v${PLUGIN_API_VERSION}`);
    }
    m.label = m.label || m.name;
    m.capabilities = m.capabilities || [];
    m.configSchema = m.configSchema || [];
    return m;
}

/** Scan a directory for immediate subfolders containing a valid plugin.json. */
function discoverInDir(root: string): DiscoveredPlugin[] {
    if (!fs.existsSync(root)) return [];
    const out: DiscoveredPlugin[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        if (!fs.existsSync(path.join(dir, 'plugin.json'))) continue;
        try {
            out.push({ name: entry.name, dir, manifest: readManifestAt(dir) });
        } catch (err) {
            logger.warn(`Skipping invalid plugin in ${dir}`, { error: (err as Error).message });
        }
    }
    return out;
}

/** Scan PLUGINS_DIR (the consumer's installed plugins). */
export function discoverOnDisk(): DiscoveredPlugin[] {
    return discoverInDir(pluginsRootDir());
}

/**
 * Absolute path to the first-party plugin catalog bundled INSIDE
 * @sitesurge/server. The build's copy-assets step copies `plugins/*`
 * (minus vendor bundles) into `dist/plugins-catalog/`; in dev (tsx from
 * `src/`) it falls back to the repo's `packages/api/plugins/`. Returns
 * '' if neither exists.
 */
export function bundledCatalogDir(): string {
    const candidates = [
        path.join(__dirname, '..', 'plugins-catalog'), // built: dist/plugins/ → dist/plugins-catalog
        path.join(__dirname, '..', '..', 'plugins'), //     dev: src/plugins/ → packages/api/plugins
    ];
    return candidates.find((c) => fs.existsSync(c)) ?? '';
}

/** Discover the bundled first-party plugin catalog (installable via the marketplace). */
export function discoverCatalog(): DiscoveredPlugin[] {
    const root = bundledCatalogDir();
    return root ? discoverInDir(root) : [];
}

/** Load a plugin's server module (CommonJS). `reload` busts the require cache. */
export function getServerModule(
    dir: string,
    manifest: PluginManifest,
    reload = false,
): PluginServerModule | null {
    if (!manifest.server) return null;
    const serverPath = path.join(dir, manifest.server);
    if (!fs.existsSync(serverPath)) return null;
    if (reload) delete requirePlugin.cache[requirePlugin.resolve(serverPath)];
    const raw = requirePlugin(serverPath) as PluginServerModule & { default?: PluginServerModule };
    return (raw.default ?? raw) as PluginServerModule;
}

// ── plugin-owned migrations ───────────────────────────────────────────────────
async function applyPluginMigrations(
    name: string,
    dir: string,
    client: Pick<PoolClient, 'query'>,
): Promise<string[]> {
    const migDir = path.join(dir, 'migrations');
    if (!fs.existsSync(migDir)) return [];
    const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
    if (files.length === 0) return [];
    const applied = await client.query<{ filename: string }>(
        'SELECT filename FROM plugin_migrations WHERE plugin = $1',
        [name],
    );
    const done = new Set(applied.rows.map((r) => r.filename));
    const ran: string[] = [];
    for (const f of files) {
        if (done.has(f)) continue;
        const sql = fs.readFileSync(path.join(migDir, f), 'utf-8');
        await client.query(sql);
        await client.query(
            'INSERT INTO plugin_migrations (plugin, filename) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [name, f],
        );
        ran.push(f);
        logger.info(`Plugin ${name}: applied migration ${f}`);
    }
    return ran;
}

// ── scoped context ─────────────────────────────────────────────────────────────
export interface BuildContextOpts {
    name: string;
    dir: string;
    manifest: PluginManifest;
    config: Record<string, unknown>;
    installedVersion: string | null;
    /** When inside a txn, bind db to this client; else use the pool. */
    client?: PoolClient;
}

function makeStorage(name: string, dir: string): PluginStorage {
    const dataDir = path.join(pluginsRootDir(), name, '.data');
    const resolve = (rel: string, base = dir): string => {
        const p = path.resolve(base, rel);
        if (!p.startsWith(path.resolve(base))) throw new Error('path escapes plugin dir');
        return p;
    };
    return {
        dir,
        dataDir,
        exists: (rel) => fs.existsSync(resolve(rel)),
        read: async (rel) => fs.promises.readFile(resolve(rel), 'utf-8'),
        write: async (rel, content) => {
            const p = resolve(rel);
            await fs.promises.mkdir(path.dirname(p), { recursive: true });
            await fs.promises.writeFile(p, content);
        },
        download: async (url, rel, opts) => {
            const p = resolve(rel);
            if (!opts?.force && fs.existsSync(p)) return;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`download ${url} → ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            await fs.promises.mkdir(path.dirname(p), { recursive: true });
            await fs.promises.writeFile(p, buf);
        },
    };
}

export function buildContext(opts: BuildContextOpts): PluginServerContext {
    const { name, dir, config: cfg, installedVersion, client } = opts;
    const runner: Pick<PoolClient, 'query'> = client ?? getPool();
    const db: PluginDb = {
        query: async (sql, params) => {
            const r = await runner.query(sql, params as unknown[]);
            return { rows: r.rows as never[], rowCount: r.rowCount ?? 0 };
        },
        tableName: (suffix) => `plugin_${name}_${suffix.replace(/[^a-z0-9_]/gi, '')}`,
        migrate: () => applyPluginMigrations(name, dir, runner),
    };
    const pluginLogger = {
        info: (m: string, meta?: unknown) => logger.info(`[plugin:${name}] ${m}`, meta as object),
        warn: (m: string, meta?: unknown) => logger.warn(`[plugin:${name}] ${m}`, meta as object),
        error: (m: string, meta?: unknown) => logger.error(`[plugin:${name}] ${m}`, meta as object),
    };
    return {
        name,
        dir,
        version: opts.manifest.version,
        installedVersion,
        config: cfg,
        db,
        storage: makeStorage(name, dir),
        logger: pluginLogger,
        http: fetch,
    };
}

/** Run `fn` inside a txn with an advisory lock keyed on the plugin. */
export async function withPluginTxn<T>(
    name: string,
    fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`plugin:${name}`]);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}
