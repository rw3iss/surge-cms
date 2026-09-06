/**
 * Submit a paid order to each supplier that owes part of it.
 *
 * Replaces the single unconditional `submitOrderToPrintify(orderId)` call. The
 * order is split by `shop_order_items.fulfillment_group` and one supplier order
 * is created per group, each recorded in `shop_order_fulfillments`.
 *
 * The important behaviour: **one supplier failing must not roll back the
 * others**. If Printify accepts and Apliiq rejects, the Printify parcel is still
 * on its way and only the Apliiq record carries the error for the retry sweep.
 * Wrapping the whole thing in a transaction would either duplicate an accepted
 * supplier order on retry or strand a real one.
 */
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { getProvider, } from './providers/registry';
import { getActiveProviderConfig, } from './providers/settings';
import type { ProviderLine, } from './providers/types';

export interface SubmitResult {
    submitted: string[];
    failed: Array<{ provider: string; error: string; }>;
    skipped: string[];
}

interface OrderRow {
    id: string;
    order_number: string;
    customer_email: string;
    customer_name: string | null;
    shipping_address: unknown;
    shipping_method: string | null;
}

export async function submitOrderToProviders(orderId: string,): Promise<SubmitResult> {
    const result: SubmitResult = { submitted: [], failed: [], skipped: [], };

    const oRes = await query<OrderRow>(
        `SELECT id, order_number, customer_email, customer_name, shipping_address, shipping_method
         FROM shop_orders WHERE id = $1`,
        [orderId,],
    );
    const order = oRes.rows[0];
    if (!order) return result;

    // Only supplier groups. 'native' and 'event_tickets' are ours to fulfil.
    const gRes = await query<{ fulfillment_group: string; }>(
        `SELECT DISTINCT fulfillment_group
         FROM shop_order_items
         WHERE order_id = $1
           AND fulfillment_group IS NOT NULL
           AND fulfillment_group NOT IN ('native', 'event_tickets')`,
        [orderId,],
    );

    for (const { fulfillment_group: providerKey, } of gRes.rows) {
        try {
            const outcome = await submitGroup(order, providerKey,);
            if (outcome === 'submitted') result.submitted.push(providerKey,);
            else result.skipped.push(providerKey,);
        } catch (err) {
            const message = (err as Error).message;
            result.failed.push({ provider: providerKey, error: message, },);
            await recordFailure(orderId, providerKey, message,);
            // Deliberately swallowed: the next provider still gets its chance.
            logger.error(`[shop] ${providerKey} order submit failed for ${order.order_number}: ${message}`,);
        }
    }

    await refreshOrderFulfillmentStatus(orderId,);
    return result;
}

async function submitGroup(order: OrderRow, providerKey: string,): Promise<'submitted' | 'skipped'> {
    // Claim the row first. The UNIQUE (order_id, provider) constraint plus this
    // early return is what makes a retry safe: an order already sent is never
    // sent twice.
    const existing = await query<{ external_order_id: string | null; }>(
        `SELECT external_order_id FROM shop_order_fulfillments
         WHERE order_id = $1 AND provider = $2`,
        [order.id, providerKey,],
    );
    if (existing.rows[0]?.external_order_id) return 'skipped';

    const provider = getProvider(providerKey,);
    if (!provider) throw new Error(`Provider “${providerKey}” is not registered.`,);
    const config = await getActiveProviderConfig(providerKey,);
    if (!config) throw new Error(`Provider “${providerKey}” is not enabled or configured.`,);

    const lRes = await query<{
        variant_id: string; quantity: number;
        external_product_id: string | null; external_variant_id: string | null;
        weight_grams: number | null;
    }>(
        `SELECT oi.variant_id, oi.quantity, oi.external_product_id, oi.external_variant_id,
                v.weight_grams
         FROM shop_order_items oi
         LEFT JOIN shop_variants v ON v.id = oi.variant_id
         WHERE oi.order_id = $1 AND oi.fulfillment_group = $2`,
        [order.id, providerKey,],
    );
    const lines: ProviderLine[] = lRes.rows.map((r,) => ({
        variantId: r.variant_id,
        externalProductId: r.external_product_id,
        externalVariantId: r.external_variant_id,
        qty: Number(r.quantity,),
        grams: Number(r.weight_grams ?? 0,),
    }),);
    if (!lines.length) return 'skipped';

    await query(
        `INSERT INTO shop_order_fulfillments (order_id, provider, status, attempts)
         VALUES ($1, $2, 'submitting', 1)
         ON CONFLICT (order_id, provider) DO UPDATE
         SET status = 'submitting', attempts = shop_order_fulfillments.attempts + 1,
             updated_at = NOW()`,
        [order.id, providerKey,],
    );

    const { externalOrderId, } = await provider.submitOrder(config, {
        orderNumber: order.order_number,
        email: order.customer_email,
        name: order.customer_name,
        shippingAddress: order.shipping_address,
        shippingMethod: order.shipping_method ?? undefined,
    }, lines,);

    await query(
        `UPDATE shop_order_fulfillments
         SET external_order_id = $3, status = 'submitted', submitted_at = NOW(),
             last_error = NULL, updated_at = NOW()
         WHERE order_id = $1 AND provider = $2`,
        [order.id, providerKey, externalOrderId,],
    );
    logger.info(`[shop] ${providerKey} order ${externalOrderId} created for ${order.order_number}`,);
    return 'submitted';
}

async function recordFailure(orderId: string, providerKey: string, message: string,): Promise<void> {
    await query(
        `INSERT INTO shop_order_fulfillments (order_id, provider, status, last_error, attempts)
         VALUES ($1, $2, 'failed', $3, 1)
         ON CONFLICT (order_id, provider) DO UPDATE
         SET status = 'failed', last_error = EXCLUDED.last_error,
             attempts = shop_order_fulfillments.attempts + 1, updated_at = NOW()`,
        [orderId, providerKey, message.slice(0, 2000,),],
    ).catch(() => {},);
}

/**
 * Roll the per-provider records up to the order's own `fulfillment_status`.
 *
 * `partial` is the interesting state and only exists now that an order can have
 * more than one supplier — one parcel shipped and another still printing.
 */
export async function refreshOrderFulfillmentStatus(orderId: string,): Promise<void> {
    const r = await query<{ total: string; shipped: string; }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE status IN ('shipped', 'fulfilled', 'delivered'))::text AS shipped
         FROM shop_order_fulfillments WHERE order_id = $1`,
        [orderId,],
    );
    const total = Number(r.rows[0]?.total ?? 0,);
    const shipped = Number(r.rows[0]?.shipped ?? 0,);
    if (total === 0) return;

    const status = shipped === 0 ? 'unfulfilled' : shipped < total ? 'partial' : 'fulfilled';
    await query(
        `UPDATE shop_orders SET fulfillment_status = $2, updated_at = NOW() WHERE id = $1`,
        [orderId, status,],
    );
}

/** Re-attempt any supplier order that never got an id. Idempotent by design. */
export async function retryPendingProviderFulfillment(): Promise<{ resubmitted: number; }> {
    const r = await query<{ order_id: string; }>(
        `SELECT DISTINCT f.order_id
         FROM shop_order_fulfillments f
         JOIN shop_orders o ON o.id = f.order_id
         WHERE f.external_order_id IS NULL
           AND f.status IN ('failed', 'submitting', 'pending')
           AND o.status IN ('paid', 'processing')
           AND f.attempts < 10
         LIMIT 50`,
    );
    let resubmitted = 0;
    for (const row of r.rows) {
        const out = await submitOrderToProviders(row.order_id,);
        resubmitted += out.submitted.length;
    }
    return { resubmitted, };
}

/** Record tracking pushed by a provider webhook or found by polling. */
export async function recordProviderTracking(
    providerKey: string,
    externalOrderId: string,
    tracking: { status: string; carrier?: string; tracking?: string[]; trackingUrl?: string; },
): Promise<void> {
    const shipped = ['shipped', 'fulfilled', 'delivered',].includes(tracking.status.toLowerCase(),);
    const r = await query<{ order_id: string; }>(
        `UPDATE shop_order_fulfillments
         SET status = $3, carrier = COALESCE($4, carrier),
             tracking_numbers = COALESCE($5, tracking_numbers),
             tracking_url = COALESCE($6, tracking_url),
             shipped_at = CASE WHEN $7 AND shipped_at IS NULL THEN NOW() ELSE shipped_at END,
             updated_at = NOW()
         WHERE provider = $1 AND external_order_id = $2
         RETURNING order_id`,
        [
            providerKey, externalOrderId, tracking.status,
            tracking.carrier ?? null, tracking.tracking ?? null,
            tracking.trackingUrl ?? null, shipped,
        ],
    );
    const orderId = r.rows[0]?.order_id;
    if (!orderId) {
        logger.warn(`[shop] tracking for unknown ${providerKey} order ${externalOrderId}`,);
        return;
    }

    // Mirror the first shipment onto the order so existing views and emails,
    // which read the order-level columns, keep working unchanged.
    if (shipped) {
        await query(
            `UPDATE shop_orders
             SET tracking_number = COALESCE(tracking_number, $2),
                 tracking_url = COALESCE(tracking_url, $3),
                 carrier = COALESCE(carrier, $4),
                 status = CASE WHEN status IN ('paid', 'processing') THEN 'shipped' ELSE status END,
                 updated_at = NOW()
             WHERE id = $1`,
            [orderId, tracking.tracking?.[0] ?? null, tracking.trackingUrl ?? null, tracking.carrier ?? null,],
        );
    }
    await refreshOrderFulfillmentStatus(orderId,);
}
