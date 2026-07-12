/**
 * Shop checkout service — the on-site Stripe flow that mirrors donations:
 * validate the cart server-side, compute totals from DB prices (never trust
 * the client), run Stripe Tax when configured, create a pending order +
 * item snapshots in one txn, then create a PaymentIntent tagged
 * `metadata.orderType='shop'`. The webhook (services/payments.ts →
 * fulfillment.ts) finalizes the order on `payment_intent.succeeded`.
 *
 * Guest checkout is allowed: `ctx.userId` may be null → `uuidOrNull` on the
 * order's user_id FK. Orders are never cached.
 */
import type { ShopAddress, ShopSettings, } from '@sitesurge/types';
import Stripe from 'stripe';
import { config, } from '../../config';
import { query, transaction, } from '../../db';
import { ConflictError, ValidationError, } from '../../core/errors';
import { logAudit, } from '../audit';
import { logger, } from '../../utils/logger';
import { getPaymentProvider, } from '../payment';
import * as ordersRepo from '../../repositories/shop/shopOrders.repo';
import { generateOrderNumber, } from './orderNumber';
import { getShopSettings, } from './settings';
import type { AuditContext, } from '../types';

const paymentProvider = getPaymentProvider();

export interface CheckoutLineInput {
    variantId: string;
    qty: number;
}

export interface CheckoutPreviewInput {
    items: CheckoutLineInput[];
    shippingAddress?: ShopAddress | null;
}

export interface CheckoutInput extends CheckoutPreviewInput {
    customerEmail: string;
    customerName?: string | null;
    billingAddress?: ShopAddress | null;
}

export interface CheckoutTotals {
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
    currency: string;
}

export interface CheckoutResult {
    clientSecret: string | null;
    orderId: string;
    orderNumber: string;
    totalCents: number;
}

// A resolved cart line: the client's qty joined to the DB variant/product.
interface ResolvedLine {
    variantId: string;
    productId: string;
    qty: number;
    unitPriceCents: number;
    subtotalCents: number;
    title: string;
    variantTitle: string | null;
    sku: string | null;
    isDigital: boolean;
    requiresShipping: boolean;
}

// Shop settings (shipping + tax + currency) come from the shop settings
// service (services/shop/settings.ts) which reads the `shop_settings`
// site_settings row merged with the registry-seeded defaults.

// ─── Validation + total computation ───────────────────────────────

/** Load + validate each cart line against the DB. Rejects inactive
 *  products, missing variants, bad qty, and insufficient inventory (409). */
async function resolveLines(items: CheckoutLineInput[],): Promise<ResolvedLine[]> {
    if (!items || items.length === 0) {
        throw new ValidationError('Cart is empty',);
    }

    const resolved: ResolvedLine[] = [];
    const insufficient: { variantId: string; requested: number; available: number; }[] = [];

    for (const line of items) {
        if (!line.variantId || !Number.isInteger(line.qty,) || line.qty < 1) {
            throw new ValidationError('Each cart line needs a variantId and qty >= 1',);
        }
        const result = await query(
            `SELECT v.id AS variant_id, v.product_id, v.price_cents, v.inventory_qty, v.sku,
                    v.requires_shipping, v.option1, v.option2, v.option3,
                    p.title, p.type, p.status
                 FROM shop_variants v
                 JOIN shop_products p ON p.id = v.product_id
                 WHERE v.id = $1`,
            [line.variantId,],
        );
        if (result.rows.length === 0) {
            throw new ValidationError(`Variant ${line.variantId} not found`,);
        }
        const row = result.rows[0];
        if (row.status !== 'active') {
            throw new ValidationError(`Product for variant ${line.variantId} is not available`,);
        }
        if ((row.inventory_qty as number) < line.qty) {
            insufficient.push({
                variantId: line.variantId,
                requested: line.qty,
                available: row.inventory_qty as number,
            },);
            continue;
        }

        const unitPriceCents = row.price_cents as number;
        const variantTitle = [row.option1, row.option2, row.option3,]
            .filter((o,) => o !== null && o !== undefined && o !== '',)
            .join(' / ',) || null;
        resolved.push({
            variantId: line.variantId,
            productId: row.product_id as string,
            qty: line.qty,
            unitPriceCents,
            subtotalCents: unitPriceCents * line.qty,
            title: row.title as string,
            variantTitle,
            sku: (row.sku as string | null) ?? null,
            isDigital: row.type === 'digital',
            requiresShipping: Boolean(row.requires_shipping,),
        },);
    }

    if (insufficient.length > 0) {
        throw new ConflictError('Insufficient inventory for one or more items', {
            items: insufficient,
        },);
    }
    return resolved;
}

/** Flat / free-threshold shipping from shop_settings. Zero when nothing in
 *  the cart requires shipping (all-digital orders). */
function computeShipping(lines: ResolvedLine[], subtotalCents: number, settings: ShopSettings,): number {
    const anyPhysical = lines.some((l,) => l.requiresShipping,);
    if (!anyPhysical) return 0;
    const shipping = settings.shipping ?? {};
    if (shipping.freeThresholdCents !== undefined && subtotalCents >= shipping.freeThresholdCents) {
        return 0;
    }
    return shipping.flatCents ?? 0;
}

/**
 * Stripe Tax calculation. Runs only when the store has tax on AND Stripe
 * Tax is enabled AND a shipping address is present. Any failure (Stripe
 * Tax not activated on the account, network) falls back to 0 with a logged
 * warning rather than blocking checkout.
 */
async function computeTax(
    lines: ResolvedLine[],
    shippingCents: number,
    currency: string,
    settings: ShopSettings,
    shippingAddress?: ShopAddress | null,
): Promise<number> {
    if (!settings.taxEnabled || !settings.stripeTaxEnabled || !shippingAddress) return 0;
    if (!config.stripe.secretKey) return 0;

    try {
        const stripe = new Stripe(config.stripe.secretKey,);
        const calculation = await stripe.tax.calculations.create({
            currency,
            line_items: lines.map((l, i,) => ({
                amount: l.subtotalCents,
                reference: `line-${i}`,
                quantity: l.qty,
            }),),
            customer_details: {
                address: {
                    line1: shippingAddress.line1 ?? undefined,
                    line2: shippingAddress.line2 ?? undefined,
                    city: shippingAddress.city ?? undefined,
                    state: shippingAddress.state ?? undefined,
                    postal_code: shippingAddress.postalCode ?? undefined,
                    country: shippingAddress.country ?? 'US',
                },
                address_source: 'shipping',
            },
            shipping_cost: shippingCents > 0 ? { amount: shippingCents, } : undefined,
        },);
        return calculation.tax_amount_exclusive ?? 0;
    } catch (err) {
        logger.warn('Stripe Tax calculation failed — falling back to 0 tax', { error: err, },);
        return 0;
    }
}

async function computeTotals(input: CheckoutPreviewInput,): Promise<{ lines: ResolvedLine[]; totals: CheckoutTotals; }> {
    const settings = await getShopSettings();
    const currency = settings.currency ?? 'usd';
    const lines = await resolveLines(input.items,);
    const subtotalCents = lines.reduce((sum, l,) => sum + l.subtotalCents, 0,);
    const shippingCents = computeShipping(lines, subtotalCents, settings,);
    const taxCents = await computeTax(lines, shippingCents, currency, settings, input.shippingAddress,);
    const totalCents = subtotalCents + shippingCents + taxCents;
    return {
        lines,
        totals: { subtotalCents, shippingCents, taxCents, totalCents, currency, },
    };
}

// ─── Public API ────────────────────────────────────────────────────

/** Live-total preview for the checkout page. Validates + computes totals
 *  WITHOUT creating an order or a PaymentIntent. */
export async function previewCheckout(input: CheckoutPreviewInput,): Promise<CheckoutTotals> {
    const { totals, } = await computeTotals(input,);
    return totals;
}

/**
 * Place an order: validate the cart, compute totals from DB prices, create
 * a pending order + item snapshots in one txn, then create a PaymentIntent
 * (metadata.orderType='shop'). Returns the client secret for Elements.
 * Guest checkout allowed (ctx.userId may be null → uuidOrNull).
 */
export async function createCheckout(input: CheckoutInput, ctx: AuditContext,): Promise<CheckoutResult> {
    if (!input.customerEmail) {
        throw new ValidationError('customerEmail is required',);
    }

    const { lines, totals, } = await computeTotals(input,);
    const orderNumber = generateOrderNumber();

    // Create the order + item snapshots first (pending), then the
    // PaymentIntent, then persist the intent id — all inside one txn so a
    // Stripe failure rolls the pending order back.
    const order = await transaction(async (client,) => {
        const created = await ordersRepo.createOrder(client, {
            orderNumber,
            userId: ctx.userId,
            customerEmail: input.customerEmail,
            customerName: input.customerName ?? null,
            status: 'pending',
            subtotalCents: totals.subtotalCents,
            taxCents: totals.taxCents,
            shippingCents: totals.shippingCents,
            discountCents: 0,
            totalCents: totals.totalCents,
            currency: totals.currency,
            shippingAddress: input.shippingAddress ?? null,
            billingAddress: input.billingAddress ?? null,
        },);

        await ordersRepo.createOrderItems(
            client,
            created.id,
            lines.map((l,) => ({
                productId: l.productId,
                variantId: l.variantId,
                title: l.title,
                variantTitle: l.variantTitle,
                sku: l.sku,
                unitPriceCents: l.unitPriceCents,
                quantity: l.qty,
                subtotalCents: l.subtotalCents,
                isDigital: l.isDigital,
            }),),
        );

        const paymentIntent = await paymentProvider.createPaymentIntent({
            amountCents: totals.totalCents,
            currency: totals.currency,
            customerEmail: input.customerEmail,
            metadata: {
                orderType: 'shop',
                orderId: created.id,
                orderNumber: created.orderNumber,
            },
        },);

        await client.query(
            `UPDATE shop_orders SET stripe_payment_intent_id = $2 WHERE id = $1`,
            [created.id, paymentIntent.id,],
        );

        return { ...created, clientSecret: paymentIntent.clientSecret, };
    },);

    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'shop-order',
        entityId: order.id,
        newValues: { orderNumber: order.orderNumber, totalCents: totals.totalCents, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return {
        clientSecret: order.clientSecret ?? null,
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalCents: totals.totalCents,
    };
}
