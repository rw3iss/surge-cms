/**
 * Printify order helpers: shipping-rate calculation for the checkout and the
 * send-to-production retry. Orders are CREATED by the Shop Provider path
 * (`shop/providerFulfillment.submitOrderToProviders`) and their status +
 * tracking come back through `orderSync.reconcilePrintifyOrders`.
 */
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { getPrintifyConfig, type PrintifyConfig, } from './config';
import { calcShipping, type PrintifyLineItem, sendToProduction, } from './client';
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
 * Retry send-to-production for Printify orders WE created that never entered
 * production — `submitOrder` tries once, and a failure there (commonly: no valid
 * payment method on the Printify account) leaves the order waiting at Printify.
 * Reads the fulfilment rows the reconcile keeps current; only rows Printify
 * reports as `pending` / `payment-not-received`, on paid orders from the last
 * 60 days, and only when `autoFulfill` is on.
 *
 * (Replaces the legacy `retryPendingPrintifyFulfillment`, which keyed on
 * `shop_orders.printify_order_id` — a column the provider path never writes —
 * and so re-POSTed every provider-submitted order every 15 minutes; Printify
 * refused each with 409.)
 */
export async function retryHeldPrintifyProduction(cfg: PrintifyConfig,): Promise<{ produced: number; }> {
    if (!cfg.autoFulfill) return { produced: 0, };
    const held = (await query<{ order_id: string; external_order_id: string; order_number: string; }>(
        `SELECT f.order_id, f.external_order_id, o.order_number
         FROM shop_order_fulfillments f
         JOIN shop_orders o ON o.id = f.order_id
         WHERE f.provider = 'printify'
           AND f.external_order_id IS NOT NULL
           AND f.in_production_at IS NULL
           AND f.external_status IN ('pending', 'payment-not-received')
           AND o.status IN ('paid', 'processing')
           AND o.created_at > NOW() - INTERVAL '60 days'
         LIMIT 20`,
    )).rows;
    let produced = 0;
    for (const row of held) {
        try {
            await sendToProduction(cfg, row.external_order_id,);
            produced++;
            logger.info(`Printify order ${row.external_order_id} (${row.order_number}) sent to production on retry.`,);
        } catch (err) {
            logger.warn(`Printify retry send-to-production failed for ${row.order_number}: ${(err as Error).message}`,);
        }
    }
    return { produced, };
}
