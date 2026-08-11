/**
 * Admin Channel config — the idle timeout (ms) after which a connected user is
 * shown as idle. Operator-configurable via Settings (`admin_channel` keyed row,
 * `activeTimeoutSeconds`); defaults to 60s. Cached briefly; the settings-update
 * path calls `invalidateAdminChannelConfig()` so a change takes effect at once.
 */
import { ADMIN_CHANNEL_DEFAULT_TIMEOUT_MS, } from '@sitesurge/types';
import { query, } from '../../db';

let cached: { ms: number; at: number; } | null = null;
const CACHE_TTL_MS = 30_000;

export async function getActiveTimeoutMs(): Promise<number> {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ms;
    let ms = ADMIN_CHANNEL_DEFAULT_TIMEOUT_MS;
    try {
        const r = await query<{ value: unknown; }>(
            `SELECT value FROM site_settings WHERE key = 'admin_channel'`,
        );
        const v = r.rows[0]?.value as { activeTimeoutSeconds?: unknown; } | undefined;
        const secs = v && typeof v === 'object' ? Number(v.activeTimeoutSeconds,) : NaN;
        if (Number.isFinite(secs,) && secs > 0) ms = Math.round(secs * 1000,);
    } catch { /* fall back to the default */ }
    cached = { ms, at: Date.now(), };
    return ms;
}

export function invalidateAdminChannelConfig(): void {
    cached = null;
}
