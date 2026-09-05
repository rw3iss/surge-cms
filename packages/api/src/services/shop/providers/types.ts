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
 *    list endpoint because its integration is INVERTED: the operator clicks
 *    "Add to Store" and Apliiq POSTs the product to a webhook we own. Nothing
 *    to pull, so the member is simply absent.
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

    /**
     * Pre-flight for an incoming product, before anything is written.
     *
     * Optional: a provider that does not implement it gets `defaultStoreAddCheck`,
     * which dedupes on (provider, externalId) then (provider, externalDesignId).
     * Implement it to add provider-specific rules — Apliiq, for example, derives
     * the design stem from the SKUs and refuses a payload whose variants
     * disagree, since that would be two designs arriving as one product.
     */
    beforeStoreAdd?(
        config: ProviderConfig,
        incoming: IncomingStoreProduct,
    ): Promise<StoreAddDecision>;

    /**
     * Inbound webhook events this provider offers. The URLs are generated and
     * owned by US — the operator copies them out of our admin and pastes them
     * into the provider's dashboard.
     */
    webhookEvents?: ProviderWebhookEvent[];
}

export interface ProviderWebhookEvent {
    event: string;
    /** As the provider's own settings screen names it, so the operator can match
     *  our row to their field without guessing. */
    label: string;
    /** Default URL segment; operator-editable per install. */
    path: string;
    /** Not everything is a POST — Apliiq's product search is a GET with ?search=. */
    method: 'POST' | 'GET';
    /** False when the provider does not sign this one. Surfaced in the admin,
     *  because an unsigned endpoint that mutates the catalogue needs to be
     *  visibly flagged rather than quietly trusted. */
    signed: boolean;
}

// ─── Store-add pipeline ───────────────────────────────────────────
//
// Products reach us two ways — pushed by a webhook (Apliiq) or pulled by a sync
// (Printify) — and both funnel through the same pre-flight so dedupe, rejection
// and logging behave identically whichever direction they came from.

/** A product arriving from a provider, normalised before any DB write. */
export interface IncomingStoreProduct {
    /** The provider's id for the PRODUCT. */
    externalId: string | null;
    /** The provider's id for the DESIGN/TEMPLATE it was generated from. For
     *  Apliiq this is the stem shared by its SKUs (APQ-4633445S6A1 → 4633445). */
    externalDesignId: string | null;
    name: string;
    variants: Array<{ sku: string; priceCents: number; }>;
    /** Provider asked for a replace rather than a create. */
    replaceProduct?: boolean;
    /** The untouched payload, for logging and provider-specific hooks. */
    raw: unknown;
}

/** What the ingest pipeline should do with an incoming product. */
export type StoreAddDecision =
    | { action: 'create'; }
    | { action: 'update'; productId: string; }
    /** Already present and unchanged — report success without writing. */
    | { action: 'skip'; productId: string; reason: string; }
    /** Refuse: malformed, unsupported, or violates a provider rule. The reason
     *  is shown to the operator (Apliiq echoes it in its own UI), so it must
     *  read as a sentence, not a code. */
    | { action: 'reject'; reason: string; };

/** Thrown by a scaffolded provider whose API calls aren't written yet, so the
 *  admin sees an honest message instead of a silent no-op. */
export class ProviderNotImplementedError extends Error {
    constructor(key: string, what: string,) {
        super(`The ${key} integration does not support ${what} yet.`,);
        this.name = 'ProviderNotImplementedError';
    }
}
