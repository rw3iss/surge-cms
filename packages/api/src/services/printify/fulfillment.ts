/**
 * Printify order fulfillment. On a paid shop order that contains Printify
 * products, submit it to Printify's Orders API (create + optionally send to
 * production). A background poller syncs Printify's status + tracking back onto
 * the shop order. Shipping-rate calculation for the checkout also lives here.
 */
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { getPrintifyConfig, type PrintifyConfig, } from './config';
import { calcShipping, createOrder, getOrder, type PrintifyLineItem, sendToProduction, } from './client';
import { type AddressLike, toPrintifyAddress, } from '../shop/address';

type ShopAddressLike = AddressLike;

/** Build Printify's address_to from a shop address + order email/name. */
export const buildAddressTo = toPrintifyAddress;

export interface PrintifyShipLine extends PrintifyLineItem {}

/** All shipping methods Printify can return, cheapest → fastest. */
export const PRINTIFY_SHIPPING_METHODS = ['economy', 'standard', 'priority', 'express', 'printify_express',] as const;
export type PrintifyShippingMethod = typeof PRINTIFY_SHIPPING_METHODS[number];

export interface PrintifyShippingQuote {
    /** True when Printify returned a usable quote. */
    ok: boolean;
    /** method id → cost in cents (only methods Printify offered for this cart). */
    methods: Partial<Record<PrintifyShippingMethod, number>>;
    /** Why a quote couldn't be produced (drives fallback + whether to alarm). */
    reason?: 'no-lines' | 'no-config' | 'no-address' | 'api-error';
    error?: string;
}

/**
 * Retrieve the full set of Printify shipping options (all methods + costs, in
 * cents) for a set of line items shipped to an address. Unlike the old
 * `calcPrintifyShipping` (which swallowed every failure as $0), this SURFACES
 * problems: an actual API error is logged with context and returned as
 * `ok:false, reason:'api-error'` so the caller can fall back to a flat rate
 * instead of silently shipping free. `no-address`/`no-config`/`no-lines` are
 * expected (not logged as errors).
 */
export async function getPrintifyShippingOptions(
    lines: PrintifyShipLine[],
    addr: ShopAddressLike | null,
    email = 'checkout@example.com',
): Promise<PrintifyShippingQuote> {
    if (lines.length === 0) return { ok: true, methods: {}, reason: 'no-lines', };
    const cfg = await getPrintifyConfig();
    if (!cfg) return { ok: false, methods: {}, reason: 'no-config', };
    // Need at least a country + postal code to get a meaningful quote.
    if (!addr || !addr.country || !addr.postalCode) return { ok: false, methods: {}, reason: 'no-address', };
    try {
        const rates = await calcShipping(cfg, lines, buildAddressTo(addr, email,),);
        const methods: Partial<Record<PrintifyShippingMethod, number>> = {};
        for (const m of PRINTIFY_SHIPPING_METHODS) {
            const v = (rates as Record<string, unknown>)[m];
            if (typeof v === 'number' && v >= 0) methods[m] = v;
        }
        return { ok: Object.keys(methods,).length > 0, methods, };
    } catch (err) {
        logger.error('Printify shipping calc failed', {
            error: (err as Error).message,
            lineCount: lines.length,
            firstProduct: lines[0]?.product_id,
            firstVariant: lines[0]?.variant_id,
            country: addr.country,
            zip: addr.postalCode,
        },);
        return { ok: false, methods: {}, reason: 'api-error', error: (err as Error).message, };
    }
}

/**
 * Submit a paid shop order to Printify. Idempotent (skips if already submitted).
 * No-op when Printify is off or the order has no Printify line items.
 */
export async function submitOrderToPrintify(orderId: string,): Promise<void> {
    const cfg = await getPrintifyConfig();
    if (!cfg) return;

    const oRes = await query(
        `SELECT id, order_number, customer_email, customer_name, status,
                printify_order_id, shipping_address
             FROM shop_orders WHERE id = $1`,
        [orderId,],
    );
    const order = oRes.rows[0];
    if (!order) return;
    if (order.printify_order_id) return; // already submitted

    const itemsRes = await query(
        `SELECT oi.quantity, v.external_id AS variant_ext, p.external_id AS product_ext
             FROM shop_order_items oi
             JOIN shop_variants v ON v.id = oi.variant_id
             JOIN shop_products p ON p.id = oi.product_id
             WHERE oi.order_id = $1 AND p.external_provider = 'printify'
               AND v.external_id IS NOT NULL AND p.external_id IS NOT NULL`,
        [orderId,],
    );
    const lineItems: PrintifyLineItem[] = itemsRes.rows.map((r,) => ({
        product_id: String(r.product_ext,),
        variant_id: Number(r.variant_ext,),
        quantity: Number(r.quantity,),
    }));
    if (lineItems.length === 0) return; // nothing for Printify to fulfill

    const addr = (order.shipping_address || null) as ShopAddressLike | null;
    const body = {
        external_id: order.order_number,
        label: order.order_number,
        line_items: lineItems,
        shipping_method: 1, // 1 = standard
        is_printify_express: false,
        is_economy_shipping: false,
        send_shipping_notification: false,
        address_to: buildAddressTo(addr, order.customer_email, order.customer_name,),
    };

    let printifyId: string;
    try {
        const created = await createOrder(cfg, body,);
        printifyId = String(created.id,);
    } catch (err) {
        logger.error(`Printify order submit failed for ${order.order_number}: ${(err as Error).message}`,);
        throw err;
    }

    await query(
        `UPDATE shop_orders
             SET printify_order_id = $1, printify_status = 'created',
                 status = CASE WHEN status = 'paid' THEN 'processing' ELSE status END,
                 updated_at = NOW()
             WHERE id = $2`,
        [printifyId, orderId,],
    );
    logger.info(`Printify order created for ${order.order_number} → ${printifyId}`,);

    if (cfg.autoFulfill) {
        try {
            await sendToProduction(cfg, printifyId,);
            await query(`UPDATE shop_orders SET printify_status = 'in-production' WHERE id = $1`, [orderId,],);
            logger.info(`Printify order ${printifyId} sent to production.`,);
        } catch (err) {
            logger.warn(`Printify send-to-production failed for ${printifyId} (order held): ${(err as Error).message}`,);
        }
    }
}

/**
 * Retry the Printify handoff for paid orders that didn't complete it. Two cases:
 *   1. A paid order with Printify items but no `printify_order_id` — the checkout
 *      submission failed (transient API error) and was never retried.
 *   2. An order created in Printify but stuck at `printify_status='created'` — the
 *      send-to-production charge was held (commonly: no valid payment method on the
 *      Printify account at the time), so it never entered production.
 * Idempotent + best-effort; runs on the printify cron so a stranded paid order
 * self-heals once the underlying issue is resolved (e.g. a card added to Printify).
 */
export async function retryPendingPrintifyFulfillment(): Promise<{ resubmitted: number; produced: number; }> {
    const cfg = await getPrintifyConfig();
    if (!cfg) return { resubmitted: 0, produced: 0, };

    let resubmitted = 0;
    let produced = 0;

    // (1) Paid orders with Printify items but no Printify order yet → (re)create.
    const unsent = (await query(
        `SELECT DISTINCT o.id
             FROM shop_orders o
             JOIN shop_order_items oi ON oi.order_id = o.id
             JOIN shop_products p ON p.id = oi.product_id
             WHERE o.printify_order_id IS NULL
               AND o.status IN ('paid', 'processing')
               AND p.external_provider = 'printify'
             LIMIT 50`,
    )).rows;
    for (const row of unsent) {
        try {
            await submitOrderToPrintify(String(row.id,),);
            resubmitted++;
        } catch (err) {
            logger.warn(`Printify resubmit failed for order ${row.id}: ${(err as Error).message}`,);
        }
    }

    // (2) Created-but-not-produced orders → retry send-to-production when autoFulfill
    //     is on (a payment method may have been added since the first attempt).
    if (cfg.autoFulfill) {
        const held = (await query(
            `SELECT id, printify_order_id FROM shop_orders
                 WHERE printify_order_id IS NOT NULL
                   AND printify_status = 'created'
                   AND status NOT IN ('cancelled', 'refunded')
                 LIMIT 50`,
        )).rows;
        for (const row of held) {
            try {
                await sendToProduction(cfg, String(row.printify_order_id,),);
                await query(
                    `UPDATE shop_orders SET printify_status = 'in-production', updated_at = NOW() WHERE id = $1`,
                    [row.id,],
                );
                produced++;
            } catch (err) {
                logger.warn(`Printify retry send-to-production failed for order ${row.id}: ${(err as Error).message}`,);
            }
        }
    }

    if (resubmitted || produced) {
        logger.info(`Printify fulfillment retry: ${resubmitted} resubmitted, ${produced} sent to production.`,);
    }
    return { resubmitted, produced, };
}

/** Map Printify order status → shop status/fulfillment. */
function mapStatus(pfStatus: string,): { status?: string; fulfillment?: string; } {
    switch (pfStatus) {
        case 'fulfilled':
        case 'shipped':
        case 'partially-fulfilled':
            return { status: 'shipped', fulfillment: pfStatus === 'partially-fulfilled' ? 'partial' : 'fulfilled', };
        case 'canceled':
        case 'cancelled':
            return { status: 'cancelled', };
        default:
            return {};
    }
}

/**
 * Poll in-flight Printify orders and sync status + tracking back. Called by the
 * printify cron. Cheap: only orders that have a Printify id and aren't terminal.
 */
export async function pollOrderStatuses(): Promise<{ checked: number; updated: number; }> {
    const cfg = await getPrintifyConfig();
    if (!cfg) return { checked: 0, updated: 0, };
    const rows = (await query(
        `SELECT id, printify_order_id FROM shop_orders
             WHERE printify_order_id IS NOT NULL
               AND status NOT IN ('shipped', 'delivered', 'cancelled', 'refunded')
             LIMIT 100`,
    )).rows;

    let updated = 0;
    for (const row of rows) {
        try {
            const pf = await getOrder(cfg, String(row.printify_order_id,),);
            const pfStatus = String(pf.status || '',);
            const ship = (pf.shipments && pf.shipments[0]) || null;
            const mapped = mapStatus(pfStatus,);
            const sets: string[] = ['printify_status = $2',];
            const params: unknown[] = [row.id, pfStatus,];
            if (mapped.status) { params.push(mapped.status,); sets.push(`status = $${params.length}`,); }
            if (mapped.fulfillment) { params.push(mapped.fulfillment,); sets.push(`fulfillment_status = $${params.length}`,); }
            if (ship?.number) { params.push(String(ship.number,),); sets.push(`tracking_number = $${params.length}`,); }
            if (ship?.url) { params.push(String(ship.url,),); sets.push(`tracking_url = $${params.length}`,); }
            if (ship?.carrier) { params.push(String(ship.carrier,),); sets.push(`carrier = $${params.length}`,); }
            await query(`UPDATE shop_orders SET ${sets.join(', ',)}, updated_at = NOW() WHERE id = $1`, params,);
            if (mapped.status || ship?.number) updated++;
        } catch (err) {
            logger.warn(`Printify status poll failed for order ${row.id}: ${(err as Error).message}`,);
        }
    }
    return { checked: rows.length, updated, };
}
