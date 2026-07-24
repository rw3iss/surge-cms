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

interface ShopAddressLike {
    name?: string | null;
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
    phone?: string | null;
}

/** Build Printify's address_to from a shop address + order email/name. */
export function buildAddressTo(addr: ShopAddressLike | null, email: string, fallbackName?: string | null,): Record<string, unknown> {
    const full = (addr?.name || fallbackName || '').trim();
    const sp = full.indexOf(' ',);
    const first = sp > 0 ? full.slice(0, sp,) : (full || 'Customer');
    const last = sp > 0 ? full.slice(sp + 1,) : '';
    return {
        first_name: first,
        last_name: last || '.',
        email,
        phone: addr?.phone || '',
        country: (addr?.country || 'US').toUpperCase(),
        region: addr?.state || '',
        address1: addr?.line1 || '',
        address2: addr?.line2 || '',
        city: addr?.city || '',
        zip: addr?.postalCode || '',
    };
}

export interface PrintifyShipLine extends PrintifyLineItem {}

/** Standard shipping cost (cents) for Printify line items to an address, or 0
 *  when Printify is off / no address / calc fails (never blocks checkout). */
export async function calcPrintifyShipping(
    lines: PrintifyShipLine[],
    addr: ShopAddressLike | null,
    email = 'checkout@example.com',
): Promise<number> {
    if (lines.length === 0) return 0;
    const cfg = await getPrintifyConfig();
    if (!cfg) return 0;
    // Need at least a country + postal code to get a meaningful quote.
    if (!addr || !addr.country || !addr.postalCode) return 0;
    try {
        const rates = await calcShipping(cfg, lines, buildAddressTo(addr, email,),);
        return rates.standard ?? 0;
    } catch (err) {
        logger.warn(`Printify shipping calc failed: ${(err as Error).message}`,);
        return 0;
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
