/**
 * Stripe connection status for the shop admin. Calls the Stripe API to
 * confirm the configured key reaches a real account and whether that account
 * can accept charges, then caches the result briefly so repeated admin visits
 * don't hammer Stripe. Never exposes the secret key — only derived booleans +
 * public account metadata (display name, country, currency).
 */
import type { ShopStripeStatusResponse, } from '@sitesurge/types';
import * as cache from '../cache';
import { stripeCredentials, } from '../payment/credentials';
import { getStripeClient, } from '../payment/stripe';

const CACHE_TTL_SECONDS = 60;

/** The status shape is the shared wire DTO (one definition, no drift). */
export type ShopStripeStatus = ShopStripeStatusResponse;

function keyMode(): 'test' | 'live' | null {
    const k = stripeCredentials().secretKey;
    if (!k) return null;
    return k.startsWith('sk_live', ) || k.startsWith('rk_live',) ? 'live' : 'test';
}

async function computeStatus(): Promise<ShopStripeStatus> {
    const creds = stripeCredentials();
    const base = {
        mode: keyMode(),
        webhookConfigured: Boolean(creds.webhookSecret,),
        publishableKeyConfigured: Boolean(creds.publishableKey,),
        checkedAt: new Date().toISOString(),
    };

    const client = getStripeClient();
    if (!client) {
        return {
            ...base,
            configured: false,
            connected: false,
            chargesEnabled: false,
            payoutsEnabled: false,
            detailsSubmitted: false,
            accountId: null,
            displayName: null,
            country: null,
            defaultCurrency: null,
            error: 'No Stripe secret key configured (set STRIPE_SECRET_KEY).',
        };
    }

    try {
        // Stripe v22 dropped the zero-arg retrieve() overload; passing an
        // explicit null id resolves the account tied to the API key.
        const account = await client.accounts.retrieve(null,);
        return {
            ...base,
            configured: true,
            connected: true,
            chargesEnabled: Boolean(account.charges_enabled,),
            payoutsEnabled: Boolean(account.payouts_enabled,),
            detailsSubmitted: Boolean(account.details_submitted,),
            accountId: account.id,
            displayName: account.settings?.dashboard?.display_name
                || account.business_profile?.name
                || account.email
                || null,
            country: account.country || null,
            defaultCurrency: account.default_currency ? account.default_currency.toUpperCase() : null,
            error: null,
        };
    } catch (err) {
        return {
            ...base,
            configured: true,
            connected: false,
            chargesEnabled: false,
            payoutsEnabled: false,
            detailsSubmitted: false,
            accountId: null,
            displayName: null,
            country: null,
            defaultCurrency: null,
            error: (err as Error).message || 'Failed to reach Stripe.',
        };
    }
}

/**
 * Get the cached Stripe status (60s TTL), or force a fresh check with
 * `refresh=true`. Errors are cached too (with the same short TTL) so a bad
 * key doesn't hammer Stripe, but they self-heal on the next window.
 */
export async function getStripeStatus(refresh = false,): Promise<ShopStripeStatus> {
    if (!refresh) {
        const cached = await cache.get<ShopStripeStatus>(cache.CACHE_KEYS.shopStripeStatus,);
        if (cached) return cached;
    }
    const status = await computeStatus();
    await cache.set(cache.CACHE_KEYS.shopStripeStatus, status, CACHE_TTL_SECONDS,);
    return status;
}
