/**
 * Lazy-install migration applier. Runs a feature's tagged migrations
 * the first time the feature is enabled (and only that feature's
 * migrations — global migrations run at boot).
 *
 * Advisory-locked on the feature key so two concurrent enable attempts
 * can't race. Failures roll back the caller's transaction so the
 * feature stays off if any of its migrations error.
 */
import fs from 'fs';
import path from 'path';
import type { PoolClient, } from 'pg';
import { logger, } from '../utils/logger';
import { parseFeatureHeader, } from '../db/migrator';
import { FEATURE_REGISTRY, FeatureKey, } from './registry';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations',);

/**
 * Apply any unapplied migrations for `key` using the caller-provided
 * transactional client. Must be called inside a `BEGIN` block — the
 * caller commits (and flips the `*_enabled` setting) only after this
 * returns successfully.
 */
export async function applyFeatureMigrations(
    key: FeatureKey,
    client: PoolClient,
): Promise<string[]> {
    const cfg = FEATURE_REGISTRY[key];
    const filenames = cfg.migrations ?? [];
    if (filenames.length === 0) return [];

    // Self-bootstrap the migrations table — installs created before
    // the @feature tagging shipped don't have the column, and
    // `runMigrations` only runs at boot via the CLI / setup wizard,
    // not every server start. CREATE TABLE IF NOT EXISTS + ALTER
    // ADD COLUMN IF NOT EXISTS are both idempotent and safe inside
    // an existing transaction.
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id SERIAL PRIMARY KEY,
            filename VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMPTZ DEFAULT NOW(),
            feature VARCHAR(64) NULL
        );
    `,);
    await client.query(
        `ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS feature VARCHAR(64) NULL`,
    );

    const lockKey = `feature:${key}`;
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey,],);

    const appliedRes = await client.query<{ filename: string; }>(
        `SELECT filename FROM schema_migrations WHERE filename = ANY($1::text[])`,
        [filenames,],
    );
    const appliedSet = new Set(appliedRes.rows.map((r,) => r.filename,),);

    const ran: string[] = [];
    for (const filename of filenames) {
        if (appliedSet.has(filename,)) continue;
        const filePath = path.join(MIGRATIONS_DIR, filename,);
        // Tolerate missing files: feature registries can declare future
        // phase migrations before the SQL ships. The boot-time runner
        // (or the next feature toggle) will pick them up once they
        // appear on disk. Erroring here would block all earlier
        // migrations from committing in the same transaction.
        if (!fs.existsSync(filePath,)) {
            logger.warn(`Feature ${key}: migration ${filename} not on disk yet — skipping`,);
            continue;
        }
        const sql = fs.readFileSync(filePath, 'utf-8',);
        const tag = parseFeatureHeader(sql,);
        if (tag && tag !== key) {
            throw new Error(
                `Migration ${filename} is tagged @feature ${tag} but listed under feature ${key}`,
            );
        }
        await client.query(sql,);
        await client.query(
            `INSERT INTO schema_migrations (filename, feature) VALUES ($1, $2)`,
            [filename, key,],
        );
        logger.info(`Applied feature migration: ${filename} (feature=${key})`,);
        ran.push(filename,);
    }
    return ran;
}
