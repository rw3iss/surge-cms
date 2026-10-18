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
import { ValidationError, } from '../../core/errors';
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

/** A `submitting` claim older than this is assumed abandoned and may be retried. */
export const SUBMIT_CLAIM_MINUTES = 10;

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

    // Claim atomically. The earlier SELECT is only a fast path: two callers
    // (a webhook redelivery, the 15-min retry sweep, a manual retry) can both
    // pass it while the first is still waiting on the supplier, and each would
    // create a supplier order. Only one of them gets a row back from this
    // statement; a `submitting` claim older than SUBMIT_CLAIM_MINUTES is
    // treated as abandoned (a crash mid-call) and may be re-taken.
    const claim = await query<{ id: string; }>(
        `INSERT INTO shop_order_fulfillments (order_id, provider, status, attempts)
         VALUES ($1, $2, 'submitting', 1)
         ON CONFLICT (order_id, provider) DO UPDATE
         SET status = 'submitting', attempts = shop_order_fulfillments.attempts + 1,
             updated_at = NOW()
         WHERE shop_order_fulfillments.external_order_id IS NULL
           AND (shop_order_fulfillments.status <> 'submitting'
                OR shop_order_fulfillments.updated_at < NOW() - make_interval(mins => $3::int))
         RETURNING id`,
        [order.id, providerKey, SUBMIT_CLAIM_MINUTES,],
    );
    if (!claim.rows.length) return 'skipped';

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

export interface OrderTrackingState {
    number: string | null;
    url: string | null;
    carrier: string | null;
    /** The admin typed these (`shop_orders.tracking_manual`). */
    manual: boolean;
}

/**
 * The order-level tracking columns after a supplier roll-up. Manual columns
 * (an admin typed them) are never touched; otherwise each column takes the
 * supplier's first-parcel value when it has one, and keeps its own when not.
 */
export function mergeOrderTracking(
    current: OrderTrackingState,
    supplier: RollUp['tracking'],
): { number: string | null; url: string | null; carrier: string | null; } {
    if (current.manual) return { number: current.number, url: current.url, carrier: current.carrier, };
    return {
        number: supplier.number ?? current.number,
        url: supplier.url ?? current.url,
        carrier: supplier.carrier ?? current.carrier,
    };
}

/**
 * Roll the per-provider records up to the order: `fulfillment_status`, a
 * forward-only `status`, and the order-level tracking columns (the FIRST parcel —
 * left alone when an admin typed them, `tracking_manual`), which existing views
 * and emails read.
 *
 * `partial` only exists because an order can have more than one supplier — one
 * parcel shipped and another still printing (or one supplier part-shipped).
 */
export async function refreshOrderFulfillmentStatus(
    orderId: string,
): Promise<{ before: string; after: string; } | null> {
    const o = await query<{
        status: string; has_native: boolean; tracking_number: string | null; tracking_url: string | null;
        carrier: string | null; tracking_manual: boolean | null;
    }>(
        `SELECT o.status, o.tracking_number, o.tracking_url, o.carrier, o.tracking_manual,
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
    const next = mergeOrderTracking(
        {
            number: order.tracking_number, url: order.tracking_url, carrier: order.carrier,
            manual: Boolean(order.tracking_manual,),
        },
        roll.tracking,
    );
    await query(
        `UPDATE shop_orders
         SET fulfillment_status = $2,
             status = COALESCE($3, status),
             tracking_number = $4,
             tracking_url = $5,
             carrier = $6
         WHERE id = $1
           AND (fulfillment_status IS DISTINCT FROM $2 OR $3::text IS NOT NULL
                OR tracking_number IS DISTINCT FROM $4
                OR tracking_url IS DISTINCT FROM $5
                OR carrier IS DISTINCT FROM $6)`,
        [orderId, roll.fulfillmentStatus, roll.orderStatus, next.number, next.url, next.carrier,],
    );
    return { before: order.status, after: roll.orderStatus ?? order.status, };
}

/** Stored shape of a fulfilment row, compared field-by-field to decide whether
 *  a reconcile changed anything. */
export function canonicalState(s: {
    status: string; externalStatus: string | null; shipments: ProviderShipment[] | null;
    inProductionAt: string | null; shippedAt: string | null; deliveredAt: string | null;
},): string {
    // Shipments are flattened to positional tuples: the stored copy comes back
    // from a jsonb column, which REORDERS object keys (by length, then bytes),
    // so stringifying the objects never matched and every shipped row was
    // rewritten on every sweep.
    const shipments = (s.shipments ?? []).map((x,) => [
        x.carrier ?? null, x.number ?? null, x.url ?? null, x.shippedAt ?? null, x.deliveredAt ?? null,
    ]);
    return JSON.stringify([
        s.status, s.externalStatus ?? null, shipments,
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
           AND (f.status IN ('failed', 'pending')
                -- A submit still in flight is left alone; only an abandoned one is retried.
                OR (f.status = 'submitting' AND f.updated_at < NOW() - make_interval(mins => $1::int)))
           AND o.status IN ('paid', 'processing')
           AND f.attempts < 10
         LIMIT 50`,
        [SUBMIT_CLAIM_MINUTES,],
    );
    let resubmitted = 0;
    for (const row of r.rows) {
        const out = await submitOrderToProviders(row.order_id,);
        resubmitted += out.submitted.length;
    }
    return { resubmitted, };
}


// ─── Admin: per-supplier panel ─────────────────────────────────────

/** One supplier's hand-off for an order, as the admin order page shows it. */
export interface OrderFulfilmentRow {
    provider: string;
    status: string;
    externalStatus: string | null;
    externalOrderId: string | null;
    lastError: string | null;
    attempts: number;
    submittedAt: string | null;
    lastSyncedAt: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    trackingNumbers: string[];
}

/** Every supplier row of an order, plus a placeholder for a supplier group
 *  that has lines but no row yet (never attempted). */
export async function listOrderFulfilments(orderId: string,): Promise<OrderFulfilmentRow[]> {
    const r = await query<{
        provider: string; status: string | null; external_status: string | null; external_order_id: string | null;
        last_error: string | null; attempts: number | null; submitted_at: Date | null; last_synced_at: Date | null;
        shipped_at: Date | null; delivered_at: Date | null; tracking_numbers: string[] | null;
    }>(
        `SELECT g.provider, f.status, f.external_status, f.external_order_id, f.last_error, f.attempts,
                f.submitted_at, f.last_synced_at, f.shipped_at, f.delivered_at, f.tracking_numbers
           FROM (SELECT DISTINCT fulfillment_group AS provider FROM shop_order_items
                  WHERE order_id = $1 AND fulfillment_group IS NOT NULL
                    AND fulfillment_group NOT IN ('native', 'event_tickets')
                 UNION
                 SELECT provider FROM shop_order_fulfillments WHERE order_id = $1) g
           LEFT JOIN shop_order_fulfillments f ON f.order_id = $1 AND f.provider = g.provider
          ORDER BY g.provider`,
        [orderId,],
    );
    return r.rows.map((x,) => ({
        provider: x.provider,
        status: x.status ?? 'not_sent',
        externalStatus: x.external_status,
        externalOrderId: x.external_order_id,
        lastError: x.last_error,
        attempts: Number(x.attempts ?? 0,),
        submittedAt: iso(x.submitted_at,),
        lastSyncedAt: iso(x.last_synced_at,),
        shippedAt: iso(x.shipped_at,),
        deliveredAt: iso(x.delivered_at,),
        trackingNumbers: x.tracking_numbers ?? [],
    }));
}

/** Admin "Retry submission" for one supplier. Already-sent groups are skipped. */
export async function retryOrderFulfilment(orderId: string, providerKey: string,): Promise<SubmitResult> {
    const r = await submitOrderToProviders(orderId,);
    // Report only the asked-for supplier; the others were idempotent no-ops.
    return {
        submitted: r.submitted.filter((p,) => p === providerKey,),
        failed: r.failed.filter((f,) => f.provider === providerKey,),
        skipped: r.skipped.filter((p,) => p === providerKey,),
    };
}

/** Admin "Refresh from supplier": read the supplier order and apply its state. */
export async function refreshOrderFulfilment(orderId: string, providerKey: string,): Promise<ApplyStateResult> {
    const row = await query<{ external_order_id: string | null; }>(
        `SELECT external_order_id FROM shop_order_fulfillments WHERE order_id = $1 AND provider = $2`,
        [orderId, providerKey,],
    );
    const externalId = row.rows[0]?.external_order_id;
    if (!externalId) throw new ValidationError(`This order has no ${providerKey} order to refresh yet — retry the submission first.`,);
    const provider = getProvider(providerKey,);
    if (!provider?.fetchOrderState) throw new ValidationError(`${provider?.label ?? providerKey} does not support reading an order back.`,);
    const config = await getActiveProviderConfig(providerKey,);
    if (!config) throw new ValidationError(`Provider “${providerKey}” is not enabled or configured.`,);
    const state = await provider.fetchOrderState(config, externalId,);
    return applyFulfilmentState(orderId, providerKey, externalId, state,);
}
