import type { DetectedInfra, InstallationState, InstallStage, } from '../../core/types/installation';
import { configParseFailed, getConfig, hasMinimalRunningConfig, } from '../../config';
import { probeConnection, } from '../../db/client';
import { Pool, } from 'pg';
import { logger, } from '../../utils/logger';

/**
 * Decides whether the backend should boot in setup mode and, if so, why.
 *
 * Stages, in order of severity:
 *   - 'env'     → minimal env vars missing (DATABASE_URL or JWT_SECRET)
 *   - 'db'      → env present but DB unreachable
 *   - 'install' → DB reachable but no `installed=true` row in site_settings
 *   - 'ready'   → fully installed
 *
 * The result is cached because it is read on most requests via the
 * setup gate. `invalidateInstallationState()` clears the cache; the
 * setup pipeline calls it after every step that could change the
 * answer.
 */

const CACHE_TTL_MS = 5_000;

let _cached: { value: InstallationState; at: number; } | null = null;

export function invalidateInstallationState(): void {
    _cached = null;
}

async function probeDb(): Promise<{ reachable: boolean; hint?: DetectedInfra['dbHint']; adminCount?: number; }> {
    const cfg = getConfig();
    if (!cfg.database.url) return { reachable: false, };
    const probe = await probeConnection(cfg.database.url, 2000,);
    if (!probe.ok) return { reachable: false, hint: parseDbHint(cfg.database.url,), };

    // If we can reach the DB, also check for admin count and the installed marker.
    // We use a fresh transient pool because the main pool may not be initialized yet.
    const transient = new Pool({ connectionString: cfg.database.url, max: 1, },);
    try {
        const adminRes = await transient.query<{ count: string; }>(
            `SELECT COUNT(*)::text AS count
             FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'users'`,
        );
        const usersTableExists = Number(adminRes.rows[0]?.count ?? 0,) > 0;
        let adminCount = 0;
        if (usersTableExists) {
            const r = await transient.query<{ count: string; }>(
                `SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin' AND is_active = true`,
            );
            adminCount = Number(r.rows[0]?.count ?? 0,);
        }
        return { reachable: true, hint: parseDbHint(cfg.database.url,), adminCount, };
    } catch (error) {
        logger.debug('probeDb post-connect query failed', { error: (error as Error).message, },);
        return { reachable: true, hint: parseDbHint(cfg.database.url,), };
    } finally {
        await transient.end().catch(() => {/* ignore */});
    }
}

async function probeRedis(): Promise<boolean> {
    const cfg = getConfig();
    if (!cfg.redis.url) return false;
    try {
        const { default: Redis, } = await import('ioredis');
        const client = new Redis(cfg.redis.url, { lazyConnect: true, maxRetriesPerRequest: 1, },);
        try {
            await client.connect();
            const pong = await client.ping();
            return pong === 'PONG';
        } finally {
            client.disconnect();
        }
    } catch (error) {
        logger.debug('probeRedis failed', { error: (error as Error).message, },);
        return false;
    }
}

function parseDbHint(url: string,): DetectedInfra['dbHint'] | undefined {
    try {
        const u = new URL(url,);
        return {
            host: u.hostname || undefined,
            port: u.port ? Number(u.port,) : undefined,
            database: u.pathname?.replace(/^\//, '',) || undefined,
            user: u.username || undefined,
        };
    } catch {
        return undefined;
    }
}

async function isMarkedInstalled(): Promise<{ installed: boolean; installedAt?: string; }> {
    const cfg = getConfig();
    if (!cfg.database.url) return { installed: false, };
    const transient = new Pool({ connectionString: cfg.database.url, max: 1, },);
    try {
        const tableRes = await transient.query<{ exists: boolean; }>(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'site_settings'
            ) AS exists`,
        );
        if (!tableRes.rows[0]?.exists) return { installed: false, };

        const installedRes = await transient.query<{ value: string; updated_at: Date; }>(
            `SELECT value, updated_at FROM site_settings WHERE key = 'installed'`,
        );
        if (installedRes.rowCount === 0) return { installed: false, };
        const raw = installedRes.rows[0].value;
        const parsed = typeof raw === 'string' ? JSON.parse(raw,) : raw;
        return {
            installed: parsed === true,
            installedAt: installedRes.rows[0].updated_at?.toISOString(),
        };
    } catch (error) {
        logger.debug('isMarkedInstalled failed', { error: (error as Error).message, },);
        return { installed: false, };
    } finally {
        await transient.end().catch(() => {/* ignore */});
    }
}

async function compute(): Promise<InstallationState> {
    const cfg = getConfig();
    const blockers: string[] = [];

    // Stage 1: env
    if (configParseFailed()) {
        blockers.push('Environment variables failed validation',);
    }
    if (!hasMinimalRunningConfig()) {
        if (!cfg.database.url) blockers.push('DATABASE_URL is not configured',);
        if (!cfg.jwt.secret || cfg.jwt.secret.length < 32) blockers.push('JWT_SECRET is missing or too short',);
        const detected: DetectedInfra = {
            dbReachable: false,
            redisReachable: false,
            hasJwtSecret: Boolean(cfg.jwt.secret) && (cfg.jwt.secret?.length ?? 0) >= 32,
        };
        return { needsSetup: true, stage: 'env', blockers, detected, };
    }

    // Stage 2: db reachability
    const db = await probeDb();
    if (!db.reachable) {
        blockers.push('Database is unreachable with current DATABASE_URL',);
        return {
            needsSetup: true,
            stage: 'db',
            blockers,
            detected: {
                dbReachable: false,
                dbHint: db.hint,
                redisReachable: false,
                hasJwtSecret: true,
            },
        };
    }

    // Stage 3: install marker
    const marker = await isMarkedInstalled();
    const redisReachable = await probeRedis();

    const detected: DetectedInfra = {
        dbReachable: true,
        dbHint: db.hint,
        redisReachable,
        adminCount: db.adminCount,
        hasJwtSecret: true,
    };

    if (!marker.installed) {
        blockers.push('Installation has not been completed (no installed=true in site_settings)',);
        return { needsSetup: true, stage: 'install', blockers, detected, };
    }

    return {
        needsSetup: false,
        stage: 'ready',
        blockers: [],
        detected,
        installedAt: marker.installedAt,
    };
}

export async function getInstallationState(force = false,): Promise<InstallationState> {
    if (!force && _cached && Date.now() - _cached.at < CACHE_TTL_MS) {
        return _cached.value;
    }
    const value = await compute();
    _cached = { value, at: Date.now(), };
    return value;
}

/** Synchronous best-effort read of the most recent state, or null if never computed. Used by the policy layer when blocking takes precedence over a slow probe. */
export function peekInstallationState(): InstallationState | null {
    return _cached?.value ?? null;
}

export type { InstallationState, InstallStage, };
