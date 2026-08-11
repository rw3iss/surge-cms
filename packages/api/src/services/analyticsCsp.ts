/**
 * Keeps the CSP's Google-tag allowances in lockstep with the saved Analytics ID.
 *
 * The CSP is a process-global (rebuildable) middleware, so when the operator
 * sets/changes/clears the "Google Analytics ID" setting we must re-read it and
 * push it into the CSP. Called at boot and after every settings update (the
 * settings-cache invalidation path), mirroring how plugin CSP origins are kept
 * fresh.
 */
import { query, } from '../db';
import { setAnalyticsGaId, } from '../middleware/csp';
import { logger, } from '../utils/logger';

/** Read `site_settings.analytics.googleAnalyticsId` and apply it to the CSP. */
export async function syncAnalyticsCsp(): Promise<void> {
    try {
        const res = await query<{ value: unknown; }>(
            `SELECT value FROM site_settings WHERE key = 'analytics' LIMIT 1`,
        );
        const value = res.rows[0]?.value as { googleAnalyticsId?: string; } | null | undefined;
        setAnalyticsGaId(value?.googleAnalyticsId ?? null);
    } catch (error) {
        logger.warn('syncAnalyticsCsp failed', { error: (error as Error).message, },);
        setAnalyticsGaId(null,);
    }
}
