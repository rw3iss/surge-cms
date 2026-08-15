/**
 * Feature dependency-cascade orchestration, split out of
 * `services/settings.ts`. Owns the `PUT /settings` feature-toggle path:
 * the dependency planner (`validateEnable`) + the lazy-install migration
 * applier (`installFeatureStep`) wrapped in a single BEGIN/COMMIT so a
 * failed migration rolls the whole toggle back and the feature stays off.
 *
 * `FeatureCascadeError` is defined here and re-exported from
 * `services/settings.ts` for back-compat (middleware/error + the SDK
 * barrel both import it from there).
 */
import { query, } from '../../db';
import { getPool, } from '../../db/client';
import { ValidationError, } from '../../core/errors';
import { logAudit, } from '../audit';
import { cache, } from '../cache';
import { FEATURE_REGISTRY, FeatureKey, featureSettingKey, } from '../../features/registry';
import { validateEnable, } from '../../features/validator';
import { installFeatureStep, } from '../../features/lifecycle';
import { uuidOrNull, } from '../../utils/uuid';
import type { AuditContext, } from '../types';

export interface UpdateSettingsInput {
    siteName?: string;
    siteDescription?: string;
    logo?: string | null;
    favicon?: string | null;
    socialLinks?: Record<string, string>;
    contactEmail?: string;
    analytics?: { googleAnalyticsId?: string; facebookPixelId?: string; };
    theme?: { primaryColor?: string; secondaryColor?: string; accentColor?: string; };
    adminChannel?: { activeTimeoutSeconds?: number; };
    notifications?: import('@sitesurge/types').NotificationSettings;
    features?: Record<string, boolean>;
    enableDependencies?: boolean;
    disableDependents?: boolean;
}

/** Thrown when the feature dependency planner rejects a toggle. Carries
 *  the planner result so the route can return it as the 409 body. */
export class FeatureCascadeError extends Error {
    constructor(public readonly result: unknown,) {
        super('Feature cascade rejected',);
        this.name = 'FeatureCascadeError';
    }
}

/**
 * Apply a settings update. Non-feature fields write straight through;
 * feature toggles (if present) go through the dependency planner +
 * lazy-install migration applier afterward, since they require
 * transactional coordination with `applyFeatureMigrations`.
 *
 * The `pg_advisory_xact_lock`-equivalent BEGIN/COMMIT flow around the
 * migration applier is preserved verbatim from the original route.
 */
export async function updateSettings(data: UpdateSettingsInput, ctx: AuditContext,): Promise<{
    message: string;
    features?: { key: FeatureKey; enabled: boolean; appliedMigrations: string[]; }[];
}> {
    const actor = uuidOrNull(ctx.userId,);

    const installResults: { key: FeatureKey; enabled: boolean; appliedMigrations: string[]; }[] = [];

    const settingsMap: Record<string, unknown> = {
        site_name: data.siteName,
        site_description: data.siteDescription,
        logo: data.logo,
        favicon: data.favicon,
        social_links: data.socialLinks,
        contact_email: data.contactEmail,
        analytics: data.analytics,
        theme: data.theme,
        admin_channel: data.adminChannel,
        notifications: data.notifications,
    };

    for (const [key, value,] of Object.entries(settingsMap,)) {
        if (value !== undefined) {
            await query(
                `INSERT INTO site_settings (key, value, updated_by)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (key) DO UPDATE SET
                   value = EXCLUDED.value,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = NOW()`,
                [key, JSON.stringify(value,), actor,],
            );
        }
    }

    if (data.features) {
        // Read current state of every known feature from site_settings,
        // defaulting to registry-declared defaults where the row is
        // absent.
        const currentRows = await query<{ key: string; value: unknown; }>(
            `SELECT key, value FROM site_settings WHERE key LIKE '%_enabled'`,
        );
        const current: Record<FeatureKey, boolean> = {} as Record<FeatureKey, boolean>;
        for (const k of Object.keys(FEATURE_REGISTRY,) as FeatureKey[]) {
            current[k] = FEATURE_REGISTRY[k].defaultEnabled;
        }
        for (const row of currentRows.rows) {
            const key = String(row.key,).replace(/_enabled$/, '',) as FeatureKey;
            if (FEATURE_REGISTRY[key]) {
                const v = row.value;
                current[key] = v === true
                    || v === 'true'
                    || (typeof v === 'object' && v !== null && (v as { value?: unknown; }).value === true);
            }
        }

        const target: Partial<Record<FeatureKey, boolean>> = {};
        for (const [k, v,] of Object.entries(data.features,)) {
            if (v === undefined) continue;
            if (!FEATURE_REGISTRY[k as FeatureKey]) {
                throw new ValidationError(`Unknown feature: ${k}`,);
            }
            target[k as FeatureKey] = v;
        }

        const result = validateEnable(target, current, {
            enableDependencies: data.enableDependencies,
            disableDependents: data.disableDependents,
        },);

        if (!result.ok) {
            throw new FeatureCascadeError(result,);
        }

        const pool = getPool();
        const client = await pool.connect();
        try {
            await client.query('BEGIN',);
            for (const step of result.plan) {
                let appliedMigrations: string[] = [];
                if (step.enabled) {
                    // Run any outstanding feature migrations *before*
                    // flipping the bit, then fire the onEnable hook. If
                    // any fail, the whole plan rolls back and the toggle
                    // stays off.
                    appliedMigrations = await installFeatureStep(step.key, client,);
                }
                await client.query(
                    `INSERT INTO site_settings (key, value, updated_by)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (key) DO UPDATE SET
                         value = EXCLUDED.value,
                         updated_by = EXCLUDED.updated_by,
                         updated_at = NOW()`,
                    [featureSettingKey(step.key,), JSON.stringify(step.enabled,), actor,],
                );
                installResults.push({ key: step.key, enabled: step.enabled, appliedMigrations, },);
            }
            await client.query('COMMIT',);
        } catch (err) {
            await client.query('ROLLBACK',);
            throw err;
        } finally {
            client.release();
        }

        await logAudit({
            userId: ctx.userId,
            action: 'update',
            entityType: 'settings',
            entityId: 'features',
            newValues: { plan: result.plan, },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        },);
    }

    await cache.invalidateSettingsCache();

    // Keep the CSP's Google-tag allowances in step with the (possibly changed)
    // Analytics ID, so the SSR-injected gtag snippet is never CSP-blocked and a
    // cleared id removes the GA sources. Re-reads the saved value (source of
    // truth) rather than trusting the partial `data`. Non-fatal.
    try {
        const { syncAnalyticsCsp, } = await import('../analyticsCsp.js');
        await syncAnalyticsCsp();
    } catch { /* non-fatal */ }

    // Pick up a changed admin-channel idle timeout immediately.
    try {
        const { invalidateAdminChannelConfig, } = await import('../adminChannel/config.js');
        invalidateAdminChannelConfig();
    } catch { /* non-fatal */ }

    // Drop the cached notification settings so a changed config applies at
    // the next event.
    try {
        const { invalidateNotificationSettings, } = await import('../notifications/index.js');
        invalidateNotificationSettings();
    } catch { /* non-fatal */ }

    // A feature toggle may have enabled/disabled a feature that owns a core
    // entity type (contacts→contact, shop→product). Re-seed core entity types
    // (feature-gated, idempotent) and reload the EntityManager so the new type
    // is queryable immediately — no server restart needed.
    if (data.features) {
        try {
            const { seedCoreEntityTypes, } = await import('../../entities/coreDescriptors.js');
            await seedCoreEntityTypes();
        } catch { /* non-fatal */ }
    }

    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'settings',
        newValues: { ...data, features: undefined, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return { message: 'Settings updated', features: installResults, };
}
