import { Pool, PoolClient, QueryResult, QueryResultRow, types, } from 'pg';
import { getConfig, } from '../config';
import { logger, } from '../utils/logger';

// Postgres returns NUMERIC/DECIMAL (OID 1700) as a string by default to avoid
// float precision loss. The only NUMERIC column read into JS is
// `shop_products.rating_avg` (a 0–5 average), where a string breaks numeric use
// (e.g. `.toFixed`). Parse NUMERIC → float so the API honors its `number` types.
types.setTypeParser(1700, (v,) => (v === null ? null : parseFloat(v,)),);

/**
 * Lazy, recreatable Postgres pool.
 *
 * The previous module created the pool at import time using
 * `config.database.url`, which forced the whole backend to fail-fast on
 * a missing or stale DATABASE_URL — making it impossible to serve a
 * setup wizard. The pool now:
 *   - is created on first use (or first explicit initPool())
 *   - can be torn down and recreated via resetPool() to pick up a new
 *     DATABASE_URL written by the setup wizard, without process restart
 *   - throws a clear error if a query is attempted before any
 *     DATABASE_URL is configured
 */

let _pool: Pool | null = null;

function buildPool(): Pool {
    const cfg = getConfig();
    if (!cfg.database.url) {
        throw new Error(
            'DATABASE_URL is not configured. The backend is in setup mode; '
                + 'database access is not available until installation completes.',
        );
    }
    const pool = new Pool({
        connectionString: cfg.database.url,
        min: cfg.database.poolMin,
        max: cfg.database.poolMax,
    },);
    pool.on('error', (err,) => {
        logger.error('Unexpected database pool error', { error: err.message, },);
    },);
    return pool;
}

/** Returns the current pool, creating it on first call. */
export function getPool(): Pool {
    if (!_pool) {
        _pool = buildPool();
    }
    return _pool;
}

/** Force-create the pool. Used by the boot sequence after config is loaded. */
export function initPool(): Pool {
    if (_pool) return _pool;
    return getPool();
}

/**
 * Tear down the current pool. Used by the lifecycle hot-reload path
 * (option B) and by integration tests. Safe to call when no pool
 * exists. Returns when the underlying pool has actually closed (or after
 * a short timeout, so we never hang the process).
 */
export async function resetPool(): Promise<void> {
    if (!_pool) return;
    const closing = _pool;
    _pool = null;
    const CLOSE_TIMEOUT_MS = 800;
    await Promise.race([
        closing.end().catch((err,) => {
            logger.warn('Pool close errored', { error: (err as Error).message, },);
        }),
        new Promise<void>((resolve,) => setTimeout(resolve, CLOSE_TIMEOUT_MS,)),
    ],);
}

/**
 * Probe an arbitrary connection string without persisting any pool. Used
 * by the setup wizard's "Test connection" button.
 */
export async function probeConnection(
    url: string,
    timeoutMs = 3000,
): Promise<{ ok: true; serverVersion: string; } | { ok: false; error: string; }> {
    const probePool = new Pool({ connectionString: url, max: 1, },);
    try {
        const result = await Promise.race([
            probePool.query<{ version: string; }>('SELECT version() as version',),
            new Promise<never>((_, reject,) =>
                setTimeout(() => reject(new Error('Connection timed out',),), timeoutMs,)
            ),
        ],);
        const serverVersion = result.rows[0]?.version ?? 'unknown';
        return { ok: true, serverVersion, };
    } catch (error) {
        return { ok: false, error: (error as Error).message, };
    } finally {
        await probePool.end().catch(() => {/* ignore */});
    }
}

export async function query<T extends QueryResultRow = QueryResultRow,>(
    text: string,
    params?: unknown[],
): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
        const result = await getPool().query<T>(text, params,);
        const duration = Date.now() - start;
        logger.debug('Executed query', { text: text.substring(0, 100,), duration, rows: result.rowCount, },);
        return result;
    } catch (error) {
        logger.error('Database query error', { text: text.substring(0, 100,), error, },);
        throw error;
    }
}

export async function getClient(): Promise<PoolClient> {
    const client = await getPool().connect();
    const originalQuery = client.query.bind(client,);
    const originalRelease = client.release.bind(client,);

    const timeout = setTimeout(() => {
        logger.error('Database client has been checked out for more than 30 seconds',);
    }, 30000,);

    client.release = () => {
        clearTimeout(timeout,);
        return originalRelease();
    };

    client.query = ((...args: Parameters<typeof originalQuery>) => {
        return originalQuery(...args,);
    }) as typeof client.query;

    return client;
}

export async function transaction<T,>(
    callback: (client: PoolClient,) => Promise<T>,
): Promise<T> {
    const client = await getClient();
    try {
        await client.query('BEGIN',);
        const result = await callback(client,);
        await client.query('COMMIT',);
        return result;
    } catch (error) {
        await client.query('ROLLBACK',);
        throw error;
    } finally {
        client.release();
    }
}

export async function healthCheck(timeoutMs = 2000,): Promise<boolean> {
    try {
        await Promise.race([
            query('SELECT 1',),
            new Promise<never>((_, reject,) =>
                setTimeout(() => reject(new Error('Healthcheck timeout',),), timeoutMs,)
            ),
        ],);
        return true;
    } catch {
        return false;
    }
}

export async function closePool(): Promise<void> {
    await resetPool();
}

/**
 * Backward-compat: `import { pool } from './client'`. The Proxy forwards
 * to the lazily-created pool so existing imports keep working.
 */
export const pool: Pool = new Proxy({} as Pool, {
    get(_target, prop,) {
        const realPool = getPool();
        const value = (realPool as unknown as Record<string | symbol, unknown>)[prop as string];
        return typeof value === 'function' ? (value as Function).bind(realPool,) : value;
    },
},);
