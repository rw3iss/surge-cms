import type {
    Paginated,
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
    ShopReviewListQuery,
    ShopReviewListResponse,
    ShopReviewModerateBody,
    ShopReviewModerateResponse,
    ShopTagListResponse,
} from '@rw/cms-shared';
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

        /** POST /shop/reviews/:id/helpful — increment helpful count. */
        markHelpful: (reviewId: string,): Promise<ShopReviewHelpfulResponse> =>
            this.mutate<ShopReviewHelpfulResponse>('POST', '/shop/reviews/:id/helpful', {
                params: { id: reviewId, }, invalidates: ['shop',],
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
}
