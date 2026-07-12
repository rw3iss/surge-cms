/**
 * cms.swatches — site color palette.
 *
 * Stored as JSONB on `site_settings.site_colors` (one row, array of
 * `{ id, hex, name? }`). The SDK lifts the previously-inline logic
 * out of `routes/settings.ts` so scripts/plugins can manipulate the
 * palette directly:
 *
 *   const list = await cms.swatches.list();
 *   await cms.swatches.replace([{ id: 'brand-blue', hex: '#3498cf' }], ctx);
 *
 * The `usages` helper scans every JSONB column that might carry a
 * `swatch:{id}` reference and returns counts by source — used by the
 * swatch editor's delete-confirm UI.
 */
import type { SiteSwatch, } from '@sitesurge/types';
import { query, } from '../db';
import { logAudit, } from './audit';
import { cache, } from './cache';
import { uuidOrNull, } from '../utils/uuid';
import type { AuditContext, } from './types';

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
/** Swatch IDs: alphanumeric + dash/underscore, 1–32 chars. Tight
 *  enough to keep CSS custom-property names safe and JSONB-text scans
 *  trustworthy. */
const SWATCH_ID_RE = /^[a-zA-Z0-9_-]{1,32}$/;

const CACHE_KEY = 'settings:site_colors';

const DEFAULT_HEXES = [
    '#ffffff', '#000000', '#3498cf', '#1d3557', '#f1faee',
    '#457b9d', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51',
    '#264653', '#6b705c', '#a8dadc', '#ff006e', '#8338ec',
];

function generateSwatchId(): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 8; i++) id += alphabet[Math.floor(Math.random() * alphabet.length,)];
    return id;
}

function buildDefaults(): SiteSwatch[] {
    return DEFAULT_HEXES.map((hex,) => ({ id: generateSwatchId(), hex, }),);
}

/**
 * Load the swatch list. Auto-migrates legacy `string[]` storage to
 * the object form on first read and persists back so subsequent
 * reads see the new shape directly.
 */
export async function list(): Promise<SiteSwatch[]> {
    const cached = await cache.get<SiteSwatch[]>(CACHE_KEY,);
    if (cached) return cached;

    const result = await query(
        `SELECT value FROM site_settings WHERE key = 'site_colors'`,
    );
    if (result.rows.length === 0) {
        const defaults = buildDefaults();
        await cache.set(CACHE_KEY, defaults, 600,);
        return defaults;
    }

    const raw = result.rows[0].value;
    if (!Array.isArray(raw,)) {
        const defaults = buildDefaults();
        await cache.set(CACHE_KEY, defaults, 600,);
        return defaults;
    }

    let normalised: SiteSwatch[];
    if (raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null) {
        const seen = new Set<string>();
        normalised = (raw as Array<Partial<SiteSwatch>>).flatMap((entry,) => {
            if (!entry || typeof entry.hex !== 'string' || !HEX_RE.test(entry.hex,)) return [];
            let id = typeof entry.id === 'string' && SWATCH_ID_RE.test(entry.id,)
                ? entry.id
                : generateSwatchId();
            while (seen.has(id,)) id = generateSwatchId();
            seen.add(id,);
            const out: SiteSwatch = { id, hex: entry.hex, };
            if (typeof entry.name === 'string' && entry.name.trim()) out.name = entry.name.trim();
            return [out,];
        },);
    } else {
        // Legacy string[] — migrate.
        const migrated: SiteSwatch[] = (raw as unknown[]).flatMap((c,) => {
            if (typeof c !== 'string' || !HEX_RE.test(c,)) return [];
            return [{ id: generateSwatchId(), hex: c, },];
        },);
        if (migrated.length > 0) {
            await query(
                `UPDATE site_settings SET value = $1, updated_at = NOW() WHERE key = 'site_colors'`,
                [JSON.stringify(migrated,),],
            );
        }
        normalised = migrated.length > 0 ? migrated : buildDefaults();
    }

    await cache.set(CACHE_KEY, normalised, 600,);
    return normalised;
}

/**
 * Replace the entire swatch palette. Validates each entry, ensures
 * unique IDs, persists to `site_settings.site_colors`, invalidates
 * the cache, audit-logs the write.
 */
export async function replace(
    list: Array<Partial<SiteSwatch>>,
    ctx: AuditContext,
): Promise<SiteSwatch[]> {
    const seen = new Set<string>();
    const validated: SiteSwatch[] = [];
    for (const entry of list) {
        if (!entry || typeof entry.hex !== 'string' || !HEX_RE.test(entry.hex,)) continue;
        let id = typeof entry.id === 'string' && SWATCH_ID_RE.test(entry.id,)
            ? entry.id
            : generateSwatchId();
        if (seen.has(id,)) {
            // Conflicting client-supplied ID — auto-allocate a fresh one
            // rather than silently merging the rows.
            id = generateSwatchId();
            while (seen.has(id,)) id = generateSwatchId();
        }
        seen.add(id,);
        const swatch: SiteSwatch = { id, hex: entry.hex, };
        if (typeof entry.name === 'string' && entry.name.trim()) {
            swatch.name = entry.name.trim().slice(0, 64,);
        }
        validated.push(swatch,);
    }

    await query(
        `INSERT INTO site_settings (key, value, updated_by)
         VALUES ('site_colors', $1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
        [JSON.stringify(validated,), uuidOrNull(ctx.userId,),],
    );

    await cache.del(CACHE_KEY,);
    await cache.invalidateSettingsCache();

    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'settings',
        entityId: 'site_colors',
        newValues: { count: validated.length, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return validated;
}

export interface SwatchUsageReport {
    total: number;
    breakdown: Array<{ source: string; count: number; }>;
}

/**
 * Count `swatch:{id}` references across the database. Used by the
 * swatch editor's delete-confirm to warn the operator how many
 * places will fall back to defaults.
 *
 * Each source is queried independently — a missing table on older
 * installs is tolerated silently rather than aborting the whole
 * scan.
 */
export async function usages(swatchId: string,): Promise<SwatchUsageReport> {
    if (!SWATCH_ID_RE.test(swatchId,)) {
        return { total: 0, breakdown: [], };
    }
    const needle = `%swatch:${swatchId}%`;
    const sources: Array<{ label: string; sql: string; }> = [
        { label: 'Page blocks', sql: `SELECT COUNT(*)::int AS n FROM blocks WHERE settings::text ILIKE $1 OR style::text ILIKE $1`, },
        { label: 'Post content blocks', sql: `SELECT COUNT(*)::int AS n FROM post_content_blocks WHERE data::text ILIKE $1`, },
        { label: 'Block style templates', sql: `SELECT COUNT(*)::int AS n FROM block_styles WHERE style::text ILIKE $1`, },
        { label: 'Site settings', sql: `SELECT COUNT(*)::int AS n FROM site_settings WHERE key <> 'site_colors' AND value::text ILIKE $1`, },
    ];

    const breakdown: SwatchUsageReport['breakdown'] = [];
    let total = 0;
    for (const s of sources) {
        try {
            const r = await query(s.sql, [needle,],);
            const n = Number((r.rows[0] as any)?.n ?? 0,);
            if (n > 0) {
                breakdown.push({ source: s.label, count: n, },);
                total += n;
            }
        } catch { /* missing table on legacy installs — skip silently */ }
    }
    return { total, breakdown, };
}
