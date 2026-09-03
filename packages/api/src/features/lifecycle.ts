import type { PoolClient, } from 'pg';
import { applyFeatureMigrations, } from './migrations';
import { FEATURE_REGISTRY, FeatureKey, } from './registry';
import { FEATURE_PERMISSIONS, } from '../services/permissions/catalog';
import { invalidatePermissionCache, } from '../services/permissions';
import { logger, } from '../utils/logger';

/**
 * Register the feature's permissions inside the same transaction.
 *
 * Boot registration alone is not enough: an unregistered permission key DENIES
 * (fail-closed), so a feature enabled at runtime had every one of its routes
 * refuse until the next restart. Registering here is what makes a newly
 * installed feature usable — and puts its permissions in the admin immediately.
 *
 * Uses the caller's client so it commits or rolls back with the rest of the
 * install; a feature that half-installed must not leave permissions behind.
 */
async function registerFeaturePermissions(key: FeatureKey, client: PoolClient,): Promise<void> {
    const set = FEATURE_PERMISSIONS[key];
    if (!set?.length) return;

    for (const r of set) {
        await client.query(
            `INSERT INTO permissions
                 (key, feature, label, description, action, default_access, default_roles, is_system)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true)
             ON CONFLICT (key) DO UPDATE SET
                 feature = EXCLUDED.feature,
                 label = EXCLUDED.label,
                 description = EXCLUDED.description,
                 action = EXCLUDED.action,
                 is_system = true,
                 updated_at = NOW()`,
            [
                r.key,
                r.feature ?? key,
                r.label,
                r.description ?? null,
                r.action ?? r.key.split(':',)[1] ?? null,
                r.defaultAccess ?? 'roles',
                r.defaultRoles ?? ['admin', 'sysadmin',],
            ],
        );
    }
    logger.info(`Registered ${set.length} permission(s) for feature '${key}'.`,);
}

/** Install a single feature inside the caller's transaction: run its
 *  migrations, register its permissions, then its idempotent onEnable hook.
 *  Returns the migration filenames that ran (for the client install status). */
export async function installFeatureStep(key: FeatureKey, client: PoolClient,): Promise<string[]> {
    const applied = await applyFeatureMigrations(key, client,);
    await registerFeaturePermissions(key, client,);
    await FEATURE_REGISTRY[key].onEnable?.(client, key,);
    // The catalog is cached in-process; without this the next check would use a
    // snapshot taken before these rows existed and still deny.
    invalidatePermissionCache();
    return applied;
}
