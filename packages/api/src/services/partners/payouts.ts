/**
 * PARTNER payouts — one Stripe transfer of a program's PAYABLE balance to the
 * partner's Connect Express account. Each program is a SOURCE with its own
 * earnings table; a payout pays one source (`affiliate_payouts.source`), so an
 * affiliate payout never sweeps up contribution earnings and vice versa.
 *
 * Earnings are CLAIMED first (`payout_id` set inside a transaction) so two
 * runs can never pay the same row; a failed transfer releases them.
 */
import type { AffiliatePayoutResult, } from '@sitesurge/types';
import { query, transaction, } from '../../db';
import { logger, } from '../../utils/logger';
import { uuidOrNull, } from '../../utils/uuid';
import { logAudit, } from '../audit';
import { accountRow, stripeForPartners, } from './stripeConnect';

export type PayoutSource = 'affiliate' | 'contribution';

interface SourceDef {
    table: string;
    /** Rows of this table that are payable now. */
    payable: string;
    /** Status that marks a paid row. */
    paidStatus: string;
    description: string;
    noun: string;
}

export const PAYOUT_SOURCES: Record<PayoutSource, SourceDef> = {
    affiliate: {
        table: 'affiliate_earnings',
        payable: `status = 'earned' AND payout_id IS NULL AND available_at <= NOW()`,
        paidStatus: 'paid',
        description: 'Affiliate commission payout',
        noun: 'commissions',
    },
    contribution: {
        table: 'contribution_earnings',
        payable: `status = 'earned' AND payout_id IS NULL AND available_at <= NOW()`,
        paidStatus: 'paid',
        description: 'Contributor payout',
        noun: 'contribution earnings',
    },
};

const money = (c: number, cur: string,) => `${(c / 100).toFixed(2,)} ${cur.toUpperCase()}`;

/** Pay a partner's payable balance of ONE program. Never throws for a Stripe failure (returns `paid: false`). */
export async function payOutSource(
    userId: string,
    source: PayoutSource,
    trigger: 'manual' | 'auto',
    actorId: string | null,
): Promise<AffiliatePayoutResult> {
    const def = PAYOUT_SOURCES[source];
    const acct = await accountRow(userId,);
    if (!acct?.stripe_account_id || !acct.payouts_enabled) {
        return { paid: false, amountCents: 0, message: 'This partner has not finished connecting their Stripe account.', };
    }
    const stripe = stripeForPartners();

    const claim = await transaction(async (c,) => {
        const p = await c.query<{ id: string; }>(
            `INSERT INTO affiliate_payouts (user_id, amount_cents, trigger, created_by, source) VALUES ($1, 0, $2, $3, $4) RETURNING id`,
            [userId, trigger, uuidOrNull(actorId,), source,],
        );
        const payoutId = p.rows[0].id;
        const e = await c.query<{ amount_cents: number; currency: string; }>(
            `UPDATE ${def.table} SET payout_id = $2, updated_at = NOW() WHERE user_id = $1 AND ${def.payable} RETURNING amount_cents, currency`,
            [userId, payoutId,],
        );
        const total = e.rows.reduce((s, r,) => s + r.amount_cents, 0,);
        const currency = e.rows[0]?.currency || 'usd';
        if (total <= 0) {
            await c.query(`UPDATE ${def.table} SET payout_id = NULL WHERE payout_id = $1`, [payoutId,],);
            await c.query(`DELETE FROM affiliate_payouts WHERE id = $1`, [payoutId,],);
            return null;
        }
        await c.query(`UPDATE affiliate_payouts SET amount_cents = $2, currency = $3 WHERE id = $1`, [payoutId, total, currency,],);
        return { payoutId, total, currency, };
    },);
    if (!claim) return { paid: false, amountCents: 0, message: `Nothing is payable yet (no ${def.noun} past their holding period).`, };

    try {
        const transfer = await stripe.transfers.create({
            amount: claim.total,
            currency: claim.currency,
            destination: acct.stripe_account_id,
            description: def.description,
            metadata: { payoutId: claim.payoutId, userId, purpose: `${source}_payout`, },
        }, { idempotencyKey: `${source}-payout:${claim.payoutId}`, },);
        await transaction(async (c,) => {
            await c.query(`UPDATE affiliate_payouts SET status = 'paid', stripe_transfer_id = $2, updated_at = NOW() WHERE id = $1`, [claim.payoutId, transfer.id,],);
            await c.query(`UPDATE ${def.table} SET status = '${def.paidStatus}', updated_at = NOW() WHERE payout_id = $1`, [claim.payoutId,],);
        },);
        await logAudit({ userId: actorId ?? '', action: 'payout', entityType: source, entityId: userId, newValues: { amountCents: claim.total, trigger, transferId: transfer.id, }, },);
        return { paid: true, amountCents: claim.total, message: `Paid ${money(claim.total, claim.currency,)}.`, };
    } catch (err) {
        const message = (err as Error).message || 'Transfer failed';
        await query(`UPDATE affiliate_payouts SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`, [claim.payoutId, message.slice(0, 500,),],);
        await query(`UPDATE ${def.table} SET payout_id = NULL, updated_at = NOW() WHERE payout_id = $1`, [claim.payoutId,],);
        logger.error('Partner payout transfer failed', { userId, source, payoutId: claim.payoutId, error: message, },);
        return { paid: false, amountCents: 0, message: `The transfer failed: ${message}`, };
    }
}

/** Partners of a source with a payable balance and a ready Stripe account. */
export async function payableUsers(source: PayoutSource,): Promise<string[]> {
    const def = PAYOUT_SOURCES[source];
    const r = await query<{ user_id: string; }>(
        `SELECT e.user_id FROM ${def.table} e JOIN affiliate_accounts a ON a.user_id = e.user_id AND a.payouts_enabled
          WHERE ${def.payable.replace(/(status|payout_id|available_at)/g, 'e.$1',)}
          GROUP BY e.user_id HAVING SUM(e.amount_cents) > 0`,
    );
    return r.rows.map((x,) => x.user_id,);
}
