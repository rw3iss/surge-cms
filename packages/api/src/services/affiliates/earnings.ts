/**
 * Affiliate commissions: recorded when a paid order used an affiliate code,
 * reversed when it is refunded, and summed into a balance.
 *
 *   commission = (commission% − buyer discount%) × merchandise subtotal
 *   (`affiliateShareCents`, `@sitesurge/types`), payable after the refund
 *   window (`available_at`). A refund before payout cuts it (`reversed` when
 *   full); a refund after payout adds a negative `reversal` row that nets
 *   against the next payout. Partial refunds reverse in proportion
 *   (`reversal.ts`).
 */
import type { AffiliateBalance, AffiliateEarning, AffiliatePayout, } from '@sitesurge/types';
import { affiliateShareCents, } from '@sitesurge/types';
import { query, transaction, } from '../../db';
import { logger, } from '../../utils/logger';
import { commissionOriginalCents, planReversal, reversalTargetCents, } from './reversal';
import { getAffiliateSettings, } from './settings';

export async function recordCommission(o: {
    orderId: string; codeId: string; userId: string; merchSubtotalCents: number;
    commissionPercent: number; buyerDiscountPercent: number; currency: string;
},): Promise<void> {
    const share = Math.max(0, o.commissionPercent - o.buyerDiscountPercent,);
    const amount = affiliateShareCents(o.merchSubtotalCents, o.commissionPercent, o.buyerDiscountPercent,);
    if (amount <= 0) return;
    const { refundWindowDays, } = await getAffiliateSettings();
    await query(
        `INSERT INTO affiliate_earnings (user_id, order_id, code_id, kind, merch_subtotal_cents, share_percent, amount_cents, currency, available_at)
         VALUES ($1, $2, $3, 'commission', $4, $5, $6, $7, NOW() + make_interval(days => $8))
         ON CONFLICT (order_id, user_id) WHERE kind = 'commission' DO NOTHING`,
        [o.userId, o.orderId, o.codeId, o.merchSubtotalCents, share, amount, o.currency || 'usd', refundWindowDays,],
    );
    logger.info('Affiliate commission recorded', { orderId: o.orderId, userId: o.userId, amount, },);
}

/** A refund in Stripe terms: cumulative `refundedCents` of `chargedCents`. Omitted = a full refund. */
export interface RefundAmounts {
    refundedCents: number;
    chargedCents: number;
}

/**
 * A refunded order: reverse its commission — all of it on a full refund, in
 * proportion on a partial one (`reversal.ts`: high-water mark, so a retried
 * or repeated webhook never reverses twice). An unpaid commission is cut in
 * place (`reversed` at zero); a paid one gets a negative `reversal` row.
 * Each commission row is locked while it is decided.
 */
export async function reverseCommission(orderId: string, refund?: RefundAmounts,): Promise<void> {
    await transaction(async (client,) => {
        const rows = await client.query<{
            id: string; user_id: string; code_id: string | null; amount_cents: number; merch_subtotal_cents: number; share_percent: string;
            currency: string; status: string; payout_id: string | null;
        }>(
            `SELECT id, user_id, code_id, amount_cents, merch_subtotal_cents, share_percent, currency, status, payout_id
               FROM affiliate_earnings WHERE order_id = $1 AND kind = 'commission' FOR UPDATE`,
            [orderId,],
        );
        for (const e of rows.rows) {
            const rev = (await client.query<{ total: string; n: string; }>(
                `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS n
                   FROM affiliate_earnings WHERE order_id = $1 AND user_id = $2 AND kind = 'reversal' AND status <> 'reversed'`,
                [orderId, e.user_id,],
            )).rows[0];
            const originalCents = commissionOriginalCents({ merchSubtotalCents: e.merch_subtotal_cents, sharePercent: Number(e.share_percent,), amountCents: e.amount_cents, },);
            const plan = planReversal({
                originalCents,
                amountCents: e.amount_cents,
                status: e.status,
                inPayout: !!e.payout_id,
                reversalRowsCents: Number(rev?.total ?? 0,),
                reversalRowCount: Number(rev?.n ?? 0,),
                targetCents: refund ? reversalTargetCents(originalCents, refund.refundedCents, refund.chargedCents,) : originalCents,
            },);
            if (plan.action === 'reduce') {
                await client.query(
                    plan.reversed
                        ? `UPDATE affiliate_earnings SET status = 'reversed', updated_at = NOW() WHERE id = $1`
                        : `UPDATE affiliate_earnings SET amount_cents = $2, updated_at = NOW() WHERE id = $1`,
                    plan.reversed ? [e.id,] : [e.id, plan.amountCents,],
                );
            } else if (plan.action === 'insert') {
                await client.query(
                    `INSERT INTO affiliate_earnings (user_id, order_id, code_id, kind, amount_cents, currency, available_at)
                     VALUES ($1, $2, $3, 'reversal', $4, $5, NOW())`,
                    [e.user_id, orderId, e.code_id, plan.amountCents, e.currency,],
                );
            }
            if (plan.action !== 'none') logger.info('Affiliate commission reversed', { orderId, userId: e.user_id, plan, partial: !!refund, },);
        }
    },);
}

/** Earnings due now (refund window passed, not paid, not in a payout). */
export const PAYABLE_SQL = `status = 'earned' AND payout_id IS NULL AND available_at <= NOW()`;

export async function balanceFor(userId: string,): Promise<AffiliateBalance> {
    const r = await query<{ pending: string; available: string; paid: string; currency: string | null; }>(
        `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status = 'earned' AND payout_id IS NULL AND available_at > NOW()), 0) AS pending,
                COALESCE(SUM(amount_cents) FILTER (WHERE ${PAYABLE_SQL}), 0) AS available,
                COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0) AS paid,
                MAX(currency) AS currency
           FROM affiliate_earnings WHERE user_id = $1`,
        [userId,],
    );
    const x = r.rows[0];
    return { pendingCents: Number(x?.pending ?? 0,), availableCents: Number(x?.available ?? 0,), paidCents: Number(x?.paid ?? 0,), currency: x?.currency || 'usd', };
}

/** `balanceFor` for many affiliates in one query (admin list). */
export async function balancesFor(userIds: string[],): Promise<Map<string, AffiliateBalance>> {
    if (!userIds.length) return new Map();
    const r = await query<{ user_id: string; pending: string; available: string; paid: string; currency: string | null; }>(
        `SELECT user_id,
                COALESCE(SUM(amount_cents) FILTER (WHERE status = 'earned' AND payout_id IS NULL AND available_at > NOW()), 0) AS pending,
                COALESCE(SUM(amount_cents) FILTER (WHERE ${PAYABLE_SQL}), 0) AS available,
                COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0) AS paid,
                MAX(currency) AS currency
           FROM affiliate_earnings WHERE user_id = ANY($1::uuid[]) GROUP BY user_id`,
        [userIds,],
    );
    return new Map(r.rows.map((x,) => [x.user_id, {
        pendingCents: Number(x.pending,), availableCents: Number(x.available,), paidCents: Number(x.paid,), currency: x.currency || 'usd',
    },],),);
}

export async function earningsFor(userId: string, limit = 200,): Promise<AffiliateEarning[]> {
    const r = await query<{
        id: string; order_number: string; code: string | null; kind: 'commission' | 'reversal'; merch_subtotal_cents: number; share_percent: string;
        amount_cents: number; currency: string; status: string; available_at: Date; created_at: Date; payout_id: string | null;
    }>(
        `SELECT e.id, o.order_number, c.code, e.kind, e.merch_subtotal_cents, e.share_percent, e.amount_cents, e.currency, e.status,
                e.available_at, e.created_at, e.payout_id
           FROM affiliate_earnings e
           JOIN shop_orders o ON o.id = e.order_id
           LEFT JOIN shop_discount_codes c ON c.id = e.code_id
          WHERE e.user_id = $1 ORDER BY e.created_at DESC LIMIT $2`,
        [userId, limit,],
    );
    const now = Date.now();
    return r.rows.map((e,) => ({
        id: e.id,
        orderNumber: e.order_number,
        code: e.code,
        kind: e.kind,
        merchSubtotalCents: e.merch_subtotal_cents,
        sharePercent: Number(e.share_percent,),
        amountCents: e.amount_cents,
        currency: e.currency,
        status: e.status === 'paid' ? 'paid' : e.status === 'reversed' ? 'reversed' : new Date(e.available_at,).getTime() > now ? 'pending' : 'available',
        availableAt: new Date(e.available_at,).toISOString(),
        createdAt: new Date(e.created_at,).toISOString(),
    }));
}

export async function payoutsFor(userId: string, limit = 100, source: 'affiliate' | 'contribution' = 'affiliate',): Promise<AffiliatePayout[]> {
    const r = await query<{ id: string; amount_cents: number; currency: string; status: 'pending' | 'paid' | 'failed'; trigger: 'manual' | 'auto'; error: string | null; created_at: Date; }>(
        `SELECT id, amount_cents, currency, status, trigger, error, created_at FROM affiliate_payouts WHERE user_id = $1 AND source = $3 ORDER BY created_at DESC LIMIT $2`,
        [userId, limit, source,],
    );
    return r.rows.map((p,) => ({ id: p.id, amountCents: p.amount_cents, currency: p.currency, status: p.status, trigger: p.trigger, error: p.error, createdAt: new Date(p.created_at,).toISOString(), }));
}
