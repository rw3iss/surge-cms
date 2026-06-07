import fs from 'fs';
import path from 'path';
import type { Pool, } from 'pg';
import { logger, } from '../utils/logger';
import { getPool, } from './client';

/**
 * Library form of the migration runner. The previous implementation lived
 * inline in `migrate.ts`, called `pool.end()` at the end, and used
 * `process.exit` on failure. Both are unsafe inside a long-running
 * process (e.g. the setup wizard's `/install` endpoint). This module
 * extracts the same logic as plain async functions; the CLI wrapper in
 * `migrate.ts` stays thin and adds the process-level lifecycle.
 *
 * All functions take an explicit `Pool` so the setup pipeline can pass
 * a transient pool that uses freshly-entered credentials, before the
 * application's main pool is initialized.
 */

const MIGRATIONS_DIR = path.join(__dirname, 'migrations',);
const SCHEMA_PATH = path.join(__dirname, 'schema.sql',);
const BASE_MIGRATION_NAME = '000_schema.sql';

const FEATURE_HEADER_RE = /^\s*--\s*@feature\s+(\w+)\s*$/m;

/**
 * Parse the optional `-- @feature <key>` header off a migration's SQL.
 * Migrations without a header are global; migrations with one are only
 * applied when the corresponding feature is enabled.
 */
export function parseFeatureHeader(sql: string,): string | null {
    const m = sql.match(FEATURE_HEADER_RE,);
    return m ? m[1] : null;
}

async function ensureMigrationsTable(pool: Pool,): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id SERIAL PRIMARY KEY,
            filename VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMPTZ DEFAULT NOW(),
            feature VARCHAR(64) NULL
        );
    `,);
    // Backfill the column for installs created before the feature
    // tagging shipped — IF NOT EXISTS keeps this idempotent.
    await pool.query(
        `ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS feature VARCHAR(64) NULL`,
    );
}

/**
 * Read enabled features from `site_settings`. Used to decide whether to
 * skip feature-tagged migrations at boot. Tolerates a missing table on
 * the very first install (returns empty set).
 */
async function getEnabledFeatures(pool: Pool,): Promise<Set<string>> {
    try {
        const r = await pool.query<{ key: string; value: unknown; }>(
            `SELECT key, value FROM site_settings WHERE key LIKE '%_enabled'`,
        );
        const enabled = new Set<string>();
        for (const row of r.rows) {
            const key = String(row.key,).replace(/_enabled$/, '',);
            const v = row.value;
            const isTrue = v === true
                || v === 'true'
                || (typeof v === 'object' && v !== null && (v as { value?: unknown; }).value === true);
            if (isTrue) enabled.add(key,);
        }
        return enabled;
    } catch {
        return new Set();
    }
}

async function getAppliedMigrations(pool: Pool,): Promise<Set<string>> {
    const result = await pool.query<{ filename: string; }>(
        'SELECT filename FROM schema_migrations ORDER BY filename',
    );
    return new Set(result.rows.map((row,) => row.filename,),);
}

function getMigrationFiles(): string[] {
    if (!fs.existsSync(MIGRATIONS_DIR,)) return [];
    return fs.readdirSync(MIGRATIONS_DIR,).filter((f,) => f.endsWith('.sql',)).sort();
}

async function applyMigration(pool: Pool, filename: string, sql: string,): Promise<void> {
    const feature = parseFeatureHeader(sql,);
    const client = await pool.connect();
    try {
        await client.query('BEGIN',);
        await client.query(sql,);
        await client.query(
            'INSERT INTO schema_migrations (filename, feature) VALUES ($1, $2)',
            [filename, feature,],
        );
        await client.query('COMMIT',);
        logger.info(`Applied migration: ${filename}${feature ? ` (feature=${feature})` : ''}`,);
    } catch (error) {
        await client.query('ROLLBACK',);
        logger.error(`Migration failed: ${filename}`, { error, },);
        throw error;
    } finally {
        client.release();
    }
}

export interface MigrationStatus {
    filename: string;
    applied: boolean;
    appliedAt?: Date;
}

export async function getMigrationStatus(pool: Pool = getPool(),): Promise<MigrationStatus[]> {
    await ensureMigrationsTable(pool,);
    const applied = await getAppliedMigrations(pool,);
    const detailRows = await pool.query<{ filename: string; applied_at: Date; }>(
        'SELECT filename, applied_at FROM schema_migrations',
    );
    const detailByName = new Map(detailRows.rows.map((r,) => [r.filename, r.applied_at,]),);
    const all = [BASE_MIGRATION_NAME, ...getMigrationFiles(),];
    return all.map((filename,) => ({
        filename,
        applied: applied.has(filename,),
        appliedAt: detailByName.get(filename,),
    }),);
}

export interface RunMigrationsResult {
    appliedCount: number;
    appliedFilenames: string[];
}

/**
 * Apply all pending migrations against `pool`. Idempotent: re-running on
 * a fully migrated DB is a no-op (returns appliedCount: 0). Does NOT
 * close the pool — the caller is responsible for the pool's lifecycle.
 */
export async function runMigrations(pool: Pool = getPool(),): Promise<RunMigrationsResult> {
    logger.info('Running migrations...',);
    await ensureMigrationsTable(pool,);
    const applied = await getAppliedMigrations(pool,);
    const appliedFilenames: string[] = [];

    if (!applied.has(BASE_MIGRATION_NAME,)) {
        const tablesExist = await pool.query<{ exists: boolean; }>(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'users'
            ) AS exists`,
        );
        if (tablesExist.rows[0].exists) {
            logger.info('Base schema already present; marking as applied.',);
            await pool.query(
                'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
                [BASE_MIGRATION_NAME,],
            );
        } else {
            logger.info('Applying base schema...',);
            const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8',);
            await applyMigration(pool, BASE_MIGRATION_NAME, schemaSql,);
        }
        appliedFilenames.push(BASE_MIGRATION_NAME,);
    }

    const enabledFeatures = await getEnabledFeatures(pool,);
    for (const filename of getMigrationFiles()) {
        if (applied.has(filename,)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename,), 'utf-8',);
        const feature = parseFeatureHeader(sql,);
        // Feature-tagged migrations are deferred until the feature is
        // enabled — `applyFeatureMigrations` in `features/migrations.ts`
        // runs them inside an advisory-locked transaction at that time.
        if (feature && !enabledFeatures.has(feature,)) {
            logger.info(`Skipping migration ${filename}: feature '${feature}' is disabled`,);
            continue;
        }
        await applyMigration(pool, filename, sql,);
        appliedFilenames.push(filename,);
    }

    if (appliedFilenames.length === 0) {
        logger.info('Database is up to date.',);
    } else {
        logger.info(`Applied ${appliedFilenames.length} migration(s).`,);
    }
    return { appliedCount: appliedFilenames.length, appliedFilenames, };
}
