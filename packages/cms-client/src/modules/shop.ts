import type {
    Paginated,
    ShopCheckoutBody,
    ShopCheckoutPreviewBody,
    ShopCheckoutPreviewResponse,
    ShopCheckoutResponse,
    ShopOrderByNumberResponse,
    ShopOrderListQuery,
    ShopOrderListResponse,
    ShopOrderResendReceiptResponse,
    ShopOrderResponse,
    ShopOrderUpdateBody,
    ShopOrderUpdateResponse,
    ShopCategoryBySlugResponse,
    ShopCategoryCreateBody,
    ShopCategoryCreateResponse,
    ShopCategoryDeleteResponse,
    ShopCategoryListResponse,
    ShopCategoryUpdateBody,
    ShopCategoryUpdateResponse,
    ShopCollectionBySlugResponse,
    ShopCollectionCreateBody,
    ShopCollectionCreateResponse,
    ShopCollectionDeleteResponse,
    ShopCollectionListQuery,
    ShopCollectionListResponse,
    ShopCollectionUpdateBody,
    ShopCollectionUpdateResponse,
    ShopProductBulkBody,
    ShopProductBulkResponse,
    ShopProductByIdResponse,
    ShopProductBySlugResponse,
    ShopProductCreateBody,
    ShopProductCreateResponse,
    ShopProductDeleteResponse,
    ShopProductListQuery,
    ShopProductListResponse,
    ShopProductUpdateBody,
    ShopProductUpdateResponse,
    ShopReviewAdminListQuery,
    ShopReviewAdminListResponse,
    ShopReviewCreateBody,
    ShopReviewCreateResponse,
    ShopReviewDeleteResponse,
    ShopReviewHelpfulResponse,
    ShopReviewHelpfulMineResponse,
    ShopReviewListQuery,
    ShopReviewListResponse,
    ShopReviewModerateBody,
    ShopReviewModerateResponse,
    ShopSettingsAdminResponse,
    ShopSettingsPublicResponse,
    ShopSettingsUpdateBody,
    ShopSettingsUpdateResponse,
    ShopStripeStatusResponse,
    ShopTagListResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /shop namespace — the shop feature (mounted at /api/v1/shop, 404s when
 * the feature is disabled). Exposed as grouped sub-objects assigned in the
 * constructor: `cms.shop.products`, `.categories`, `.collections`, `.tags`.
 * Paginated product lists return `Paginated<T>`; single reads return the
 * entity/detail directly. Later phases add `.reviews`, `.orders`,
 * `.checkout`, `.settings`.
 */
export class ShopModule extends ModuleBase {
    protected readonly module = 'shop';

    /** Products — catalog entries with nested options/variants/media. */
    readonly products = {
        /** GET /shop/products — public active-only, paginated. */
        listPublic: (query?: ShopProductListQuery,): Promise<Paginated<ShopProductListResponse[number]>> =>
            this.getPaged<ShopProductListResponse[number]>('/shop/products', { query: query as Record<string, unknown>, },),

        /** GET /shop/products (admin) — passes all=true for the all-statuses list. */
        list: (query?: ShopProductListQuery,): Promise<Paginated<ShopProductListResponse[number]>> =>
            this.getPaged<ShopProductListResponse[number]>('/shop/products', { query: { all: true, ...(query as Record<string, unknown>), }, },),

        /** GET /shop/products/slug/:slug — full nested detail (public active-only). */
        getBySlug: (slug: string, preview?: 'admin',): Promise<ShopProductBySlugResponse> =>
            this.get<ShopProductBySlugResponse>('/shop/products/slug/:slug', {
                params: { slug, }, query: preview ? { preview, } : undefined,
            },),

        /** GET /shop/products/:id (admin) — full nested detail, any status. */
        getById: (id: string,): Promise<ShopProductByIdResponse> =>
            this.get<ShopProductByIdResponse>('/shop/products/:id', { params: { id, }, },),

        create: (body: ShopProductCreateBody,): Promise<ShopProductCreateResponse> =>
            this.mutate<ShopProductCreateResponse>('POST', '/shop/products', { body, invalidates: ['shop',], },),

        update: (id: string, body: ShopProductUpdateBody,): Promise<ShopProductUpdateResponse> =>
            this.mutate<ShopProductUpdateResponse>('PUT', '/shop/products/:id', { params: { id, }, body, invalidates: ['shop',], },),

        remove: (id: string,): Promise<ShopProductDeleteResponse> =>
            this.mutate<ShopProductDeleteResponse>('DELETE', '/shop/products/:id', { params: { id, }, invalidates: ['shop',], },),

        bulk: (body: ShopProductBulkBody,): Promise<ShopProductBulkResponse> =>
            this.mutate<ShopProductBulkResponse>('POST', '/shop/products/bulk', { body, invalidates: ['shop',], },),
    };

    /** Categories — hierarchical taxonomy (tree assembled via parentId). */
    readonly categories = {
        list: (): Promise<ShopCategoryListResponse> =>
            this.get<ShopCategoryListResponse>('/shop/categories',),

        getBySlug: (slug: string,): Promise<ShopCategoryBySlugResponse> =>
            this.get<ShopCategoryBySlugResponse>('/shop/categories/slug/:slug', { params: { slug, }, },),

        create: (body: ShopCategoryCreateBody,): Promise<ShopCategoryCreateResponse> =>
            this.mutate<ShopCategoryCreateResponse>('POST', '/shop/categories', { body, invalidates: ['shop',], },),

        update: (id: string, body: ShopCategoryUpdateBody,): Promise<ShopCategoryUpdateResponse> =>
            this.mutate<ShopCategoryUpdateResponse>('PUT', '/shop/categories/:id', { params: { id, }, body, invalidates: ['shop',], },),

        remove: (id: string,): Promise<ShopCategoryDeleteResponse> =>
            this.mutate<ShopCategoryDeleteResponse>('DELETE', '/shop/categories/:id', { params: { id, }, invalidates: ['shop',], },),
    };

    /** Collections — curated product groupings. */
    readonly collections = {
        /** GET /shop/collections — public published-only; pass all=true for admin. */
        list: (query?: ShopCollectionListQuery,): Promise<ShopCollectionListResponse> =>
            this.get<ShopCollectionListResponse>('/shop/collections', { query: query as Record<string, unknown>, },),

        getBySlug: (slug: string,): Promise<ShopCollectionBySlugResponse> =>
            this.get<ShopCollectionBySlugResponse>('/shop/collections/slug/:slug', { params: { slug, }, },),

        create: (body: ShopCollectionCreateBody,): Promise<ShopCollectionCreateResponse> =>
            this.mutate<ShopCollectionCreateResponse>('POST', '/shop/collections', { body, invalidates: ['shop',], },),

        update: (id: string, body: ShopCollectionUpdateBody,): Promise<ShopCollectionUpdateResponse> =>
            this.mutate<ShopCollectionUpdateResponse>('PUT', '/shop/collections/:id', { params: { id, }, body, invalidates: ['shop',], },),

        remove: (id: string,): Promise<ShopCollectionDeleteResponse> =>
            this.mutate<ShopCollectionDeleteResponse>('DELETE', '/shop/collections/:id', { params: { id, }, invalidates: ['shop',], },),
    };

    /** Tags — distinct product tag list. */
    readonly tags = {
        list: (): Promise<ShopTagListResponse> => this.get<ShopTagListResponse>('/shop/tags',),
    };

    /** Reviews — product reviews + ratings with moderation. Public list is
     *  approved-only; admin list is the any-status moderation queue. */
    readonly reviews = {
        /** GET /shop/products/:productId/reviews — approved, paginated. */
        list: (productId: string, params?: ShopReviewListQuery,): Promise<Paginated<ShopReviewListResponse[number]>> =>
            this.getPaged<ShopReviewListResponse[number]>('/shop/products/:productId/reviews', {
                params: { productId, }, query: params as Record<string, unknown>,
            },),

        /** POST /shop/products/:productId/reviews (user tier) — creates a pending review. */
        create: (productId: string, body: ShopReviewCreateBody,): Promise<ShopReviewCreateResponse> =>
            this.mutate<ShopReviewCreateResponse>('POST', '/shop/products/:productId/reviews', {
                params: { productId, }, body, invalidates: ['shop',],
            },),

        /** POST /shop/reviews/:id/helpful — toggle the current user/IP's helpful mark. */
        toggleHelpful: (reviewId: string,): Promise<ShopReviewHelpfulResponse> =>
            this.mutate<ShopReviewHelpfulResponse>('POST', '/shop/reviews/:id/helpful', {
                params: { id: reviewId, }, invalidates: ['shop',],
            },),

        /** GET /shop/products/:productId/reviews/helpful-mine — review ids the
         *  current user/IP has marked helpful. */
        helpfulMine: (productId: string,): Promise<ShopReviewHelpfulMineResponse> =>
            this.get<ShopReviewHelpfulMineResponse>('/shop/products/:productId/reviews/helpful-mine', {
                params: { productId, },
            },),

        /** GET /shop/reviews (admin) — any-status moderation queue. */
        adminList: (params?: ShopReviewAdminListQuery,): Promise<Paginated<ShopReviewAdminListResponse[number]>> =>
            this.getPaged<ShopReviewAdminListResponse[number]>('/shop/reviews', { query: params as Record<string, unknown>, },),

        /** PUT /shop/reviews/:id (admin) — approve/reject; recomputes rating. */
        moderate: (reviewId: string, body: ShopReviewModerateBody,): Promise<ShopReviewModerateResponse> =>
            this.mutate<ShopReviewModerateResponse>('PUT', '/shop/reviews/:id', {
                params: { id: reviewId, }, body, invalidates: ['shop',],
            },),

        /** DELETE /shop/reviews/:id (admin). */
        remove: (reviewId: string,): Promise<ShopReviewDeleteResponse> =>
            this.mutate<ShopReviewDeleteResponse>('DELETE', '/shop/reviews/:id', {
                params: { id: reviewId, }, invalidates: ['shop',],
            },),
    };

    /** Checkout — the on-site Stripe flow. `preview` prices a cart without
     *  creating an order; `create` places the order + returns the
     *  PaymentIntent client secret for Elements. */
    readonly checkout = {
        /** POST /shop/checkout/preview — live totals (no order created). */
        preview: (body: ShopCheckoutPreviewBody,): Promise<ShopCheckoutPreviewResponse> =>
            this.mutate<ShopCheckoutPreviewResponse>('POST', '/shop/checkout/preview', { body, },),

        /** POST /shop/checkout — place the order; returns { clientSecret, orderId, orderNumber, totalCents }. */
        create: (body: ShopCheckoutBody,): Promise<ShopCheckoutResponse> =>
            this.mutate<ShopCheckoutResponse>('POST', '/shop/checkout', { body, invalidates: ['shop',], },),
    };

    /** Orders — role-shaped: users see own, admins see all. Never cached. */
    readonly orders = {
        /** GET /shop/orders — own (user) / all (admin), paginated. */
        list: (query?: ShopOrderListQuery,): Promise<Paginated<ShopOrderListResponse[number]>> =>
            this.getPaged<ShopOrderListResponse[number]>('/shop/orders', { query: query as Record<string, unknown>, },),

        /** GET /shop/orders/:id — full order detail. */
        get: (id: string,): Promise<ShopOrderResponse> =>
            this.get<ShopOrderResponse>('/shop/orders/:id', { params: { id, }, },),

        /** GET /shop/orders/number/:orderNumber — confirmation-page detail. */
        getByNumber: (orderNumber: string,): Promise<ShopOrderByNumberResponse> =>
            this.get<ShopOrderByNumberResponse>('/shop/orders/number/:orderNumber', { params: { orderNumber, }, },),

        /** PATCH /shop/orders/:id (admin) — status/fulfillment/tracking/notes/refund. */
        update: (id: string, body: ShopOrderUpdateBody,): Promise<ShopOrderUpdateResponse> =>
            this.mutate<ShopOrderUpdateResponse>('PATCH', '/shop/orders/:id', {
                params: { id, }, body, invalidates: ['shop',],
            },),

        /** POST /shop/orders/:id/resend-receipt (admin). */
        resendReceipt: (id: string,): Promise<ShopOrderResendReceiptResponse> =>
            this.mutate<ShopOrderResendReceiptResponse>('POST', '/shop/orders/:id/resend-receipt', {
                params: { id, },
            },),

        /** GET /shop/orders/:orderNumber/download/:token — token-gated digital
         *  download; returns the resolved file URL. */
        downloadUrl: (orderNumber: string, token: string,): Promise<{ url: string; }> =>
            this.get<{ url: string; }>('/shop/orders/:orderNumber/download/:token', {
                params: { orderNumber, token, },
            },),
    };

    /** Settings — the shop config + appearance (two site_settings rows).
     *  `getPublic` is the storefront-safe projection (no secret keys);
     *  `getAdmin`/`update` carry the full config (admin only). */
    readonly settings = {
        /** GET /shop/settings — storefront-safe projection (public). */
        getPublic: (): Promise<ShopSettingsPublicResponse> =>
            this.get<ShopSettingsPublicResponse>('/shop/settings',),

        /** GET /shop/settings/admin — full config (admin). */
        getAdmin: (): Promise<ShopSettingsAdminResponse> =>
            this.get<ShopSettingsAdminResponse>('/shop/settings/admin',),

        /** GET /shop/settings/stripe-status — live (cached ~60s) Stripe
         *  connection status. Pass refresh=true to force a re-check. */
        stripeStatus: (refresh?: boolean,): Promise<ShopStripeStatusResponse> =>
            this.get<ShopStripeStatusResponse>('/shop/settings/stripe-status', {
                query: refresh ? { refresh: true, } : undefined,
            },),

        /** PUT /shop/settings (admin) — merge partial; returns full config. */
        update: (body: ShopSettingsUpdateBody,): Promise<ShopSettingsUpdateResponse> =>
            this.mutate<ShopSettingsUpdateResponse>('PUT', '/shop/settings', { body, invalidates: ['shop',], },),
    };

    /** Printify (POD) — sync the catalog + read integration status (admin).
     *  Credentials come from the printify plugin's config. */
    readonly printify = {
        /** GET /shop/printify/status — enabled, product counts, last sync. */
        status: (): Promise<PrintifyStatusResponse> =>
            this.get<PrintifyStatusResponse>('/shop/printify/status',),

        /** POST /shop/printify/sync — pull the latest products into the shop. */
        sync: (): Promise<PrintifySyncResponse> =>
            this.mutate<PrintifySyncResponse>('POST', '/shop/printify/sync', { invalidates: ['shop',], },),
    };
}

/** GET /shop/printify/status */
export interface PrintifyStatusResponse {
    active: boolean;
    productCount: number;
    activeProductCount: number;
    lastSyncedAt: string | null;
    shopId: string | null;
    syncIntervalMinutes: number | null;
}

/** POST /shop/printify/sync */
export interface PrintifySyncResponse {
    ok: boolean;
    fetched: number;
    upserted: number;
    archived: number;
    skipped: number;
    errors: string[];
    durationMs: number;
}
