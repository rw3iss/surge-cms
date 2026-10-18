/**
 * "Needs attention" — paid orders whose supplier hand-off is stuck.
 *
 * ONE definition, used by the alert count (Printify status bar) AND the
 * orders-list filter (`?attention=1`), so the number in the bar is exactly the
 * number of rows the "Review orders" link shows.
 *
 * Provider-generic: `provider` = one supplier key, or null for any supplier.
 * Reasons:
 *   - not_sent  — supplier lines but no supplier order id (never created / submit failed);
 *   - on_hold   — the supplier holds it (payment method, issues);
 *   - stalled   — sent over a day ago and still not in production;
 *   - cancelled — the supplier cancelled it, while our order is still paid
 *                 (`computeRollUp` deliberately leaves our status alone: a
 *                 human decides — usually a refund).
 */
import { query, } from '../../db';

export type AttentionReason = 'not_sent' | 'on_hold' | 'stalled' | 'cancelled';

/** `provider` matcher for a supplier-key column, against placeholder `$n`. */
const providerMatch = (col: string, n: number,): string => `($${n}::text IS NULL OR ${col} = $${n})`;

/** SQL boolean per reason, for an outer `shop_orders o`, the provider in `$n`. */
export function attentionReasonSql(n: number,): Record<AttentionReason, string> {
    const row = (cond: string,) =>
        `EXISTS (SELECT 1 FROM shop_order_fulfillments f
                  WHERE f.order_id = o.id AND ${providerMatch('f.provider', n,)} AND ${cond})`;
    return {
        not_sent: `EXISTS (SELECT 1 FROM shop_order_items oi
                     WHERE oi.order_id = o.id
                       AND oi.fulfillment_group IS NOT NULL
                       AND oi.fulfillment_group NOT IN ('native', 'event_tickets')
                       AND ${providerMatch('oi.fulfillment_group', n,)}
                       AND NOT EXISTS (SELECT 1 FROM shop_order_fulfillments f
                                        WHERE f.order_id = o.id AND f.provider = oi.fulfillment_group
                                          AND f.external_order_id IS NOT NULL))`,
        on_hold: row(`f.external_order_id IS NOT NULL AND f.status = 'on_hold'`,),
        stalled: row(`f.external_order_id IS NOT NULL AND f.status IN ('pending', 'submitted')
                      AND COALESCE(f.submitted_at, f.created_at) < NOW() - INTERVAL '1 day'`,),
        cancelled: row(`f.status = 'cancelled'`,),
    };
}

/** The whole "needs attention" predicate for an outer `shop_orders o`. */
export function attentionWhereSql(n: number,): string {
    const r = attentionReasonSql(n,);
    return `(o.status IN ('paid', 'processing') AND (${r.not_sent} OR ${r.on_hold} OR ${r.stalled} OR ${r.cancelled}))`;
}

export interface AttentionCounts {
    total: number;
    notSent: number;
    onHold: number;
    stalled: number;
    cancelled: number;
}

/** Counts per reason (an order with two problems counts once in `total`). */
export async function attentionCounts(provider: string | null,): Promise<AttentionCounts> {
    const r = attentionReasonSql(1,);
    const res = await query<{ total: number; not_sent: number; on_hold: number; stalled: number; cancelled: number; }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ${r.not_sent})::int AS not_sent,
                COUNT(*) FILTER (WHERE ${r.on_hold})::int AS on_hold,
                COUNT(*) FILTER (WHERE ${r.stalled})::int AS stalled,
                COUNT(*) FILTER (WHERE ${r.cancelled})::int AS cancelled
           FROM shop_orders o
          WHERE ${attentionWhereSql(1,)}`,
        [provider,],
    );
    const x = res.rows[0];
    return {
        total: x?.total ?? 0,
        notSent: x?.not_sent ?? 0,
        onHold: x?.on_hold ?? 0,
        stalled: x?.stalled ?? 0,
        cancelled: x?.cancelled ?? 0,
    };
}
