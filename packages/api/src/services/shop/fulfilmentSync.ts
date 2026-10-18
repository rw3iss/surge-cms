/**
 * Provider-generic order reconcile: every enabled supplier that implements
 * `reconcileOrders` (pull tracking) gets its recent orders brought in line —
 * the same contract Printify's reconcile fulfils, so a second pull supplier
 * plugs in by implementing the provider method, not by copying the Printify
 * cron. Push suppliers (Apliiq) arrive by webhook instead.
 *
 * Printify itself still runs from its own cron (it shares a lock with the
 * catalogue sync and reads its plugin-era credentials), so it is excluded by
 * default here.
 *
 * Scheduled as its own job, `shop:fulfilment-sync` (every 15 min, primary
 * process only — `initFulfilmentSyncCron`, registered in lib.ts), so a shop
 * without Printify still reconciles its other suppliers.
 */
import { logger, } from '../../utils/logger';
import { cronRegistry, } from '../cron';
import { isFeatureEnabledServer, } from '../settings';
import { listProviders, } from './providers/registry';
import { getActiveProviderConfig, } from './providers/settings';
import type { ShopProviderOrderReconcileResult, } from '@sitesurge/types';

export async function runProviderReconciles(opts: {
    sinceDays: number;
    trigger: 'manual' | 'cron';
    exclude?: string[];
},): Promise<ShopProviderOrderReconcileResult[]> {
    const out: ShopProviderOrderReconcileResult[] = [];
    for (const provider of listProviders()) {
        if (!provider.reconcileOrders || opts.exclude?.includes(provider.key,)) continue;
        try {
            const config = await getActiveProviderConfig(provider.key,);
            if (!config) continue;
            out.push(await provider.reconcileOrders(config, { sinceDays: opts.sinceDays, trigger: opts.trigger, },),);
        } catch (err) {
            // One supplier failing never stops the others.
            logger.warn(`${provider.key} order reconcile failed: ${(err as Error).message}`,);
        }
    }
    return out;
}

/** How far back the scheduled reconcile looks. */
export const CRON_RECONCILE_DAYS = 60;

export const FULFILMENT_SYNC_JOB = 'shop:fulfilment-sync';

/** One scheduled run: no-op while the shop feature is off. Never throws. */
export async function fulfilmentSyncTick(): Promise<void> {
    try {
        if (!(await isFeatureEnabledServer('shop',).catch(() => false))) return;
        await runProviderReconciles({ sinceDays: CRON_RECONCILE_DAYS, trigger: 'cron', exclude: ['printify',], },);
    } catch (err) {
        logger.warn(`provider order reconcile failed: ${(err as Error).message}`,);
    }
}

export function initFulfilmentSyncCron(): void {
    cronRegistry.register({
        name: FULFILMENT_SYNC_JOB,
        schedule: '*/15 * * * *',
        description: 'Reconcile orders (status + tracking) with every pull-tracking supplier except Printify (which has its own job)',
        handler: fulfilmentSyncTick,
    },);
}
