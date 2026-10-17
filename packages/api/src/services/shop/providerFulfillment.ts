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
import type { ProviderFulfilmentState, ProviderLine, ProviderShipment, } from './providers/types';

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

/** Fulfilment-row statuses that mean "this supplier's parcel has left". */
const SHIPPED_ROW = new Set(['shipped', 'fulfilled', 'delivered',],);

/** Order statuses the roll-up may move, in their forward order. A roll-up only
 *  ever moves an order FORWARD; pending / cancelled / refunded are never touched
 *  (a cancelled supplier order on a paid order needs a human and a refund). */
const ORDER_RANK: Record<string, number> = { paid: 0, processing: 1, shipped: 2, delivered: 3, };

export interface RollUpRow {
    status: string;
    shipments?: Array<{ number: string; carrier: string | null; url: string | null; }> | null;
    trackingNumbers?: string[] | null;
    carrier?: string | null;
    trackingUrl?: string | null;
}

export interface RollUp {
    fulfillmentStatus: 'unfulfilled' | 'partial' | 'fulfilled';
    /** The order status to move to, or null to leave it. */
    orderStatus: string | null;
    /** First parcel across the suppliers (rows in creation order). */
    tracking: { number: string | null; carrier: string | null; url: string | null; };
}

/**
 * Pure roll-up of an order's supplier rows.
 *
 * `fulfillment_status`: every supplier shipped → fulfilled, some → partial.
 * Order `status`: all delivered → delivered, all shipped → shipped, any work
 * started → processing. An order that ALSO has lines we ship ourselves
 * (`hasNativeLines`) stops at processing — the suppliers' parcels are not the
 * whole order.
 */
export function computeRollUp(rows: RollUpRow[], currentOrderStatus: string, hasNativeLines: boolean,): RollUp {
    const total = rows.length;
    const shipped = rows.filter((r,) => SHIPPED_ROW.has(r.status,)).length;
    const partial = rows.filter((r,) => r.status === 'partially_shipped').length;
    const delivered = rows.filter((r,) => r.status === 'delivered').length;
    const started = rows.filter((r,) =>
        SHIPPED_ROW.has(r.status,) || r.status === 'partially_shipped' || r.status === 'in_production'
    ).length;

    const fulfillmentStatus = total > 0 && shipped === total
        ? 'fulfilled'
        : shipped > 0 || partial > 0 ? 'partial' : 'unfulfilled';

    let target: string | null = null;
    if (total > 0 && delivered === total) target = 'delivered';
    else if (total > 0 && shipped === total) target = 'shipped';
    else if (started > 0) target = 'processing';
    if (target && hasNativeLines && ORDER_RANK[target]! > ORDER_RANK.processing!) target = 'processing';

    const cur = ORDER_RANK[currentOrderStatus];
    const orderStatus = target && cur !== undefined && ORDER_RANK[target]! > cur ? target : null;

    let tracking: RollUp['tracking'] = { number: null, carrier: null, url: null, };
    for (const r of rows) {
        const first = r.shipments?.[0];
        if (first?.number) {
            tracking = { number: first.number, carrier: first.carrier ?? null, url: first.url ?? null, };
            break;
        }
        if (r.trackingNumbers?.[0]) {
            tracking = { number: r.trackingNumbers[0], carrier: r.carrier ?? null, url: r.trackingUrl ?? null, };
            break;
        }
    }
    return { fulfillmentStatus, orderStatus, tracking, };
}

/**
 * Roll the per-provider records up to the order: `fulfillment_status`, a
 * forward-only `status`, and the order-level tracking columns (the FIRST parcel,
 * filled only when empty — an admin-typed number is never overwritten), which
 * existing views and emails read.
 *
 * `partial` only exists because an order can have more than one supplier — one
 * parcel shipped and another still printing (or one supplier part-shipped).
 */
export async function refreshOrderFulfillmentStatus(
    orderId: string,
): Promise<{ before: string; after: string; } | null> {
    const o = await query<{ status: string; has_native: boolean; }>(
        `SELECT o.status,
                EXISTS (SELECT 1 FROM shop_order_items oi
                         WHERE oi.order_id = o.id AND oi.fulfillment_group = 'native') AS has_native
         FROM shop_orders o WHERE o.id = $1`,
        [orderId,],
    );
    const order = o.rows[0];
    if (!order) return null;

    const r = await query<{
        status: string; shipments: RollUpRow['shipments']; tracking_numbers: string[] | null;
        carrier: string | null; tracking_url: string | null;
    }>(
        `SELECT status, shipments, tracking_numbers, carrier, tracking_url
         FROM shop_order_fulfillments WHERE order_id = $1 ORDER BY created_at, provider`,
        [orderId,],
    );
    if (!r.rows.length) return { before: order.status, after: order.status, };

    const roll = computeRollUp(
        r.rows.map((x,) => ({
            status: x.status, shipments: x.shipments, trackingNumbers: x.tracking_numbers,
            carrier: x.carrier, trackingUrl: x.tracking_url,
        })),
        order.status,
        order.has_native,
    );
    await query(
        `UPDATE shop_orders
         SET fulfillment_status = $2,
             status = COALESCE($3, status),
             tracking_number = COALESCE(tracking_number, $4),
             tracking_url = COALESCE(tracking_url, $5),
             carrier = COALESCE(carrier, $6)
         WHERE id = $1
           AND (fulfillment_status IS DISTINCT FROM $2 OR $3::text IS NOT NULL
                OR (tracking_number IS NULL AND $4::text IS NOT NULL)
                OR (tracking_url IS NULL AND $5::text IS NOT NULL)
                OR (carrier IS NULL AND $6::text IS NOT NULL))`,
        [orderId, roll.fulfillmentStatus, roll.orderStatus, roll.tracking.number, roll.tracking.url, roll.tracking.carrier,],
    );
    return { before: order.status, after: roll.orderStatus ?? order.status, };
}

/** Stored shape of a fulfilment row, compared field-by-field to decide whether
 *  a reconcile changed anything. */
function canonicalState(s: {
    status: string; externalStatus: string | null; shipments: ProviderShipment[] | null;
    inProductionAt: string | null; shippedAt: string | null; deliveredAt: string | null;
},): string {
    return JSON.stringify([
        s.status, s.externalStatus ?? null, s.shipments ?? [],
        s.inProductionAt ?? null, s.shippedAt ?? null, s.deliveredAt ?? null,
    ],);
}

const iso = (v: unknown,): string | null => (v ? new Date(v as string,).toISOString() : null);

export interface ApplyStateResult {
    /** The supplier order id was newly recorded against our order. */
    linked: boolean;
    /** Anything about the row changed. */
    changed: boolean;
    /** The row is already linked to a DIFFERENT supplier order — nothing written. */
    conflict?: string;
    orderStatusBefore: string;
    orderStatusAfter: string;
}

/**
 * Write one supplier order's tracking state onto our fulfilment row (creating /
 * linking it when needed) and roll the order up. Writes nothing when the state
 * is unchanged, so running it every 15 minutes is a no-op until the supplier
 * moves.
 */
export async function applyFulfilmentState(
    orderId: string,
    providerKey: string,
    externalOrderId: string,
    state: ProviderFulfilmentState,
): Promise<ApplyStateResult> {
    const cur = await query<{
        external_order_id: string | null; status: string; external_status: string | null;
        shipments: ProviderShipment[] | null; in_production_at: Date | null;
        shipped_at: Date | null; delivered_at: Date | null;
    }>(
        `SELECT external_order_id, status, external_status, shipments, in_production_at, shipped_at, delivered_at
         FROM shop_order_fulfillments WHERE order_id = $1 AND provider = $2`,
        [orderId, providerKey,],
    );
    const row = cur.rows[0];
    const statusRow = await query<{ status: string; }>(`SELECT status FROM shop_orders WHERE id = $1`, [orderId,],);
    const orderStatus = statusRow.rows[0]?.status ?? '';

    if (row?.external_order_id && row.external_order_id !== externalOrderId) {
        return {
            linked: false, changed: false, orderStatusBefore: orderStatus, orderStatusAfter: orderStatus,
            conflict: row.external_order_id,
        };
    }
    const linked = !row?.external_order_id;
    const next = canonicalState(state,);
    const prev = row
        ? canonicalState({
            status: row.status, externalStatus: row.external_status, shipments: row.shipments,
            inProductionAt: iso(row.in_production_at,), shippedAt: iso(row.shipped_at,), deliveredAt: iso(row.delivered_at,),
        },)
        : '';
    const changed = linked || next !== prev;

    if (changed) {
        const numbers = [...new Set(state.shipments.map((s,) => s.number,),),];
        const first = state.shipments[0];
        await query(
            `INSERT INTO shop_order_fulfillments
                 (order_id, provider, external_order_id, status, external_status, shipments,
                  tracking_numbers, carrier, tracking_url, in_production_at, shipped_at, delivered_at,
                  submitted_at, last_synced_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, NOW(), NOW())
             ON CONFLICT (order_id, provider) DO UPDATE SET
                 external_order_id = EXCLUDED.external_order_id,
                 status = EXCLUDED.status,
                 external_status = EXCLUDED.external_status,
                 shipments = EXCLUDED.shipments,
                 tracking_numbers = EXCLUDED.tracking_numbers,
                 carrier = EXCLUDED.carrier,
                 tracking_url = EXCLUDED.tracking_url,
                 in_production_at = EXCLUDED.in_production_at,
                 shipped_at = EXCLUDED.shipped_at,
                 delivered_at = EXCLUDED.delivered_at,
                 submitted_at = COALESCE(shop_order_fulfillments.submitted_at, EXCLUDED.submitted_at),
                 last_error = NULL,
                 last_synced_at = NOW(),
                 updated_at = NOW()`,
            [
                orderId, providerKey, externalOrderId, state.status, state.externalStatus,
                JSON.stringify(state.shipments,), numbers.length ? numbers : null,
                first?.carrier ?? null, first?.url ?? null,
                state.inProductionAt, state.shippedAt, state.deliveredAt,
            ],
        );
    }
    const roll = await refreshOrderFulfillmentStatus(orderId,);
    return {
        linked, changed,
        orderStatusBefore: roll?.before ?? orderStatus,
        orderStatusAfter: roll?.after ?? orderStatus,
    };
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

    // The roll-up mirrors the first parcel onto the order-level columns (which
    // existing views and emails read) and moves the order status forward.
    await refreshOrderFulfillmentStatus(orderId,);
}
