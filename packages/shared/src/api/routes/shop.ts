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
    ShopCategory,
    ShopCollection,
    ShopFulfillmentStatus,
    ShopOrder,
    ShopOrderDetail,
    ShopOrderStatus,
    ShopProduct,
    ShopProductDetail,
    ShopProductType,
    ShopReview,
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
    weightGrams?: number | null;
    requiresShipping?: boolean;
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
    imageId?: string | null;
    position?: number;
    isDefault?: boolean;
}

/** A product-media assignment, as sent in a product write. */
export interface ShopMediaInput {
    mediaId: string;
    variantId?: string | null;
    position?: number;
    kind?: 'image' | 'video';
}

// ─── GET /shop/products ───────────────────────────────────────────

/** Query accepted by GET /shop/products. */
export interface ShopProductListQuery {
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
    metaDescription?: string | null;
    options?: ShopOptionInput[];
    variants?: ShopVariantInput[];
    media?: ShopMediaInput[];
    categoryIds?: string[];
    collectionIds?: string[];
    tags?: string[];
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
    helpfulCount: number;
}

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
    variantId: string;
    qty: number;
}

/** Body for POST /shop/checkout/preview — validate + price WITHOUT
 *  creating an order (live checkout-page total). */
export interface ShopCheckoutPreviewBody {
    items: ShopCheckoutLine[];
    shippingAddress?: ShopAddress | null;
}

/** Server-computed totals (cents). */
export interface ShopCheckoutTotals {
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
    currency: string;
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
}

/** POST /shop/checkout — the PaymentIntent client secret + order refs. */
export interface ShopCheckoutResponse {
    clientSecret: string | null;
    orderId: string;
    orderNumber: string;
    totalCents: number;
}

// ─── Orders ───────────────────────────────────────────────────────
// Role-shaped: user sees own (by user_id/email), admin sees all. Never
// cached. The by-number route is public (confirmation page) with a limited
// projection for anonymous callers.

/** Query accepted by GET /shop/orders. */
export interface ShopOrderListQuery {
    status?: string;
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

/** GET /shop/orders/number/:orderNumber — the confirmation detail. */
export type ShopOrderByNumberResponse = ShopOrderDetail;

/** Body for PATCH /shop/orders/:id (admin). */
export interface ShopOrderUpdateBody {
    status?: ShopOrderStatus;
    fulfillmentStatus?: ShopFulfillmentStatus;
    trackingNumber?: string | null;
    notes?: string | null;
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
