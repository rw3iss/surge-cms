/**
 * Affiliate payouts: one Stripe transfer of the PAYABLE balance (refund window
 * passed) to the affiliate's Connect account. Manual (admin "Pay out") always;
 * automatic on the configured schedule (cron, `isPayoutDue`).
 *
 * The earnings are CLAIMED first (`payout_id` set inside a transaction) so two
 * runs can never pay the same commission; a failed transfer releases them.
 */
import type { AffiliatePayoutResult, } from '@sitesurge/types';
import { logger, } from '../../utils/logger';
import { isFeatureEnabledServer, } from '../settings';
import { isPayoutDue, } from './schedule';
import { getAffiliateSettings, markAutoPayoutRun, } from './settings';
import { payableUsers, payOutSource, } from '../partners/payouts';

/** Pay an affiliate's payable commissions (the shared partner payout engine). */
export function payOut(userId: string, trigger: 'manual' | 'auto', actorId: string | null,): Promise<AffiliatePayoutResult> {
    return payOutSource(userId, 'affiliate', trigger, actorId,);
}

/** Daily cron: when the schedule is due, pay every affiliate with a payable balance. */
export async function runScheduledPayouts(now = new Date(),): Promise<void> {
    if (!await isFeatureEnabledServer('affiliates',)) return;
    const settings = await getAffiliateSettings();
    if (!isPayoutDue(settings.payoutSchedule, settings.lastAutoPayoutAt, now,)) return;
    for (const userId of await payableUsers('affiliate',)) {
        const res = await payOut(userId, 'auto', null,).catch((err: Error,) => ({ paid: false, message: err.message, }),);
        if (!res.paid) logger.warn('Automatic affiliate payout skipped', { userId, reason: res.message, },);
    }
    await markAutoPayoutRun(now,);
}
