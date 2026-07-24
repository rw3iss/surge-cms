/**
 * Background Printify refresh. Runs every 15 minutes and syncs only when the
 * plugin is active AND the configured interval has elapsed since the last sync
 * (so `syncIntervalMinutes` is honored with 15-min granularity; 0 = manual
 * only). The ingested shop rows ARE the cache — a sync just refreshes them.
 */
import { logger, } from '../../utils/logger';
import { cronRegistry, } from '../cron';
import { getPrintifyConfig, } from './config';
import { getStatus, syncProducts, } from './sync';

const JOB_NAME = 'printify:sync';
const SCHEDULE = '*/15 * * * *';

async function tick(): Promise<void> {
    const cfg = await getPrintifyConfig();
    if (!cfg || cfg.syncIntervalMinutes <= 0) return;
    const st = await getStatus();
    if (st.lastSyncedAt) {
        const elapsedMin = (Date.now() - new Date(st.lastSyncedAt,).getTime()) / 60000;
        if (elapsedMin < cfg.syncIntervalMinutes) return;
    }
    logger.info('printify:sync — background catalog refresh',);
    try {
        await syncProducts(cfg,);
    } catch (err) {
        logger.warn(`printify:sync cron failed: ${(err as Error).message}`,);
    }
}

export function initPrintifyCron(): void {
    cronRegistry.register({
        name: JOB_NAME,
        schedule: SCHEDULE,
        description: 'Refresh Printify products into the shop on the configured interval',
        handler: tick,
    },);
}
