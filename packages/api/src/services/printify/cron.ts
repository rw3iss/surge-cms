/**
 * Background Printify work, every 15 minutes (primary process only, like every
 * cron): reconcile the last 60 days of orders with Printify, retry stranded
 * submissions, and refresh the catalogue — the latter only when the
 * plugin is active AND the configured interval has elapsed since the last sync
 * (so `syncIntervalMinutes` is honored with 15-min granularity; 0 = manual
 * only). The ingested shop rows ARE the cache — a sync just refreshes them.
 */
import { logger, } from '../../utils/logger';
import { cronRegistry, } from '../cron';
import { getPrintifyConfig, getPrintifyOrderConfig, } from './config';
import { retryHeldPrintifyProduction, } from './fulfillment';
import { reconcilePrintifyOrders, } from './orderSync';
import { getStatus, syncProducts, } from './sync';
import { withPrintifySyncLock, } from './syncLock';

/** The cron reconciles orders from this far back. */
const CRON_RECONCILE_DAYS = 60;

const JOB_NAME = 'printify:sync';
const SCHEDULE = '*/15 * * * *';

async function tick(): Promise<void> {
    // 1) Orders: status + tracking back from Printify, link anything unlinked.
    //    Runs before the retry so an order Printify already has is linked
    //    rather than re-submitted.
    const orderCfg = await getPrintifyOrderConfig();
    if (orderCfg) {
        try {
            await reconcilePrintifyOrders(orderCfg, { sinceDays: CRON_RECONCILE_DAYS, trigger: 'cron', },);
        } catch (err) {
            logger.warn(`printify order reconcile failed: ${(err as Error).message}`,);
        }

        // 1b) Self-heal: supplier orders that never got created (submit failed),
        //     then created ones held before production (e.g. no Printify card).
        try {
            const { retryPendingProviderFulfillment, } = await import('../shop/providerFulfillment.js');
            await retryPendingProviderFulfillment();
            await retryHeldPrintifyProduction(orderCfg,);
        } catch (err) {
            logger.warn(`printify fulfillment retry failed: ${(err as Error).message}`,);
        }
    }

    // 1c) Any OTHER pull-tracking supplier (provider contract `reconcileOrders`).
    try {
        const { runProviderReconciles, } = await import('../shop/fulfilmentSync.js');
        await runProviderReconciles({ sinceDays: CRON_RECONCILE_DAYS, trigger: 'cron', exclude: ['printify',], },);
    } catch (err) {
        logger.warn(`provider order reconcile failed: ${(err as Error).message}`,);
    }

    const cfg = await getPrintifyConfig();
    if (!cfg) return;

    // 2) Refresh the catalog when the configured interval has elapsed.
    if (cfg.syncIntervalMinutes <= 0) return;
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

/** A tick while a manual sync (or another process's tick) runs is skipped. */
async function lockedTick(): Promise<void> {
    const r = await withPrintifySyncLock(tick,);
    if (!r.ran) logger.info('printify:sync — skipped, another sync is running',);
}

export function initPrintifyCron(): void {
    cronRegistry.register({
        name: JOB_NAME,
        schedule: SCHEDULE,
        description: 'Reconcile Printify orders (status + tracking) and refresh Printify products on the configured interval',
        handler: lockedTick,
    },);
}
