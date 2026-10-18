/**
 * Shop dashboard figures in ONE round-trip: revenue and order counts for named
 * periods, plus the operator's to-do counts. Replaces the dashboard summing
 * whichever of the last 10 orders happened to be paid (a number that moved
 * with the order mix and named no period) and loading 100 products to count them.
 */
import type { ShopStats, } from '@sitesurge/types';
import { query, } from '../../db';
import { attentionWhereSql, } from './attention';

/** Statuses that represent money actually taken. */
const PAID = `('paid', 'processing', 'shipped', 'delivered')`;
/** A product at or below this many units (across variants) is "low stock". */
export const LOW_STOCK_THRESHOLD = 5;

export async function getStats(): Promise<ShopStats> {
    const r = await query<{
        revenue_7: string | null; orders_7: number; revenue_30: string | null; orders_30: number;
        to_ship: number; attention: number; low_stock: number; products: number; active_products: number;
        currency: string | null;
    }>(
        `SELECT
            (SELECT COALESCE(SUM(total_cents), 0) FROM shop_orders
              WHERE status IN ${PAID} AND created_at >= NOW() - INTERVAL '7 days') AS revenue_7,
            (SELECT COUNT(*)::int FROM shop_orders
              WHERE status IN ${PAID} AND created_at >= NOW() - INTERVAL '7 days') AS orders_7,
            (SELECT COALESCE(SUM(total_cents), 0) FROM shop_orders
              WHERE status IN ${PAID} AND created_at >= NOW() - INTERVAL '30 days') AS revenue_30,
            (SELECT COUNT(*)::int FROM shop_orders
              WHERE status IN ${PAID} AND created_at >= NOW() - INTERVAL '30 days') AS orders_30,
            (SELECT COUNT(*)::int FROM shop_orders WHERE status IN ('paid', 'processing')) AS to_ship,
            (SELECT COUNT(*)::int FROM shop_orders o WHERE ${attentionWhereSql(1,)}) AS attention,
            (SELECT COUNT(*)::int FROM shop_products p
              WHERE p.status = 'active'
                AND (SELECT COALESCE(SUM(v.inventory_qty), 0) FROM shop_variants v WHERE v.product_id = p.id) <= $2) AS low_stock,
            (SELECT COUNT(*)::int FROM shop_products) AS products,
            (SELECT COUNT(*)::int FROM shop_products WHERE status = 'active') AS active_products,
            (SELECT currency FROM shop_orders ORDER BY created_at DESC LIMIT 1) AS currency`,
        [null, LOW_STOCK_THRESHOLD,],
    );
    const x = r.rows[0];
    return {
        currency: (x?.currency || 'usd').toLowerCase(),
        periods: [
            { days: 7, revenueCents: Number(x?.revenue_7 ?? 0,), orders: x?.orders_7 ?? 0, },
            { days: 30, revenueCents: Number(x?.revenue_30 ?? 0,), orders: x?.orders_30 ?? 0, },
        ],
        toShip: x?.to_ship ?? 0,
        needsAttention: x?.attention ?? 0,
        lowStock: x?.low_stock ?? 0,
        lowStockThreshold: LOW_STOCK_THRESHOLD,
        productCount: x?.products ?? 0,
        activeProductCount: x?.active_products ?? 0,
    };
}
