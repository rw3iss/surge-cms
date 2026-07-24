/**
 * Shared entity types for the Shop feature module. Used by frontend,
 * backend, and the headless client. camelCase fields; wire timestamps are
 * ISO strings. Mirrors the `shop_*` schema (migrations 039–049).
 */

export type ShopProductType = 'physical' | 'digital';
export type ShopProductStatus = 'draft' | 'active' | 'archived';
/** How a product's shipping is priced. 'flat' = static fee (shop default or
 *  per-variant override); 'calculated' = dynamic quote at checkout (future). */
export type ShopShippingType = 'flat' | 'calculated';

export interface ShopProduct {
    id: string;
    title: string;
    slug: string;
    description?: string | null;
    type: ShopProductType;
    status: ShopProductStatus;
    metaTitle?: string | null;
    metaDescription?: string | null;
    /** Shipping pricing model. Defaults to 'flat'. */
    shippingType?: ShopShippingType;
    /** When flat: use the shop's configured flat rate instead of per-variant. */
    useDefaultShipping?: boolean;
    ratingAvg: number;
    ratingCount: number;
    createdBy?: string | null;
    createdAt: string;
    updatedAt: string;
    /** Minimum variant price (cents). Populated on list responses
     *  (findPublicProducts / findAllProducts); undefined on other reads. */
    fromPriceCents?: number;
    /** URL of the product's position-0 image. Populated on list responses;
     *  undefined on other reads, null when the product has no image. */
    primaryImageUrl?: string | null;
    // ─── External source (Printify / other integrations) ───
    /** Set when this product is synced from an external provider (e.g.
     *  'printify'). External products are read-only in the admin and edited at
     *  the provider. Null/undefined for native products. */
    externalProvider?: string | null;
    /** The provider's product id (idempotent-sync key with externalProvider). */
    externalId?: string | null;
    /** Deep link to manage this product at the provider. */
    externalUrl?: string | null;
    /** ISO timestamp of the last successful sync from the provider. */
    externalSyncedAt?: string | null;
}

export interface ShopProductOption {
    id: string;
    productId: string;
    name: string;
    position: number;
    createdAt: string;
}

export interface ShopOptionValue {
    id: string;
    optionId: string;
    value: string;
    position: number;
}

export interface ShopVariant {
    id: string;
    productId: string;
    sku?: string | null;
    priceCents: number;
    compareAtPriceCents?: number | null;
    inventoryQty: number;
    weightGrams?: number | null;
    requiresShipping: boolean;
    /** Per-variant flat shipping cost (cents). Used when the product is flat-fee
     *  and not using the shop default rate. Null → 0. */
    shippingCents?: number | null;
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
    imageId?: string | null;
    position: number;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
    /** External provider's variant id (e.g. Printify variant), for order
     *  fulfillment mapping. Null for native variants. */
    externalId?: string | null;
}

export type ShopProductMediaKind = 'image' | 'video';

export interface ShopProductMedia {
    id: string;
    productId: string;
    /** Imported media asset id. Null when the row points at an external URL
     *  (`externalUrl`) instead — e.g. a Printify CDN image. */
    mediaId?: string | null;
    /** External image URL (used when mediaId is null). */
    externalUrl?: string | null;
    variantId?: string | null;
    position: number;
    kind: ShopProductMediaKind;
    createdAt: string;
}

export interface ShopCategory {
    id: string;
    name: string;
    slug: string;
    parentId?: string | null;
    description?: string | null;
    imageId?: string | null;
    position: number;
    createdAt: string;
    updatedAt: string;
}

export interface ShopCollection {
    id: string;
    title: string;
    slug: string;
    description?: string | null;
    imageId?: string | null;
    position: number;
    isPublished: boolean;
    createdAt: string;
    updatedAt: string;
    /** Number of products in the collection (populated by list queries). */
    productCount?: number;
}

export type ShopReviewStatus = 'pending' | 'approved' | 'rejected';

export interface ShopReview {
    id: string;
    productId: string;
    userId?: string | null;
    orderId?: string | null;
    rating: number;
    title?: string | null;
    body?: string | null;
    status: ShopReviewStatus;
    verifiedPurchase: boolean;
    helpfulCount: number;
    createdAt: string;
    updatedAt: string;
    /** Parent product's title (populated on the admin review list). */
    productTitle?: string | null;
}

export type ShopOrderStatus =
    | 'pending'
    | 'paid'
    | 'processing'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'refunded';

export type ShopFulfillmentStatus = 'unfulfilled' | 'partial' | 'fulfilled';

export interface ShopAddress {
    name?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
}

export interface ShopOrder {
    id: string;
    orderNumber: string;
    userId?: string | null;
    customerEmail: string;
    customerName?: string | null;
    status: ShopOrderStatus;
    subtotalCents: number;
    taxCents: number;
    shippingCents: number;
    discountCents: number;
    totalCents: number;
    currency: string;
    stripePaymentIntentId?: string | null;
    stripeChargeId?: string | null;
    shippingAddress?: ShopAddress | null;
    billingAddress?: ShopAddress | null;
    fulfillmentStatus: ShopFulfillmentStatus;
    trackingNumber?: string | null;
    notes?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ShopOrderItem {
    id: string;
    orderId: string;
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
    createdAt: string;
}

// ── Composite / assembled read shapes ────────────────────────────────

/** A product option with its ordered values (assembled read). */
export interface ShopProductOptionDetail extends ShopProductOption {
    values: ShopOptionValue[];
}

/** A product media row joined to the underlying media asset's url/type. */
export interface ShopProductMediaDetail extends ShopProductMedia {
    url: string;
    mediaType?: string | null;
    thumbnailUrl?: string | null;
    alt?: string | null;
}

/**
 * Full product detail: the product row plus its assembled options (with
 * values), variants, and media. Returned by slug/by-id reads and stored
 * by the product save (`replaceProductStructure`).
 */
export interface ShopProductDetail extends ShopProduct {
    options: ShopProductOptionDetail[];
    variants: ShopVariant[];
    media: ShopProductMediaDetail[];
    categoryIds: string[];
    collectionIds: string[];
    tags: string[];
}

/** Full order detail: the order row plus its line-item snapshots. */
export interface ShopOrderDetail extends ShopOrder {
    items: ShopOrderItem[];
}

// ── Config (site_settings rows: shop_settings / shop_appearance) ──────

export interface ShopShippingRate {
    name: string;
    priceCents: number;
}

export interface ShopSettings {
    currency: string;
    taxEnabled: boolean;
    businessName: string;
    businessAddress?: string;
    storeEnabled: boolean;
    stripeTaxEnabled?: boolean;
    shipping?: {
        flatCents?: number;
        freeThresholdCents?: number;
        /** When true, the first shippable item uses `flatCents` and each
         *  additional item uses `additionalItemCents`. */
        useAdditionalItemRate?: boolean;
        /** Flat rate applied to each item after the first (cents). */
        additionalItemCents?: number;
        rates?: ShopShippingRate[];
    };
}

export interface ShopAppearance {
    gridColumns: number;
    showRatings: boolean;
    cardStyle: string;
    currencyDisplay?: string;
}

/**
 * Storefront-safe projection of `ShopSettings`. Emitted by the public
 * `GET /shop/settings` endpoint (cached, served to everyone). Carries only
 * display-relevant flags — NEVER Stripe secret keys, payout/account
 * internals, or business address. Stripe keys live in env/config, not in
 * these `site_settings` rows, so they can't leak here by construction.
 */
export interface ShopPublicSettings {
    currency: string;
    /** display flag only (does the store apply tax?) — not a rate */
    taxEnabled: boolean;
    storeEnabled: boolean;
    businessName: string;
    currencyDisplay?: string;
    /** Stripe publishable key (public by design) — the checkout page loads
     *  Stripe Elements with it. Empty/undefined when Stripe isn't configured. */
    stripePublishableKey?: string;
    /** Public shipping config for storefront display (flat rate + free-ship
     *  threshold + optional additional-item rate). Cents. */
    shipping?: {
        flatCents?: number;
        freeThresholdCents?: number;
        useAdditionalItemRate?: boolean;
        additionalItemCents?: number;
    };
}
