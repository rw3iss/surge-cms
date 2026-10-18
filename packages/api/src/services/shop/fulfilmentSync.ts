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
 */
import { logger, } from '../../utils/logger';
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
