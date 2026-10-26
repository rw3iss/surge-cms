/**
 * Affiliate commissions: recorded when a paid order used an affiliate code,
 * reversed when it is refunded, and summed into a balance.
 *
 *   commission = (commission% − buyer discount%) × merchandise subtotal
 *   (`affiliateShareCents`, `@sitesurge/types`), payable after the refund
 *   window (`available_at`). A refund before payout marks it `reversed`; a
 *   refund after payout adds a negative `reversal` row that nets against the
 *   next payout.
 */
import type { AffiliateBalance, AffiliateEarning, AffiliatePayout, } from '@sitesurge/types';
import { affiliateShareCents, } from '@sitesurge/types';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
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
         ON CONFLICT (order_id, user_id, kind) DO NOTHING`,
        [o.userId, o.orderId, o.codeId, o.merchSubtotalCents, share, amount, o.currency || 'usd', refundWindowDays,],
    );
    logger.info('Affiliate commission recorded', { orderId: o.orderId, userId: o.userId, amount, },);
}

/** A refunded order: void an unpaid commission, or add a reversal for a paid one. */
export async function reverseCommission(orderId: string,): Promise<void> {
    const rows = await query<{ id: string; user_id: string; code_id: string | null; amount_cents: number; currency: string; status: string; }>(
        `SELECT id, user_id, code_id, amount_cents, currency, status FROM affiliate_earnings WHERE order_id = $1 AND kind = 'commission'`, [orderId,],
    );
    for (const e of rows.rows) {
        if (e.status === 'earned') {
            // Not paid yet (a payout in flight holds payout_id — leave those to net below).
            const v = await query(`UPDATE affiliate_earnings SET status = 'reversed', updated_at = NOW() WHERE id = $1 AND status = 'earned' AND payout_id IS NULL`, [e.id,],);
            if (v.rowCount) continue;
        }
        if (e.status === 'reversed') continue;
        await query(
            `INSERT INTO affiliate_earnings (user_id, order_id, code_id, kind, amount_cents, currency, available_at)
             VALUES ($1, $2, $3, 'reversal', $4, $5, NOW()) ON CONFLICT (order_id, user_id, kind) DO NOTHING`,
            [e.user_id, orderId, e.code_id, -e.amount_cents, e.currency,],
        );
    }
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

export async function payoutsFor(userId: string, limit = 100,): Promise<AffiliatePayout[]> {
    const r = await query<{ id: string; amount_cents: number; currency: string; status: 'pending' | 'paid' | 'failed'; trigger: 'manual' | 'auto'; error: string | null; created_at: Date; }>(
        `SELECT id, amount_cents, currency, status, trigger, error, created_at FROM affiliate_payouts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, limit,],
    );
    return r.rows.map((p,) => ({ id: p.id, amountCents: p.amount_cents, currency: p.currency, status: p.status, trigger: p.trigger, error: p.error, createdAt: new Date(p.created_at,).toISOString(), }));
}
