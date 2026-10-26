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
    /** Curation marker for querying (e.g. a carousel filtering
     *  `isFeatured = true`). Independent of `status` — a featured product that
     *  is drafted or archived must still not surface publicly. */
    isFeatured?: boolean;
    /** Shipping pricing model. Defaults to 'flat'. */
    shippingType?: ShopShippingType;
    /** When flat: use the shop's configured flat rate instead of per-variant. */
    useDefaultShipping?: boolean;
    ratingAvg: number;
    ratingCount: number;
    /** Manual sort order. Products with a position sort first (ascending);
     *  null/undefined products fall back to updatedAt DESC. Set via drag-reorder
     *  in the admin table or the per-product Position dropdown. */
    position?: number | null;
    createdBy?: string | null;
    createdAt: string;
    updatedAt: string;
    /** Minimum variant price (cents). Populated on list responses
     *  (findPublicProducts / findAllProducts); undefined on other reads. */
    fromPriceCents?: number;
    /** Units in stock across all variants. Populated on list responses
     *  (shown on cards when `ShopAppearance.showInventory` is on). */
    inventoryTotal?: number;
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
    /** Inventory set by hand in the admin: a provider sync keeps it and only
     *  lowers it when the provider reports fewer units. */
    inventoryManual?: boolean;
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
    /** Count of ACTIVE products in this category (from the list endpoint). */
    productCount?: number;
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

/** Every order status, in lifecycle order — the one list admin filters use. */
export const SHOP_ORDER_STATUSES: readonly ShopOrderStatus[] = [
    'pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded',
];

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
    /** Human label of the shipping method applied (e.g. 'Standard', 'Express'). */
    shippingMethod?: string | null;
    discountCents: number;
    totalCents: number;
    currency: string;
    stripePaymentIntentId?: string | null;
    stripeChargeId?: string | null;
    shippingAddress?: ShopAddress | null;
    billingAddress?: ShopAddress | null;
    fulfillmentStatus: ShopFulfillmentStatus;
    trackingNumber?: string | null;
    /** Tracking URL + carrier — synced back from Printify shipments. */
    trackingUrl?: string | null;
    carrier?: string | null;
    /** True once an admin typed the order-level carrier / number / URL — a
     *  supplier sync then leaves those three columns alone. */
    trackingManual?: boolean;
    /**
     * Every parcel, resolved for display (carrier label + the link to use) —
     * attached by the server on order reads, so every surface shows the same
     * thing. Empty when the order has no tracking yet.
     */
    shipments?: ShopOrderShipment[];
    /** Printify order id + status when the order was fulfilled by Printify. */
    printifyOrderId?: string | null;
    printifyStatus?: string | null;
    notes?: string | null;
    /**
     * Confirmation secret (`?k=` on the order page link). Present for admins,
     * the signed-in owner and a caller that presented it; null otherwise.
     */
    accessKey?: string | null;
    createdAt: string;
    updatedAt: string;
}

/** One parcel of an order, resolved for display (see `resolveOrderShipments`). */
export interface ShopOrderShipment {
    /** The raw carrier code as the supplier / admin gave it (e.g. `DHL_eCommerce_Expedited`). */
    carrier: string | null;
    /** Friendly carrier name (`DHL eCommerce Expedited`). Null when unknown. */
    carrierLabel: string | null;
    number: string | null;
    /** The tracking link to show, after the precedence rules. Null = none. */
    url: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    /** `manual` = typed by an admin, `supplier` = a supplier parcel,
     *  `order` = the order-level columns of an older order. */
    source: 'manual' | 'supplier' | 'order';
    /** The supplier that shipped it (`printify`, …) when known. */
    provider?: string | null;
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
    /** Who fulfilled this line: 'native', 'event_tickets', or a provider key.
     *  Captured at order time so the record survives a product being
     *  reassigned to a different supplier later. */
    fulfillmentGroup?: string | null;
    externalProductId?: string | null;
    externalVariantId?: string | null;
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

/** One carrier → tracking-page URL template (`{number}` is replaced). */
export interface ShopCarrierTrackingTemplate {
    /** Carrier code as suppliers send it (`USPS`, `ONTRAC`, `DHL_ECOMMERCE`). Matched
     *  case- and punctuation-insensitively; a longer code wins over a prefix. */
    carrier: string;
    urlTemplate: string;
}

/** Shop settings → Order tracking. */
export interface ShopTrackingSettings {
    /** Use the supplier's own tracking link when it has one (default true);
     *  false = always build the link from `carriers`. */
    useSupplierLinks?: boolean;
    /** Carrier link templates. Unset = the built-in defaults
     *  (`DEFAULT_CARRIER_TRACKING_TEMPLATES`); an empty list = none. */
    carriers?: ShopCarrierTrackingTemplate[];
}

export interface ShopSettings {
    currency: string;
    /**
     * Mailing list that receives the new-merchandise announcement, and that the
     * storefront signup tout subscribes people to.
     *
     * The announcement email and the tout are BOTH inert without this: an
     * announcement with no audience and a signup button with no destination are
     * worse than nothing, so the admin warns rather than silently doing nothing.
     */
    newMerchandiseListId?: string | null;
    /** Show the "get notified about new merchandise" tout on /shop. */
    showMerchandiseSignup?: boolean;
    /** Add people who use that tout to Contacts. Inert while `contacts` is off. */
    merchandiseSignupAddContact?: boolean;
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
    /**
     * How a cart containing items from more than one fulfiller is presented.
     *
     * `combined` shows one list and one shipping line — the buyer never learns
     * who prints what. `grouped` shows a section per supplier, each with its own
     * shipping, which is honest about multiple parcels arriving separately.
     *
     * Presentation only: the payment is a single charge either way, because
     * print suppliers bill us, not the customer.
     */
    cartDisplay?: 'combined' | 'grouped';
    /** Buyer emails, the confirmation page and the PDF receipt. Only offered
     *  when `cartDisplay` is `grouped` — a grouped email after a combined cart
     *  tells the buyer something the checkout never did. */
    orderEmailDisplay?: 'combined' | 'grouped';
    /** The seller notification. Defaults to `grouped`: the operator needs the
     *  fulfilment breakdown even when the buyer is shown one list. */
    adminNotificationDisplay?: 'combined' | 'grouped';
    /** Order tracking links (carrier templates + supplier-link preference). */
    tracking?: ShopTrackingSettings;
}

export interface ShopAppearance {
    gridColumns: number;
    showRatings: boolean;
    /** Show the units in stock on product cards and the product page
     *  ("12 in stock" / "Out of stock"). Default off. */
    showInventory?: boolean;
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
    /** Render the "notify me about new merchandise" tout on /shop. True only
     *  when the operator enabled it AND assigned a mailing list. */
    merchandiseSignupEnabled?: boolean;
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
    /** Whether the storefront shows a section per fulfiller. Display only —
     *  the buyer always pays once. */
    cartDisplay?: 'combined' | 'grouped';
}

// ── Admin: dashboard stats + per-supplier fulfilment ─────────────────

/** GET /shop/orders/stats — dashboard figures for named periods. */
export interface ShopStats {
    currency: string;
    /** Paid orders (paid → delivered) and their revenue, per period. */
    periods: Array<{ days: number; revenueCents: number; orders: number; }>;
    /** Paid / processing — money taken, not shipped yet. */
    toShip: number;
    /** Supplier hand-offs that need a human (same rule as the orders filter). */
    needsAttention: number;
    /** Active products at or below `lowStockThreshold` units. */
    lowStock: number;
    lowStockThreshold: number;
    productCount: number;
    activeProductCount: number;
}

/** One supplier's hand-off for an order (GET /shop/orders/:id/fulfilments). */
export interface ShopOrderFulfilment {
    provider: string;
    /** Row status (`not_sent` when the supplier has lines but no row yet). */
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
    /** The supplier's own page for this order, when known. */
    externalUrl?: string | null;
}
