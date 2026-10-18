/**
 * Wire DTOs for the shop feature module (mounted at /api/v1/shop,
 * `requireFeature('shop')`). Entity types live in `../../types/shop` and
 * are referenced — never re-declared — by the request/response DTOs.
 *
 * Phase 2 fills the CATALOG surface: products (+ nested options/variants/
 * media/taxonomy), categories, collections, tags. Later phases add
 * reviews (3), checkout + orders (4), and shop settings (5).
 *
 * Naming follows the barrel convention (`../index.ts`): `Shop<Action>`
 * Query / Body / Params for requests, `Shop<Action>Response` for the
 * `data` payload; list responses type `data` as the element array with
 * pagination on `ApiResponse.meta`.
 */

import type {
    ShopAddress,
    ShopAppearance,
    ShopCategory,
    ShopCollection,
    ShopFulfillmentStatus,
    ShopOrder,
    ShopOrderDetail,
    ShopOrderStatus,
    ShopProduct,
    ShopProductDetail,
    ShopProductType,
    ShopPublicSettings,
    ShopReview,
    ShopSettings,
    ShopShippingType,
} from '../../types/shop';
import type { BulkActionResult, } from './_shared';

// ─── Nested write inputs (product structure) ──────────────────────

/** An option + its ordered values, as sent in a product write. */
export interface ShopOptionInput {
    name: string;
    position?: number;
    values: { value: string; position?: number; }[];
}

/** A variant, as sent in a product write. */
export interface ShopVariantInput {
    sku?: string | null;
    priceCents: number;
    compareAtPriceCents?: number | null;
    inventoryQty?: number;
    /** true = the admin set this inventory by hand (a provider sync keeps it,
     *  only lowering it to the provider's count); false = follow the provider.
     *  Omitted = keep the stored flag. */
    inventoryManual?: boolean;
    weightGrams?: number | null;
    requiresShipping?: boolean;
    /** Per-variant flat shipping cost (cents) for flat-fee products. */
    shippingCents?: number | null;
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
    imageId?: string | null;
    position?: number;
    isDefault?: boolean;
}

/** A product-media assignment, as sent in a product write. */
export interface ShopMediaInput {
    /** Imported asset id OR — for provider-synced media (Printify) — an
     *  externalUrl. Exactly one is set per row. */
    mediaId?: string | null;
    externalUrl?: string | null;
    variantId?: string | null;
    position?: number;
    kind?: 'image' | 'video';
}

// ─── GET /shop/products ───────────────────────────────────────────

/** Query accepted by GET /shop/products. */
export interface ShopProductListQuery {
    /** Fulfilment source: a provider key, or 'native' for our own stock. */
    provider?: string;
    /** public/admin: substring match on title/description */
    search?: string;
    sortBy?: string;
    sortOrder?: string;
    /** admin trigger: 'true' switches to the all-statuses view */
    all?: string;
    /** admin filter (presence also triggers the admin view) */
    status?: string;
    page?: number;
    limit?: number;
}

/** GET /shop/products — active products (public) or any-status (admin).
 *  Page meta rides the ApiResponse envelope. */
export type ShopProductListResponse = ShopProduct[];

// ─── GET /shop/products/slug/:slug ────────────────────────────────

/** Params for GET /shop/products/slug/:slug. */
export interface ShopProductBySlugParams {
    slug: string;
}

/** Query accepted by GET /shop/products/slug/:slug. */
export interface ShopProductBySlugQuery {
    /** admin-preview: 'admin' returns any-status detail when authorized */
    preview?: string;
}

/** GET /shop/products/slug/:slug — full nested detail. */
export type ShopProductBySlugResponse = ShopProductDetail;

// ─── GET /shop/products/:id (admin) ───────────────────────────────

/** Params for the product-by-id family of routes. */
export interface ShopProductIdParams {
    id: string;
}

/** GET /shop/products/:id — full nested detail at any status. */
export type ShopProductByIdResponse = ShopProductDetail;

// ─── POST /shop/products ──────────────────────────────────────────

/** Body for POST /shop/products (create + structure). */
export interface ShopProductCreateBody {
    title: string;
    slug: string;
    description?: string | null;
    type?: ShopProductType;
    status?: 'draft' | 'active' | 'archived';
    metaTitle?: string | null;
    isFeatured?: boolean;
    metaDescription?: string | null;
    shippingType?: ShopShippingType;
    useDefaultShipping?: boolean;
    options?: ShopOptionInput[];
    variants?: ShopVariantInput[];
    media?: ShopMediaInput[];
    categoryIds?: string[];
    collectionIds?: string[];
    tags?: string[];
    /** Manual sort position (null clears it → falls back to updated_at order). */
    position?: number | null;
}

/** POST /shop/products (201) — the created product, full detail. */
export type ShopProductCreateResponse = ShopProductDetail;

// ─── PUT /shop/products/:id ───────────────────────────────────────

/** Body for PUT /shop/products/:id — partial create body. */
export type ShopProductUpdateBody = Partial<ShopProductCreateBody>;

/** PUT /shop/products/:id — the updated product, full detail. */
export type ShopProductUpdateResponse = ShopProductDetail;

// ─── DELETE /shop/products/:id ────────────────────────────────────

/** DELETE /shop/products/:id — confirmation message. */
export interface ShopProductDeleteResponse {
    message: string;
}

// ─── POST /shop/products/bulk ─────────────────────────────────────

/** Body for POST /shop/products/bulk (unified bulk runner). */
export interface ShopProductBulkBody {
    ids: string[];
    action: 'delete' | 'status';
    /** status value when action='status' */
    value?: string;
}

/** POST /shop/products/bulk — count + action performed. */
export type ShopProductBulkResponse = BulkActionResult;

// ─── PUT /shop/products/reorder ───────────────────────────────────

/** Body for PUT /shop/products/reorder — the currently-visible product ids in
 *  their new order (any filter/page). The server merges this into the full
 *  catalog order, leaving off-screen products in place. */
export interface ShopProductReorderBody {
    orderedIds: string[];
}

/** PUT /shop/products/reorder — confirmation message. */
export interface ShopProductReorderResponse {
    message: string;
}

// ─── Categories ───────────────────────────────────────────────────

/** GET /shop/categories — flat list (tree assembled via parentId). */
export type ShopCategoryListResponse = ShopCategory[];

/** Params for GET /shop/categories/slug/:slug. */
export interface ShopCategoryBySlugParams {
    slug: string;
}

/** GET /shop/categories/slug/:slug — the category plus its active products. */
export interface ShopCategoryBySlugResponse {
    category: ShopCategory;
    products: ShopProduct[];
}

/** Params for the category-by-id family. */
export interface ShopCategoryIdParams {
    id: string;
}

/** Body for POST /shop/categories (create). */
export interface ShopCategoryCreateBody {
    name: string;
    slug: string;
    parentId?: string | null;
    description?: string | null;
    imageId?: string | null;
    position?: number;
}

/** POST /shop/categories (201) — the created category. */
export type ShopCategoryCreateResponse = ShopCategory;

/** Body for PUT /shop/categories/:id — partial create body. */
export type ShopCategoryUpdateBody = Partial<ShopCategoryCreateBody>;

/** PUT /shop/categories/:id — the updated category. */
export type ShopCategoryUpdateResponse = ShopCategory;

/** DELETE /shop/categories/:id — confirmation message. */
export interface ShopCategoryDeleteResponse {
    message: string;
}

// ─── PUT /shop/categories/reorder ─────────────────────────────────

/** Body for PUT /shop/categories/reorder — category ids in their new order. */
export interface ShopCategoryReorderBody {
    orderedIds: string[];
}

/** PUT /shop/categories/reorder — confirmation message. */
export interface ShopCategoryReorderResponse {
    message: string;
}

// ─── Collections ──────────────────────────────────────────────────

/** GET /shop/collections — published (public) or all (admin via all=true). */
export type ShopCollectionListResponse = ShopCollection[];

/** Query accepted by GET /shop/collections. */
export interface ShopCollectionListQuery {
    /** admin trigger: 'true' returns unpublished collections too */
    all?: string;
}

/** Params for GET /shop/collections/slug/:slug. */
export interface ShopCollectionBySlugParams {
    slug: string;
}

/** GET /shop/collections/slug/:slug — the collection plus curated products. */
export interface ShopCollectionBySlugResponse {
    collection: ShopCollection;
    products: ShopProduct[];
}

/** Params for the collection-by-id family. */
export interface ShopCollectionIdParams {
    id: string;
}

/** Body for POST /shop/collections (create). `productIds` sets membership. */
export interface ShopCollectionCreateBody {
    title: string;
    slug: string;
    description?: string | null;
    imageId?: string | null;
    position?: number;
    isPublished?: boolean;
    productIds?: string[];
}

/** POST /shop/collections (201) — the created collection. */
export type ShopCollectionCreateResponse = ShopCollection;

/** Body for PUT /shop/collections/:id — partial create body. */
export type ShopCollectionUpdateBody = Partial<ShopCollectionCreateBody>;

/** PUT /shop/collections/:id — the updated collection. */
export type ShopCollectionUpdateResponse = ShopCollection;

/** DELETE /shop/collections/:id — confirmation message. */
export interface ShopCollectionDeleteResponse {
    message: string;
}

// ─── Tags ─────────────────────────────────────────────────────────

/** GET /shop/tags — distinct tag list. */
export type ShopTagListResponse = string[];

// ─── Reviews ──────────────────────────────────────────────────────
// Public list = approved-only (cache-safe); admin list = any status
// (moderation queue). New reviews are always created `status='pending'`.

/** Params for GET/POST /shop/products/:productId/reviews. */
export interface ShopReviewProductParams {
    productId: string;
}

/** Query accepted by GET /shop/products/:productId/reviews (public). */
export interface ShopReviewListQuery {
    /** 'helpful' → most-helpful first; else newest first */
    sort?: string;
    page?: number;
    limit?: number;
}

/** GET /shop/products/:productId/reviews — approved reviews (public).
 *  Page meta rides the ApiResponse envelope. */
export type ShopReviewListResponse = ShopReview[];

/** Body for POST /shop/products/:productId/reviews (user tier). */
export interface ShopReviewCreateBody {
    rating: number;
    title?: string;
    body?: string;
}

/** POST /shop/products/:productId/reviews (201) — the created (pending) review. */
export type ShopReviewCreateResponse = ShopReview;

/** Params for the review-by-id family (helpful / moderate / delete). */
export interface ShopReviewIdParams {
    id: string;
}

/** POST /shop/reviews/:id/helpful — new helpful count. */
export interface ShopReviewHelpfulResponse {
    /** Whether the current user/IP now has a helpful mark (toggled state). */
    helpful: boolean;
    helpfulCount: number;
}

/** GET /shop/products/:productId/reviews/helpful-mine — review ids the current
 *  user/IP has marked helpful for that product. */
export type ShopReviewHelpfulMineResponse = string[];

/** Query accepted by GET /shop/reviews (admin moderation queue). */
export interface ShopReviewAdminListQuery {
    status?: string;
    productId?: string;
    page?: number;
    limit?: number;
}

/** GET /shop/reviews — any-status reviews (admin). Page meta on the envelope. */
export type ShopReviewAdminListResponse = ShopReview[];

/** Body for PUT /shop/reviews/:id (admin moderate). */
export interface ShopReviewModerateBody {
    status: 'approved' | 'rejected';
}

/** PUT /shop/reviews/:id — the moderated review. */
export type ShopReviewModerateResponse = ShopReview;

/** DELETE /shop/reviews/:id — confirmation message. */
export interface ShopReviewDeleteResponse {
    message: string;
}

// ─── Checkout ─────────────────────────────────────────────────────
// Both routes are `optional` auth (guest or logged-in). Totals are always
// computed server-side from DB variant prices — the client's items are just
// {variantId, qty}.

/** One cart line as sent to checkout: a variant + quantity. */
export interface ShopCheckoutLine {
    /** Variant id — or a ticket line's cart key (`event:<id>:<date>:<tier>`). */
    variantId: string;
    qty: number;
    /** `event_ticket` = a virtual ticket line, priced from the event's tier. */
    kind?: 'product' | 'event_ticket';
    eventId?: string;
    occurrenceDate?: string;
    tierId?: string;
    /** Who the tickets are for; defaults to the order's customer. */
    attendee?: ShopTicketAttendee;
}

/** Attendee details carried on a ticket line into the order. */
export interface ShopTicketAttendee {
    email?: string;
    name?: string;
    phone?: string;
    fields?: Record<string, unknown>;
}

/** Body for POST /shop/checkout/preview — validate + price WITHOUT
 *  creating an order (live checkout-page total). */
export interface ShopCheckoutPreviewBody {
    items: ShopCheckoutLine[];
    shippingAddress?: ShopAddress | null;
    /** The shipping method the buyer picked (e.g. 'standard' | 'economy' |
     *  'express'). Omit to let the server default (cheapest / standard).
     *  A record chooses per fulfilment group; a bare string applies to all. */
    shippingMethod?: string | Record<string, string>;
}

/** One selectable shipping option: an id, a display label, and its total cost
 *  (cents) for the whole cart (native flat shipping + provider quote). */
export interface ShopShippingOption {
    id: string;
    label: string;
    cents: number;
}

/** Server-computed totals (cents). */
export interface ShopCheckoutTotals {
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
    currency: string;
    /** The applied shipping method id + label (present when shipping applies). */
    shippingMethod?: string;
    shippingMethodLabel?: string;
    /** All selectable shipping options for this cart/address. */
    shippingOptions?: ShopShippingOption[];
    /** True when a provider (Printify) shipping quote failed and a configured
     *  flat-rate fallback was applied — the storefront can note this. */
    shippingQuoteFailed?: boolean;
    /** True when shipping is an ESTIMATE because no address is entered yet — the
     *  storefront captions "enter address to calculate". */
    shippingEstimated?: boolean;
    /** Cart variant ids no longer available (removed/inactive); the storefront
     *  prunes these lines from the cart and notifies the buyer. */
    unavailableVariantIds?: string[];
    /** Per-fulfiller breakdown. Always returned; the storefront renders it as
     *  sections or collapses it depending on the shop's `cartDisplay`. */
    groups?: ShopCheckoutGroup[];
}

export interface ShopCheckoutGroup {
    key: string;
    label: string;
    isProvider: boolean;
    subtotalCents: number;
    shippingCents: number;
    shippingMethod?: string;
    shippingMethodLabel?: string;
    shippingOptions: ShopShippingOption[];
    shippingQuoteFailed?: boolean;
    shippingEstimated?: boolean;
    /** Cart lines in this group, so the client renders sections without
     *  duplicating the grouping rules. */
    variantIds: string[];
}

/** POST /shop/checkout/preview — the computed totals. */
export type ShopCheckoutPreviewResponse = ShopCheckoutTotals;

/** Body for POST /shop/checkout — place the order + create a PaymentIntent. */
export interface ShopCheckoutBody {
    items: ShopCheckoutLine[];
    customerEmail: string;
    customerName?: string | null;
    shippingAddress?: ShopAddress | null;
    billingAddress?: ShopAddress | null;
    /** The shipping method the buyer selected (from the preview options).
     *  A record chooses per fulfilment group; a bare string applies to all. */
    shippingMethod?: string | Record<string, string>;
}

/** POST /shop/checkout — the PaymentIntent client secret + order refs. */
export interface ShopCheckoutResponse {
    clientSecret: string | null;
    orderId: string;
    orderNumber: string;
    /** The order's confirmation secret — append as `?k=` to the order page. */
    accessKey?: string;
    totalCents: number;
}

// ─── Orders ───────────────────────────────────────────────────────
// Role-shaped: user sees own (by user_id/email), admin sees all. Never
// cached. The by-number route is public (confirmation page) with a limited
// projection for anonymous callers.

/** Query accepted by GET /shop/orders. */
export interface ShopOrderListQuery {
    status?: string;
    /** Only the caller's own orders, even for an admin. */
    mine?: boolean;
    /** Admin: order number, buyer email or name (substring). */
    search?: string;
    /** Admin: only orders whose supplier hand-off needs a human. */
    attention?: boolean;
    /** Admin: placed on/after this ISO date. */
    from?: string;
    /** Admin: placed before this ISO date. */
    to?: string;
    page?: number;
    limit?: number;
}

/** GET /shop/orders — order rows (own/all). Page meta on the envelope. */
export type ShopOrderListResponse = ShopOrder[];

/** Params for the order-by-id family. */
export interface ShopOrderIdParams {
    id: string;
}

/** GET /shop/orders/:id — full order detail (order + items). */
export type ShopOrderResponse = ShopOrderDetail;

/** Params for GET /shop/orders/number/:orderNumber. */
export interface ShopOrderByNumberParams {
    orderNumber: string;
}

/**
 * Query for GET /shop/orders/number/:orderNumber (and the receipt). Without
 * the order's access key (or a signed-in owner / admin) the buyer's name,
 * email and digital download tokens are withheld.
 */
export interface ShopOrderByNumberQuery {
    k?: string;
}

/** GET /shop/orders/number/:orderNumber — the confirmation detail. */
export type ShopOrderByNumberResponse = ShopOrderDetail;

/** Body for PATCH /shop/orders/:id (admin). */
export interface ShopOrderUpdateBody {
    status?: ShopOrderStatus;
    fulfillmentStatus?: ShopFulfillmentStatus;
    trackingNumber?: string | null;
    /** Carrier code / name (e.g. `USPS`, `ONTRAC`). */
    carrier?: string | null;
    /** A tracking link that overrides the supplier's and the carrier template. */
    trackingUrl?: string | null;
    /**
     * Mark the order-level carrier / number / URL as typed by an admin, so a
     * supplier sync leaves them alone. Sending any of the three sets it to true
     * unless given; send `false` to hand them back to the supplier sync.
     */
    trackingManual?: boolean;
    notes?: string | null;
    /** When true AND the status changes, email the buyer about the update. */
    notifyCustomer?: boolean;
}

/** PATCH /shop/orders/:id — the updated order detail. */
export type ShopOrderUpdateResponse = ShopOrderDetail;

/** POST /shop/orders/:id/resend-receipt — confirmation message. */
export interface ShopOrderResendReceiptResponse {
    message: string;
}

/** Params for GET /shop/orders/:orderNumber/download/:token. */
export interface ShopOrderDownloadParams {
    orderNumber: string;
    token: string;
}

/** GET /shop/orders/:orderNumber/download/:token — the resolved file URL. */
export interface ShopOrderDownloadResponse {
    url: string;
}

// ─── Settings ─────────────────────────────────────────────────────
// Two `site_settings` JSONB rows (shop_settings + shop_appearance). The
// public GET emits a storefront-safe projection (no Stripe secret keys,
// no business address); the admin GET/PUT carry the full config.

/** GET /shop/settings — storefront-safe projection (public/optional). */
export interface ShopSettingsPublicResponse {
    settings: ShopPublicSettings;
    appearance: ShopAppearance;
}

/** GET /shop/settings/admin — full config (admin). */
export interface ShopSettingsAdminResponse {
    settings: ShopSettings;
    appearance: ShopAppearance;
}

/** Body for PUT /shop/settings (admin) — merge partial into either row. */
export interface ShopSettingsUpdateBody {
    settings?: Partial<ShopSettings>;
    appearance?: Partial<ShopAppearance>;
}

/** PUT /shop/settings — the updated full config. */
export type ShopSettingsUpdateResponse = ShopSettingsAdminResponse;

/** Query for GET /shop/settings/stripe-status. */
export interface ShopStripeStatusQuery {
    /** Bypass the short-lived cache and re-check Stripe now. */
    refresh?: boolean;
}

/**
 * GET /shop/settings/stripe-status — Stripe connection health for the admin.
 * Derived from a live Stripe API check (cached ~60s). No secret keys; only
 * booleans + public account metadata.
 */
export interface ShopStripeStatusResponse {
    /** A Stripe secret key is present in the environment. */
    configured: boolean;
    /** The Stripe API was reachable and the key is valid. */
    connected: boolean;
    /** The account can accept charges right now. */
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    /** 'test' | 'live' from the secret-key prefix. */
    mode: 'test' | 'live' | null;
    accountId: string | null;
    displayName: string | null;
    country: string | null;
    defaultCurrency: string | null;
    /** A webhook signing secret is configured (fulfillment depends on it). */
    webhookConfigured: boolean;
    /** The browser publishable key is configured server-side. */
    publishableKeyConfigured: boolean;
    /** Error message when connected=false. */
    error: string | null;
    /** ISO timestamp the status was computed. */
    checkedAt: string;
}

// Stripe key management moved to the generic, context-aware DTOs in
// `settings.ts` (PaymentCredentialsResponse / PaymentCredentialsUpdateBody).
// The Shop panel uses those with context='shop'.

// ─── Supplier order reconcile (Printify) ─────────────────────────────

/** One of our orders touched by a supplier order reconcile. */
export interface ShopProviderOrderReconcileItem {
    orderNumber: string;
    externalOrderId: string;
    /** Our fulfilment status for this supplier: pending | on_hold |
     *  in_production | partially_shipped | shipped | delivered | cancelled. */
    status: string;
    /** The supplier's own status word (e.g. Printify `fulfilled`). */
    externalStatus: string;
    /** The order's status after the roll-up (paid / processing / shipped / delivered …). */
    orderStatus: string;
    /** How the supplier order was matched to ours. */
    matchedBy: 'id' | 'external_id' | 'label';
    /** True when this run newly linked the supplier order to ours. */
    linked: boolean;
    /** True when anything was written for this order. */
    changed: boolean;
    trackingNumbers: string[];
}

/** A buyer email the reconcile WOULD have sent (switch off), or did send. */
export interface ShopProviderCustomerEmail {
    orderNumber: string;
    to: string;
    /** The order status the email announces (shipped / delivered). */
    orderStatus: string;
    subject: string;
    trackingNumber: string | null;
}

/** Result of reconciling one supplier's orders with ours. */
export interface ShopProviderOrderReconcileResult {
    provider: string;
    /** Supplier orders examined. */
    checked: number;
    /** Supplier orders that are ours. */
    matched: number;
    /** Newly linked this run. */
    linked: number;
    /** Ours that changed this run. */
    updated: number;
    /** Supplier orders that are not ours (manual / sample / another store). */
    foreign: number;
    /** Count of CHANGED orders by their new fulfilment status. */
    statusCounts: Record<string, number>;
    orders: ShopProviderOrderReconcileItem[];
    /** Buyer shipping emails held back because sending from the sync is off. */
    customerEmailsNotSent: ShopProviderCustomerEmail[];
    customerEmailsSent: number;
    errors: string[];
    durationMs: number;
}
