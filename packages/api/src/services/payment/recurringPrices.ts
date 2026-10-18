/**
 * Every active RECURRING price in the default Stripe account — ONE listing
 * shared by the membership catalogue (`membership.priceDetails`, cached in
 * Redis) and the admin price picker (`subscriptionTiers.stripePrices`, read
 * fresh). Before, both paged through Stripe and mapped prices slightly
 * differently, so a Stripe API change had to be fixed twice.
 *
 * Throws on a Stripe error (callers decide how to degrade); returns [] when
 * Stripe is not configured.
 */
import type Stripe from 'stripe';
import { getStripeClient, } from './stripe';

export interface RecurringPrice {
    priceId: string;
    productId: string | null;
    productName: string;
    /** Null for a deleted product. */
    productDescription: string | null;
    productDeleted: boolean;
    nickname: string | null;
    unitAmount: number | null;
    currency: string;
    interval: string;
    intervalCount: number;
    /** This price is its product's default price. */
    isProductDefault: boolean;
}

export async function listRecurringPrices(opts: { max?: number; } = {},): Promise<RecurringPrice[]> {
    const stripe = getStripeClient('default',);
    if (!stripe) return [];
    const out: RecurringPrice[] = [];
    for await (const p of stripe.prices.list({ active: true, type: 'recurring', expand: ['data.product',], limit: 100, },)) {
        out.push(mapPrice(p,),);
        if (opts.max && out.length >= opts.max) break;
    }
    return out;
}

/** Exported for tests. */
export function mapPrice(p: Stripe.Price,): RecurringPrice {
    const product = typeof p.product === 'string' ? null : p.product;
    const deleted = Boolean(product && 'deleted' in product && product.deleted,);
    const live = product && !deleted ? product as Stripe.Product : null;
    const def = live?.default_price;
    return {
        priceId: p.id,
        productId: typeof p.product === 'string' ? p.product : p.product?.id ?? null,
        productName: live?.name ?? (typeof p.product === 'string' ? p.product : ''),
        productDescription: live?.description ?? null,
        productDeleted: deleted,
        nickname: p.nickname ?? null,
        unitAmount: p.unit_amount ?? null,
        currency: p.currency,
        interval: p.recurring?.interval ?? 'month',
        intervalCount: p.recurring?.interval_count ?? 1,
        isProductDefault: Boolean(def && (typeof def === 'string' ? def : def.id) === p.id,),
    };
}
