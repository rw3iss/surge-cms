/**
 * Affiliate payouts: one Stripe transfer of the PAYABLE balance (refund window
 * passed) to the affiliate's Connect account. Manual (admin "Pay out") always;
 * automatic on the configured schedule (cron, `isPayoutDue`).
 *
 * The earnings are CLAIMED first (`payout_id` set inside a transaction) so two
 * runs can never pay the same commission; a failed transfer releases them.
 */
import type { AffiliatePayoutResult, } from '@sitesurge/types';
import { query, transaction, } from '../../db';
import { logger, } from '../../utils/logger';
import { uuidOrNull, } from '../../utils/uuid';
import { logAudit, } from '../audit';
import { isFeatureEnabledServer, } from '../settings';
import { PAYABLE_SQL, } from './earnings';
import { isPayoutDue, } from './schedule';
import { getAffiliateSettings, markAutoPayoutRun, } from './settings';
import { accountRow, stripeForAffiliates, } from './stripeConnect';

const money = (c: number, cur: string,) => `${(c / 100).toFixed(2,)} ${cur.toUpperCase()}`;

export async function payOut(userId: string, trigger: 'manual' | 'auto', actorId: string | null,): Promise<AffiliatePayoutResult> {
    const acct = await accountRow(userId,);
    if (!acct?.stripe_account_id || !acct.payouts_enabled) {
        return { paid: false, amountCents: 0, message: 'This affiliate has not finished connecting their Stripe account.', };
    }
    const stripe = stripeForAffiliates();

    // Claim the payable earnings for a new payout row (or nothing).
    const claim = await transaction(async (c,) => {
        const p = await c.query<{ id: string; }>(
            `INSERT INTO affiliate_payouts (user_id, amount_cents, trigger, created_by) VALUES ($1, 0, $2, $3) RETURNING id`,
            [userId, trigger, uuidOrNull(actorId,),],
        );
        const payoutId = p.rows[0].id;
        const e = await c.query<{ amount_cents: number; currency: string; }>(
            `UPDATE affiliate_earnings SET payout_id = $2, updated_at = NOW() WHERE user_id = $1 AND ${PAYABLE_SQL} RETURNING amount_cents, currency`,
            [userId, payoutId,],
        );
        const total = e.rows.reduce((s, r,) => s + r.amount_cents, 0,);
        const currency = e.rows[0]?.currency || 'usd';
        if (total <= 0) {
            // Nothing (or only reversals) to pay: undo the claim.
            await c.query(`UPDATE affiliate_earnings SET payout_id = NULL WHERE payout_id = $1`, [payoutId,],);
            await c.query(`DELETE FROM affiliate_payouts WHERE id = $1`, [payoutId,],);
            return null;
        }
        await c.query(`UPDATE affiliate_payouts SET amount_cents = $2, currency = $3 WHERE id = $1`, [payoutId, total, currency,],);
        return { payoutId, total, currency, };
    },);
    if (!claim) return { paid: false, amountCents: 0, message: 'Nothing is payable yet (commissions become payable after the refund window).', };

    try {
        const transfer = await stripe.transfers.create({
            amount: claim.total,
            currency: claim.currency,
            destination: acct.stripe_account_id,
            description: 'Affiliate commission payout',
            metadata: { payoutId: claim.payoutId, userId, purpose: 'affiliate_payout', },
        }, { idempotencyKey: `affiliate-payout:${claim.payoutId}`, },);
        await transaction(async (c,) => {
            await c.query(`UPDATE affiliate_payouts SET status = 'paid', stripe_transfer_id = $2, updated_at = NOW() WHERE id = $1`, [claim.payoutId, transfer.id,],);
            await c.query(`UPDATE affiliate_earnings SET status = 'paid', updated_at = NOW() WHERE payout_id = $1`, [claim.payoutId,],);
        },);
        await logAudit({ userId: actorId ?? '', action: 'payout', entityType: 'affiliate', entityId: userId, newValues: { amountCents: claim.total, trigger, transferId: transfer.id, }, },);
        return { paid: true, amountCents: claim.total, message: `Paid ${money(claim.total, claim.currency,)}.`, };
    } catch (err) {
        const message = (err as Error).message || 'Transfer failed';
        await query(`UPDATE affiliate_payouts SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`, [claim.payoutId, message.slice(0, 500,),],);
        await query(`UPDATE affiliate_earnings SET payout_id = NULL, updated_at = NOW() WHERE payout_id = $1`, [claim.payoutId,],);
        logger.error('Affiliate payout transfer failed', { userId, payoutId: claim.payoutId, error: message, },);
        return { paid: false, amountCents: 0, message: `The transfer failed: ${message}`, };
    }
}

/** Daily cron: when the schedule is due, pay every affiliate with a payable balance. */
export async function runScheduledPayouts(now = new Date(),): Promise<void> {
    if (!await isFeatureEnabledServer('affiliates',)) return;
    const settings = await getAffiliateSettings();
    if (!isPayoutDue(settings.payoutSchedule, settings.lastAutoPayoutAt, now,)) return;
    const due = await query<{ user_id: string; }>(
        `SELECT e.user_id FROM affiliate_earnings e JOIN affiliate_accounts a ON a.user_id = e.user_id AND a.payouts_enabled
          WHERE e.status = 'earned' AND e.payout_id IS NULL AND e.available_at <= NOW()
          GROUP BY e.user_id HAVING SUM(e.amount_cents) > 0`,
    );
    for (const r of due.rows) {
        const res = await payOut(r.user_id, 'auto', null,).catch((err: Error,) => ({ paid: false, message: err.message, }),);
        if (!res.paid) logger.warn('Automatic affiliate payout skipped', { userId: r.user_id, reason: res.message, },);
    }
    await markAutoPayoutRun(now,);
}
