import type { PoolClient, } from 'pg';
import { getPool, } from '../db/client';
import { logAudit, } from './audit';
import { cache, } from './cache';
import {
    FEATURE_REGISTRY,
    FeatureKey,
    featureSettingKey,
    getDependents,
    getUninstallableTables,
    isUninstallable,
} from '../features/registry';
import { AppError, } from '../core/errors';
import type { AuditContext, } from './types';

/**
 * Raised when a feature cannot be uninstalled (unknown, part of the base
 * install, or still required by an enabled feature). Extends AppError with
 * a 409 CONFLICT so the route/error-middleware maps it automatically.
 */
export class UninstallError extends AppError {
    constructor(message: string,) {
        super(409, 'CONFLICT', message,);
        this.name = 'UninstallError';
    }
}

/** Enabled features that still require `key` — must be removed/disabled first. */
export function enabledDependents(
    key: FeatureKey, enabled: Record<FeatureKey, boolean>,
): FeatureKey[] {
    return getDependents(key,).filter((d,) => enabled[d],);
}

/**
 * Permanently remove a feature's tables + data. Transactional +
 * advisory-locked (mirrors the enable flow); idempotent (DROP IF EXISTS /
 * DELETE WHERE). The feature is disabled as part of the removal. Re-enabling
 * later re-runs the migrations (their schema_migrations rows were deleted).
 */
export async function uninstallFeature(key: FeatureKey, ctx: AuditContext,): Promise<{ droppedTables: string[]; }> {
    if (!FEATURE_REGISTRY[key]) throw new UninstallError(`Unknown feature: ${key}`,);
    if (!isUninstallable(key,)) {
        throw new UninstallError(`Feature '${key}' has no removable data (part of the base install).`,);
    }

    const pool = getPool();
    const client: PoolClient = await pool.connect();
    try {
        await client.query('BEGIN',);
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`feature:${key}`,],);

        // Dependent-safety: read current enabled state; block if any
        // ENABLED feature still requires this one.
        const rows = await client.query<{ key: string; value: unknown; }>(
            `SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`,
            [(Object.keys(FEATURE_REGISTRY,) as FeatureKey[]).map(featureSettingKey,),],
        );
        const enabled = {} as Record<FeatureKey, boolean>;
        for (const k of Object.keys(FEATURE_REGISTRY,) as FeatureKey[]) {
            enabled[k] = FEATURE_REGISTRY[k].defaultEnabled;
        }
        for (const r of rows.rows) {
            const k = r.key.replace(/_enabled$/, '',) as FeatureKey;
            if (FEATURE_REGISTRY[k]) enabled[k] = r.value === true || r.value === 'true';
        }
        const deps = enabledDependents(key, enabled,);
        if (deps.length > 0) {
            throw new UninstallError(
                `Cannot remove '${key}': still required by enabled features: ${deps.join(', ',)}. Disable/remove them first.`,
            );
        }

        // Hook (deregister crons, external cleanup) before dropping.
        await FEATURE_REGISTRY[key].onUninstall?.(client, key,);

        const droppedTables = getUninstallableTables(key,); // reverse order
        for (const table of droppedTables) {
            // Identifier can't be parameterized; table names come from the
            // static registry (not user input) → safe to interpolate.
            await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`,);
        }

        await client.query(`DELETE FROM schema_migrations WHERE feature = $1`, [key,],);

        // Delete the *_enabled row + any declared feature-owned settings keys.
        const settingsKeys = [featureSettingKey(key,), ...(FEATURE_REGISTRY[key].settingsKeys ?? []),];
        const exact = settingsKeys.filter((k,) => !k.endsWith('*',),);
        const globs = settingsKeys.filter((k,) => k.endsWith('*',),).map((k,) => k.slice(0, -1,) + '%',);
        if (exact.length) await client.query(`DELETE FROM site_settings WHERE key = ANY($1::text[])`, [exact,],);
        for (const g of globs) await client.query(`DELETE FROM site_settings WHERE key LIKE $1`, [g,],);

        await client.query('COMMIT',);

        await logAudit({
            userId: ctx.userId, action: 'uninstall', entityType: 'feature', entityId: key,
            oldValues: { tables: droppedTables, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        },);
        await cache.invalidateSettingsCache();
        return { droppedTables, };
    } catch (err) {
        await client.query('ROLLBACK',);
        throw err;
    } finally {
        client.release();
    }
}
