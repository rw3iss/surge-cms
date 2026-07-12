/**
 * Shop orders repository — order + order-item CRUD, the webhook-time
 * fulfillment reads/writes (mark-paid, inventory decrement, download
 * tokens), and the token-gated digital-download lookup.
 *
 * Orders are user-specific / admin — NEVER cached. `user_id` is a nullable
 * UUID FK (guest checkout → NULL via `uuidOrNull`). Reads are role-shaped
 * at the service layer (admin all / user own). Follows the shopProducts.repo
 * style: base.repo helpers + mapRow + uuidOrNull.
 */
import type { ShopAddress, ShopOrder, ShopOrderItem, } from '@sitesurge/types';
import type { PoolClient, } from 'pg';
import { query, } from '../../db';
import { mapRow, mapRows, } from '../../utils/mapRow';
import { uuidOrNull, } from '../../utils/uuid';
import {
    findByIdOrThrow,
    paginatedQuery,
    PaginatedResult,
    PaginationOptions,
} from '../base.repo';

// ─── Create (within the checkout txn) ─────────────────────────────

export interface OrderCreateInput {
    orderNumber: string;
    userId?: string | null;
    customerEmail: string;
    customerName?: string | null;
    status?: string;
    subtotalCents: number;
    taxCents: number;
    shippingCents: number;
    discountCents?: number;
    totalCents: number;
    currency: string;
    stripePaymentIntentId?: string | null;
    shippingAddress?: ShopAddress | null;
    billingAddress?: ShopAddress | null;
}

/** Insert an order (pending by default) inside the caller's txn client.
 *  `user_id` is a UUID FK — guest checkout → NULL. */
export async function createOrder(client: PoolClient, input: OrderCreateInput,): Promise<ShopOrder> {
    const result = await client.query(
        `INSERT INTO shop_orders (order_number, user_id, customer_email, customer_name, status,
                                  subtotal_cents, tax_cents, shipping_cents, discount_cents, total_cents,
                                  currency, stripe_payment_intent_id, shipping_address, billing_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING *`,
        [
            input.orderNumber,
            uuidOrNull(input.userId ?? null,),
            input.customerEmail,
            input.customerName ?? null,
            input.status ?? 'pending',
            input.subtotalCents,
            input.taxCents,
            input.shippingCents,
            input.discountCents ?? 0,
            input.totalCents,
            input.currency,
            input.stripePaymentIntentId ?? null,
            input.shippingAddress ? JSON.stringify(input.shippingAddress,) : null,
            input.billingAddress ? JSON.stringify(input.billingAddress,) : null,
        ],
    );
    return mapRow<ShopOrder>(result.rows[0],);
}

export interface OrderItemInput {
    productId?: string | null;
    variantId?: string | null;
    title: string;
    variantTitle?: string | null;
    sku?: string | null;
    unitPriceCents: number;
    quantity: number;
    subtotalCents: number;
    isDigital: boolean;
    downloadToken?: string | null;
}

/** Bulk-insert the order line-item snapshots inside the checkout txn. */
export async function createOrderItems(
    client: PoolClient,
    orderId: string,
    items: OrderItemInput[],
): Promise<ShopOrderItem[]> {
    const out: ShopOrderItem[] = [];
    for (const item of items) {
        const result = await client.query(
            `INSERT INTO shop_order_items (order_id, product_id, variant_id, title, variant_title,
                                           sku, unit_price_cents, quantity, subtotal_cents, is_digital,
                                           download_token)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING *`,
            [
                orderId,
                uuidOrNull(item.productId ?? null,),
                uuidOrNull(item.variantId ?? null,),
                item.title,
                item.variantTitle ?? null,
                item.sku ?? null,
                item.unitPriceCents,
                item.quantity,
                item.subtotalCents,
                item.isDigital,
                item.downloadToken ?? null,
            ],
        );
        out.push(mapRow<ShopOrderItem>(result.rows[0],),);
    }
    return out;
}

// ─── Reads ─────────────────────────────────────────────────────────

async function loadItems(orderId: string,): Promise<ShopOrderItem[]> {
    const result = await query(
        `SELECT * FROM shop_order_items WHERE order_id = $1 ORDER BY created_at ASC`,
        [orderId,],
    );
    return mapRows<ShopOrderItem>(result.rows,);
}

export interface OrderDetail extends ShopOrder {
    items: ShopOrderItem[];
}

/** Full order detail (order + items). Throws if the order is absent. */
export async function findOrderById(id: string,): Promise<OrderDetail> {
    const order = await findByIdOrThrow<ShopOrder>('shop_orders', id, 'Order',);
    const items = await loadItems(order.id,);
    return { ...order, items, };
}

/** Full order detail by human order number. Null when absent. */
export async function findOrderByNumber(orderNumber: string,): Promise<OrderDetail | null> {
    const result = await query(`SELECT * FROM shop_orders WHERE order_number = $1`, [orderNumber,],);
    if (result.rows.length === 0) return null;
    const order = mapRow<ShopOrder>(result.rows[0],);
    const items = await loadItems(order.id,);
    return { ...order, items, };
}

export interface OrderListFilters {
    userId?: string;
    email?: string;
    status?: string;
}

/** Paginated order list, newest first. Admin passes no user filter (all);
 *  the user tier passes userId + email (own only). */
export async function findOrders(
    filters: OrderListFilters,
    pagination: PaginationOptions,
): Promise<PaginatedResult<ShopOrder>> {
    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    // Own-orders scoping: match either the user_id or the customer_email.
    if (filters.userId || filters.email) {
        const clauses: string[] = [];
        if (filters.userId) {
            params.push(filters.userId,);
            clauses.push(`user_id = $${params.length}`,);
        }
        if (filters.email) {
            params.push(filters.email,);
            clauses.push(`customer_email = $${params.length}`,);
        }
        whereClause += ` AND (${clauses.join(' OR ',)})`;
    }
    if (filters.status) {
        params.push(filters.status,);
        whereClause += ` AND status = $${params.length}`;
    }

    return paginatedQuery<ShopOrder>(
        `SELECT * FROM shop_orders ${whereClause} ORDER BY created_at DESC`,
        `SELECT COUNT(*) FROM shop_orders ${whereClause}`,
        params,
        pagination,
    );
}

// ─── Updates ───────────────────────────────────────────────────────

export interface OrderUpdateInput {
    status?: string;
    fulfillmentStatus?: string;
    trackingNumber?: string | null;
    notes?: string | null;
    stripeChargeId?: string | null;
}

/** Dynamic partial update (admin). Touches updated_at via the trigger. */
export async function updateOrder(id: string, patch: OrderUpdateInput,): Promise<ShopOrder> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (patch.status !== undefined) {
        values.push(patch.status,);
        updates.push(`status = $${values.length}`,);
    }
    if (patch.fulfillmentStatus !== undefined) {
        values.push(patch.fulfillmentStatus,);
        updates.push(`fulfillment_status = $${values.length}`,);
    }
    if (patch.trackingNumber !== undefined) {
        values.push(patch.trackingNumber,);
        updates.push(`tracking_number = $${values.length}`,);
    }
    if (patch.notes !== undefined) {
        values.push(patch.notes,);
        updates.push(`notes = $${values.length}`,);
    }
    if (patch.stripeChargeId !== undefined) {
        values.push(patch.stripeChargeId,);
        updates.push(`stripe_charge_id = $${values.length}`,);
    }

    if (updates.length === 0) {
        return findByIdOrThrow<ShopOrder>('shop_orders', id, 'Order',);
    }

    values.push(id,);
    const result = await query(
        `UPDATE shop_orders SET ${updates.join(', ',)} WHERE id = $${values.length} RETURNING *`,
        values,
    );
    if (result.rows.length === 0) throw new Error(`Order ${id} not found`,);
    return mapRow<ShopOrder>(result.rows[0],);
}

// ─── Webhook fulfillment helpers ──────────────────────────────────

/** Mark an order paid inside the fulfillment txn. Idempotent: only flips
 *  a `pending` order (the WHERE guard) so webhook retries are no-ops. */
export async function markOrderPaid(
    client: PoolClient,
    orderId: string,
    opts: { stripeChargeId?: string | null; },
): Promise<{ updated: boolean; }> {
    const result = await client.query(
        `UPDATE shop_orders SET status = 'paid', stripe_charge_id = $2
             WHERE id = $1 AND status = 'pending'
             RETURNING id`,
        [orderId, opts.stripeChargeId ?? null,],
    );
    return { updated: (result.rowCount ?? 0) > 0, };
}

export interface FulfillmentItem {
    id: string;
    variantId: string | null;
    quantity: number;
    isDigital: boolean;
}

/** Load an order's items with the fields needed for inventory decrement +
 *  digital token generation, inside the fulfillment txn. */
export async function findOrderItemsForFulfillment(
    client: PoolClient,
    orderId: string,
): Promise<FulfillmentItem[]> {
    const result = await client.query(
        `SELECT id, variant_id, quantity, is_digital FROM shop_order_items WHERE order_id = $1`,
        [orderId,],
    );
    return result.rows.map((r,) => ({
        id: r.id as string,
        variantId: (r.variant_id as string | null) ?? null,
        quantity: r.quantity as number,
        isDigital: r.is_digital as boolean,
    }));
}

/**
 * Decrement a variant's inventory inside the fulfillment txn. The guarded
 * `>= qty` UPDATE prevents negative stock; if it doesn't apply (oversold —
 * concurrent purchases beat the checkout guard), the payment has ALREADY
 * been captured, so we clamp the variant to 0 rather than fail the webhook.
 * Returns whether the guarded decrement applied cleanly.
 */
export async function decrementInventory(
    client: PoolClient,
    variantId: string,
    qty: number,
): Promise<{ ok: boolean; }> {
    const result = await client.query(
        `UPDATE shop_variants SET inventory_qty = inventory_qty - $2
             WHERE id = $1 AND inventory_qty >= $2
             RETURNING id`,
        [variantId, qty,],
    );
    if ((result.rowCount ?? 0) > 0) return { ok: true, };
    // Oversell: payment already captured → clamp to 0 and carry on.
    await client.query(
        `UPDATE shop_variants SET inventory_qty = 0 WHERE id = $1`,
        [variantId,],
    );
    return { ok: false, };
}

/** Store a generated download token on a digital order item (fulfillment txn). */
export async function setDownloadToken(
    client: PoolClient,
    orderItemId: string,
    token: string,
): Promise<void> {
    await client.query(
        `UPDATE shop_order_items SET download_token = $2 WHERE id = $1`,
        [orderItemId, token,],
    );
}

export interface DigitalDownloadRow {
    orderItemId: string;
    productId: string | null;
    title: string;
    orderStatus: string;
}

/**
 * Look up a digital order item by its order number + token for the
 * public token-gated download. Returns null when the pair doesn't match a
 * digital item on a paid-ish order (unguessable token is the guard).
 */
export async function findDigitalItemByToken(
    orderNumber: string,
    token: string,
): Promise<DigitalDownloadRow | null> {
    const result = await query(
        `SELECT oi.id AS order_item_id, oi.product_id, oi.title, o.status AS order_status
             FROM shop_order_items oi
             JOIN shop_orders o ON o.id = oi.order_id
             WHERE o.order_number = $1
               AND oi.download_token = $2
               AND oi.is_digital = TRUE
               AND o.status IN ('paid', 'processing', 'shipped', 'delivered')
             LIMIT 1`,
        [orderNumber, token,],
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
        orderItemId: r.order_item_id as string,
        productId: (r.product_id as string | null) ?? null,
        title: r.title as string,
        orderStatus: r.order_status as string,
    };
}

/** Resolve a downloadable file URL for a digital product: its first media
 *  asset (position 0 = main). Null when the product has no media. */
export async function findDigitalFileUrl(productId: string,): Promise<string | null> {
    const result = await query(
        `SELECT m.url FROM shop_product_media pm
             JOIN media m ON m.id = pm.media_id
             WHERE pm.product_id = $1
             ORDER BY pm.position ASC
             LIMIT 1`,
        [productId,],
    );
    if (result.rows.length === 0) return null;
    return (result.rows[0].url as string) ?? null;
}
