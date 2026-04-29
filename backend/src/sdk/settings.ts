/**
 * cms.settings — typed access to the `site_settings` JSONB key/value
 * store.
 *
 * Most capabilities don't need their own DB table — a JSONB row keyed
 * by a stable string is enough. This service makes that pattern
 * first-class:
 *
 *   const branding = await cms.settings.get<SiteBranding>('site_branding');
 *   await cms.settings.set('site_branding', updated, ctx);
 *
 * Reads are cached via the existing settings cache helpers; writes
 * invalidate that cache and log an audit row.
 */
import { query, } from '../db';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import type { AuditContext, } from './types';

/** Read a single settings row. Returns `null` when the key isn't
 *  present so callers can distinguish missing from "value is null". */
export async function get<T = unknown,>(key: string,): Promise<T | null> {
    const result = await query<{ value: T; }>(
        `SELECT value FROM site_settings WHERE key = $1`,
        [key,],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].value;
}

/** List every settings row. Useful for boot-time hydration of admin
 *  panels that surface multiple keys at once. */
export async function list(): Promise<Array<{ key: string; value: unknown; }>> {
    const result = await query<{ key: string; value: unknown; }>(
        `SELECT key, value FROM site_settings ORDER BY key ASC`,
    );
    return result.rows;
}

/** Upsert a settings row. Audit-logs the write and invalidates the
 *  shared settings cache so the next public read reloads. */
export async function set<T,>(
    key: string,
    value: T,
    ctx: AuditContext,
): Promise<T> {
    await query(
        `INSERT INTO site_settings (key, value, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [key, JSON.stringify(value,), ctx.userId,],
    );

    await cache.invalidateSettingsCache();
    // Per-key cache miss too — settings.repo / route handlers
    // sometimes cache by `settings:<key>`.
    await cache.del(`settings:${key}`,);

    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'settings',
        entityId: key,
        newValues: typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : { value, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return value;
}

/** Drop a settings row. Returns `true` when something was removed,
 *  `false` when the key didn't exist. */
export async function remove(key: string, ctx: AuditContext,): Promise<boolean> {
    const result = await query(
        `DELETE FROM site_settings WHERE key = $1 RETURNING key`,
        [key,],
    );
    if (result.rows.length === 0) return false;

    await cache.invalidateSettingsCache();
    await cache.del(`settings:${key}`,);

    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'settings',
        entityId: key,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return true;
}
