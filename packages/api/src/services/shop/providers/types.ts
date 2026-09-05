/**
 * The contract every shop fulfilment provider implements.
 *
 * A "provider" here is a SUPPLIER: somebody who prints/stocks an item and ships
 * it to the buyer on our behalf. It is deliberately NOT the same idea as the
 * Shopify plugin, which replaces the storefront and checkout wholesale — that
 * cannot share a cart with anything, so it stays a plugin.
 *
 * ## Why the optional members are optional
 *
 * Suppliers differ in what they expose, and the differences are load-bearing:
 *
 *  - `syncProducts` — Printify publishes a catalogue we can pull. Apliiq has no
 *    list-designs endpoint at all, so there is nothing to pull; we are the
 *    system of record for its SKUs instead.
 *  - `quoteShipping` — Printify quotes live rates. Apliiq exposes no rate API,
 *    so its lines fall back to the shop's configured flat rate.
 *  - `verifyWebhook`/`parseWebhook` vs `pollStatus` — tracking arrives either by
 *    push (Apliiq POSTs to a URL we configure) or by poll (Printify). A provider
 *    implements one or the other, never both.
 *
 * Only `submitOrder` is mandatory: a supplier we cannot send an order to is not
 * a fulfilment provider.
 */

export type ProviderKey = 'printify' | 'apliiq' | 'printful';

/** A resolved cart line, narrowed to what a supplier needs to fulfil it. */
export interface ProviderLine {
    /** Our `shop_variants.id` — used to correlate the response back to the order. */
    variantId: string;
    /** Supplier's product id (`shop_products.external_id`). */
    externalProductId: string | null;
    /** Supplier's variant id. For Apliiq this is the `APQ-…` SKU. */
    externalVariantId: string | null;
    qty: number;
    /** Shipping weight. 0 when unknown — providers that need it should say so
     *  in their quote rather than silently assuming a value. */
    grams: number;
}

export interface ProviderShippingOption {
    id: string;
    label: string;
    cents: number;
}

export interface ProviderShippingQuote {
    ok: boolean;
    options: ProviderShippingOption[];
    /**
     * Why a quote could not be produced, when `ok` is false:
     * `no-lines` | `no-config` | `no-address` | `api-error`.
     *
     * The storefront distinguishes these — "enter an address to calculate" is a
     * prompt, whereas an API error has to fall back to the flat rate and say so.
     * A failed quote must never result in free shipping.
     */
    reason?: 'no-lines' | 'no-config' | 'no-address' | 'api-error';
    error?: string;
}

/** One credential/option field, rendered by the admin as a form input. */
export interface ProviderField {
    key: string;
    label: string;
    type: 'string' | 'secret' | 'boolean' | 'number';
    required?: boolean;
    help?: string;
    default?: string | number | boolean;
}

/** The order-level facts a supplier needs alongside the lines. */
export interface ProviderOrderContext {
    orderNumber: string;
    email: string;
    name: string | null;
    shippingAddress: unknown;
    /** Buyer-selected method id for THIS provider's group, if any. */
    shippingMethod?: string;
}

export interface ProviderSyncResult {
    upserted: number;
    archived: number;
    skipped?: number;
    errors?: string[];
}

export interface ProviderTracking {
    status: string;
    carrier?: string;
    tracking?: string[];
    trackingUrl?: string;
}

export type ProviderConfig = Record<string, unknown>;

export interface ShopProvider {
    key: ProviderKey;
    label: string;
    /** Short sentence for the admin list. */
    description?: string;
    /** Rendered as this provider's credential form. */
    configSchema: ProviderField[];

    /** True when the saved config has everything needed to talk to the API.
     *  Enabled-but-unconfigured must degrade, never blank the storefront. */
    isConfigured(config: ProviderConfig,): boolean;

    testConnection(config: ProviderConfig,): Promise<{ ok: boolean; message: string; }>;

    /** Present only for suppliers with a pullable catalogue. */
    syncProducts?(config: ProviderConfig,): Promise<ProviderSyncResult>;

    /** Present only for suppliers with a rate API. */
    quoteShipping?(
        config: ProviderConfig,
        lines: ProviderLine[],
        shippingAddress: unknown,
    ): Promise<ProviderShippingQuote>;

    submitOrder(
        config: ProviderConfig,
        order: ProviderOrderContext,
        lines: ProviderLine[],
    ): Promise<{ externalOrderId: string; }>;

    /** Push-tracking providers verify the signature on an inbound webhook. */
    verifyWebhook?(config: ProviderConfig, rawBody: string, headers: Record<string, string>,): boolean;
    parseWebhook?(rawBody: string,): { externalOrderId: string; } & ProviderTracking;

    /** Pull-tracking providers are polled by the shop cron instead. */
    pollStatus?(config: ProviderConfig, externalOrderId: string,): Promise<ProviderTracking>;
}

/** Thrown by a scaffolded provider whose API calls aren't written yet, so the
 *  admin sees an honest message instead of a silent no-op. */
export class ProviderNotImplementedError extends Error {
    constructor(key: string, what: string,) {
        super(`The ${key} integration does not support ${what} yet.`,);
        this.name = 'ProviderNotImplementedError';
    }
}
