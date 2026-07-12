import { z, } from 'zod';
import type {
    AssertCompatible,
    ShopCategoryCreateBody,
    ShopCheckoutBody,
    ShopCheckoutPreviewBody,
    ShopCollectionCreateBody,
    ShopCollectionListQuery,
    ShopOrderListQuery,
    ShopOrderUpdateBody,
    ShopProductBySlugQuery,
    ShopProductCreateBody,
    ShopProductListQuery,
    ShopReviewAdminListQuery,
    ShopReviewCreateBody,
    ShopReviewListQuery,
    ShopReviewModerateBody,
    ShopSettingsUpdateBody,
} from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import { isAdminRole, } from '../api/roles';
import { NotFoundError, } from '../core/errors';
import * as catalog from '../services/shop/catalog';
import * as checkout from '../services/shop/checkout';
import * as orders from '../services/shop/orders';
import * as products from '../services/shop/products';
import * as reviews from '../services/shop/reviews';
import * as shopSettings from '../services/shop/settings';
import * as stripeStatus from '../services/shop/stripeStatus';

// ─── Schemas ──────────────────────────────────────────────────────

const optionInputSchema = z.object({
    name: z.string().min(1,).max(100,),
    position: z.number().int().optional(),
    values: z.array(z.object({
        value: z.string().min(1,).max(255,),
        position: z.number().int().optional(),
    },),),
},);

const variantInputSchema = z.object({
    sku: z.string().max(100,).nullish(),
    priceCents: z.number().int().min(0,),
    compareAtPriceCents: z.number().int().min(0,).nullish(),
    inventoryQty: z.number().int().optional(),
    weightGrams: z.number().int().nullish(),
    requiresShipping: z.boolean().optional(),
    option1: z.string().max(255,).nullish(),
    option2: z.string().max(255,).nullish(),
    option3: z.string().max(255,).nullish(),
    imageId: z.string().nullish(),
    position: z.number().int().optional(),
    isDefault: z.boolean().optional(),
},);

const mediaInputSchema = z.object({
    mediaId: z.string(),
    variantId: z.string().nullish(),
    position: z.number().int().optional(),
    kind: z.enum(['image', 'video',],).optional(),
},);

const productSchema = z.object({
    title: z.string().min(1,).max(255,),
    slug: z.string().min(1,).max(255,).regex(/^[a-z0-9-]+$/,),
    description: z.string().nullish(),
    type: z.enum(['physical', 'digital',],).optional(),
    status: z.enum(['draft', 'active', 'archived',],).optional(),
    metaTitle: z.string().max(255,).nullish(),
    metaDescription: z.string().nullish(),
    options: z.array(optionInputSchema,).optional(),
    variants: z.array(variantInputSchema,).optional(),
    media: z.array(mediaInputSchema,).optional(),
    categoryIds: z.array(z.string(),).optional(),
    collectionIds: z.array(z.string(),).optional(),
    tags: z.array(z.string(),).optional(),
},) satisfies z.ZodType<ShopProductCreateBody>;

const productListQuery = z.object({
    search: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.string().optional(),
    all: z.string().optional(),
    status: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(20,),
},);

const productSlugParams = z.object({ slug: z.string(), },);
const productSlugQuery = z.object({ preview: z.string().optional(), },);
const idParams = z.object({ id: z.string(), },);
const slugParams = z.object({ slug: z.string(), },);

const categorySchema = z.object({
    name: z.string().min(1,).max(255,),
    slug: z.string().min(1,).max(255,).regex(/^[a-z0-9-]+$/,),
    parentId: z.string().nullish(),
    description: z.string().nullish(),
    imageId: z.string().nullish(),
    position: z.number().int().optional(),
},) satisfies z.ZodType<ShopCategoryCreateBody>;

const collectionSchema = z.object({
    title: z.string().min(1,).max(255,),
    slug: z.string().min(1,).max(255,).regex(/^[a-z0-9-]+$/,),
    description: z.string().nullish(),
    imageId: z.string().nullish(),
    position: z.number().int().optional(),
    isPublished: z.boolean().optional(),
    productIds: z.array(z.string(),).optional(),
},) satisfies z.ZodType<ShopCollectionCreateBody>;

const collectionListQuery = z.object({ all: z.string().optional(), },);

// refresh travels as the string 'true'; the handler compares === 'true'.
const stripeStatusQuery = z.object({ refresh: z.string().optional(), },);

// ── Reviews ──

const reviewProductParams = z.object({ productId: z.string(), },);

const reviewListQuery = z.object({
    sort: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(20,),
},);

const reviewCreateSchema = z.object({
    rating: z.number().int().min(1,).max(5,),
    title: z.string().max(255,).optional(),
    body: z.string().optional(),
},) satisfies z.ZodType<ShopReviewCreateBody>;

const reviewAdminListQuery = z.object({
    status: z.enum(['pending', 'approved', 'rejected',],).optional(),
    productId: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(20,),
},);

const reviewModerateSchema = z.object({
    status: z.enum(['approved', 'rejected',],),
},) satisfies z.ZodType<ShopReviewModerateBody>;

// ── Checkout / orders ──

const addressSchema = z.object({
    name: z.string().optional(),
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().optional(),
    phone: z.string().optional(),
},);

const checkoutLineSchema = z.object({
    variantId: z.string(),
    qty: z.number().int().min(1,),
},);

const checkoutPreviewSchema = z.object({
    items: z.array(checkoutLineSchema,),
    shippingAddress: addressSchema.nullish(),
},) satisfies z.ZodType<ShopCheckoutPreviewBody>;

const checkoutSchema = z.object({
    items: z.array(checkoutLineSchema,),
    customerEmail: z.string().email(),
    customerName: z.string().nullish(),
    shippingAddress: addressSchema.nullish(),
    billingAddress: addressSchema.nullish(),
},) satisfies z.ZodType<ShopCheckoutBody>;

const orderListQuery = z.object({
    status: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(20,),
},);

const orderNumberParams = z.object({ orderNumber: z.string(), },);
const downloadParams = z.object({ orderNumber: z.string(), token: z.string(), },);

const orderUpdateSchema = z.object({
    status: z.enum(['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded',],).optional(),
    fulfillmentStatus: z.enum(['unfulfilled', 'partial', 'fulfilled',],).optional(),
    trackingNumber: z.string().nullish(),
    notes: z.string().nullish(),
    notifyCustomer: z.boolean().optional(),
},) satisfies z.ZodType<ShopOrderUpdateBody>;

// ── Settings ──

const shopSettingsPatch = z.object({
    currency: z.string().length(3,).optional(),
    taxEnabled: z.boolean().optional(),
    businessName: z.string().optional(),
    businessAddress: z.string().optional(),
    storeEnabled: z.boolean().optional(),
    stripeTaxEnabled: z.boolean().optional(),
    shipping: z.object({
        flatCents: z.number().int().min(0,).optional(),
        freeThresholdCents: z.number().int().min(0,).optional(),
        rates: z.array(z.object({
            name: z.string(),
            priceCents: z.number().int().min(0,),
        },),).optional(),
    },).optional(),
},);

const shopAppearancePatch = z.object({
    gridColumns: z.number().int().min(1,).max(6,).optional(),
    showRatings: z.boolean().optional(),
    cardStyle: z.string().optional(),
    currencyDisplay: z.string().optional(),
},);

const shopSettingsUpdateSchema = z.object({
    settings: shopSettingsPatch.optional(),
    appearance: shopAppearancePatch.optional(),
},) satisfies z.ZodType<ShopSettingsUpdateBody>;

// Query schemas coerce (string → number), so assert z.infer compatibility.
type _AssertProductListQuery = AssertCompatible<z.infer<typeof productListQuery>, ShopProductListQuery>;
type _AssertProductSlugQuery = AssertCompatible<z.infer<typeof productSlugQuery>, ShopProductBySlugQuery>;
type _AssertCollectionListQuery = AssertCompatible<z.infer<typeof collectionListQuery>, ShopCollectionListQuery>;
type _AssertReviewListQuery = AssertCompatible<z.infer<typeof reviewListQuery>, ShopReviewListQuery>;
type _AssertReviewAdminListQuery = AssertCompatible<z.infer<typeof reviewAdminListQuery>, ShopReviewAdminListQuery>;
type _AssertOrderListQuery = AssertCompatible<z.infer<typeof orderListQuery>, ShopOrderListQuery>;

// ─── Routes ───────────────────────────────────────────────────────
// Literal paths (/products/slug/:slug, /products/bulk, /categories/*,
// /collections/*, /tags) declared before the /products/:id catch-all.
// The whole module 404s when the `shop` feature is disabled (guard
// applied at the registerModule mount).

export const shopRoutes = [

    // ── Products ──

    // List products. Public active-only array by default; admins passing
    // all=true (or status) get the paginated all-statuses list.
    defineRoute({
        method: 'get', path: '/products', auth: 'optional',
        summary: 'List products. Public active-only by default; admins passing all=true/status get the paginated admin list.',
        input: { query: productListQuery, },
        handler: async ({ user, apiKey, query, },) => {
            const isAdmin = isAdminRole(user?.role,) || Boolean(apiKey,);

            if (isAdmin && (query.all === 'true' || query.status !== undefined)) {
                const result = await products.list(
                    { status: query.status, search: query.search, sortBy: query.sortBy, sortOrder: query.sortOrder, },
                    { page: query.page, limit: query.limit, },
                );
                return reply(result.data, { meta: result.meta, },);
            }

            // Anonymous / non-admin → active-only, cache-safe.
            const result = await products.listPublicCached(
                { search: query.search, sortBy: query.sortBy, sortOrder: query.sortOrder, },
                { page: query.page, limit: query.limit, },
            );
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    // Public product by slug (active-only, cached). Admins may pass
    // preview=admin to get the any-status detail.
    defineRoute({
        method: 'get', path: '/products/slug/:slug', auth: 'optional',
        summary: 'Fetch a product by slug with full nested detail. Public active-only; admins can preview=admin for any status.',
        input: { params: productSlugParams, query: productSlugQuery, },
        handler: async ({ params, query, user, apiKey, },) => {
            const isAdmin = isAdminRole(user?.role,) || Boolean(apiKey,);
            if (isAdmin && query.preview === 'admin') {
                const preview = await products.getBySlugAnyStatus(params.slug,);
                if (!preview) throw new NotFoundError('Product',);
                return preview;
            }
            const product = await products.getPublicBySlugCached(params.slug,);
            if (!product) throw new NotFoundError('Product',);
            return product;
        },
    },),

    // Bulk actions (admin).
    defineRoute({
        method: 'post', path: '/products/bulk', auth: 'admin',
        summary: 'Bulk status change / delete products by id list.',
        handler: ({ body, },) => products.bulk(body,),
    },),

    // Fetch product by id (admin, any status, full detail).
    defineRoute({
        method: 'get', path: '/products/:id', auth: 'admin',
        summary: 'Fetch a product by id with full nested detail (any status).',
        input: { params: idParams, },
        handler: async ({ params, },) => {
            const product = await products.getDetailById(params.id,);
            if (!product) throw new NotFoundError('Product',);
            return product;
        },
    },),

    // Create product (admin) + structure.
    defineRoute({
        method: 'post', path: '/products', auth: 'admin',
        summary: 'Create a product with its options/variants/media/taxonomy.',
        input: { body: productSchema, },
        handler: async ({ body, audit, },) => {
            const product = await products.create(body, audit(),);
            return reply(product, { status: 201, },);
        },
    },),

    // Update product (admin) + structure.
    defineRoute({
        method: 'put', path: '/products/:id', auth: 'admin',
        summary: 'Update a product and (when supplied) its structure/taxonomy.',
        input: { params: idParams, body: productSchema.partial(), },
        handler: ({ params, body, audit, },) => products.update(params.id, body, audit(),),
    },),

    // Delete product (admin).
    defineRoute({
        method: 'delete', path: '/products/:id', auth: 'admin',
        summary: 'Delete a product.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await products.remove(params.id, audit(),);
            return { message: 'Product deleted', };
        },
    },),

    // ── Categories ──

    defineRoute({
        method: 'get', path: '/categories', auth: 'public',
        summary: 'List all categories (flat; tree via parentId).',
        handler: () => catalog.listCategoriesCached(),
    },),

    defineRoute({
        method: 'get', path: '/categories/slug/:slug', auth: 'public',
        summary: 'Fetch a category by slug with its active products.',
        input: { params: slugParams, },
        handler: async ({ params, },) => {
            const category = await catalog.getCategoryBySlug(params.slug,);
            if (!category) throw new NotFoundError('Category',);
            const productsInCat = await catalog.productsInCategory(category.id,);
            return { category, products: productsInCat, };
        },
    },),

    defineRoute({
        method: 'post', path: '/categories', auth: 'admin',
        summary: 'Create a category.',
        input: { body: categorySchema, },
        handler: async ({ body, audit, },) => {
            const category = await catalog.createCategory(body, audit(),);
            return reply(category, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/categories/:id', auth: 'admin',
        summary: 'Update a category.',
        input: { params: idParams, body: categorySchema.partial(), },
        handler: ({ params, body, audit, },) => catalog.updateCategory(params.id, body, audit(),),
    },),

    defineRoute({
        method: 'delete', path: '/categories/:id', auth: 'admin',
        summary: 'Delete a category.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await catalog.removeCategory(params.id, audit(),);
            return { message: 'Category deleted', };
        },
    },),

    // ── Collections ──

    defineRoute({
        method: 'get', path: '/collections', auth: 'optional',
        summary: 'List collections. Public published-only; admins passing all=true get every collection.',
        input: { query: collectionListQuery, },
        handler: ({ query, user, apiKey, },) => {
            const isAdmin = isAdminRole(user?.role,) || Boolean(apiKey,);
            if (isAdmin && query.all === 'true') {
                return catalog.listCollectionsAdmin();
            }
            return catalog.listCollectionsPublicCached();
        },
    },),

    defineRoute({
        method: 'get', path: '/collections/slug/:slug', auth: 'public',
        summary: 'Fetch a collection by slug with its curated active products.',
        input: { params: slugParams, },
        handler: async ({ params, },) => {
            const collection = await catalog.getCollectionBySlug(params.slug,);
            if (!collection) throw new NotFoundError('Collection',);
            const productsInCol = await catalog.productsInCollection(collection.id,);
            return { collection, products: productsInCol, };
        },
    },),

    defineRoute({
        method: 'post', path: '/collections', auth: 'admin',
        summary: 'Create a collection (productIds set membership).',
        input: { body: collectionSchema, },
        handler: async ({ body, audit, },) => {
            const { productIds, ...fields } = body;
            const collection = await catalog.createCollection(fields, productIds, audit(),);
            return reply(collection, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/collections/:id', auth: 'admin',
        summary: 'Update a collection (productIds reset membership).',
        input: { params: idParams, body: collectionSchema.partial(), },
        handler: ({ params, body, audit, },) => {
            const { productIds, ...fields } = body;
            return catalog.updateCollection(params.id, fields, productIds, audit(),);
        },
    },),

    defineRoute({
        method: 'delete', path: '/collections/:id', auth: 'admin',
        summary: 'Delete a collection.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await catalog.removeCollection(params.id, audit(),);
            return { message: 'Collection deleted', };
        },
    },),

    // ── Tags ──

    defineRoute({
        method: 'get', path: '/tags', auth: 'public',
        summary: 'Distinct product tag list.',
        handler: () => catalog.listTagsCached(),
    },),

    // ── Reviews ──
    // Public list is approved-only → cache-safe for anonymous readers.
    // /products/:productId/reviews (3 segments) doesn't collide with the
    // /products/:id family; /reviews/:id/helpful before /reviews/:id.

    // List a product's approved reviews (public, cached, paginated).
    defineRoute({
        method: 'get', path: '/products/:productId/reviews', auth: 'optional',
        summary: 'List a product\'s approved reviews (public), paginated (newest or most-helpful).',
        input: { params: reviewProductParams, query: reviewListQuery, },
        handler: async ({ params, query, },) => {
            const result = await reviews.listPublic(
                params.productId, { page: query.page, limit: query.limit, }, query.sort,
            );
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    // Submit a review (logged-in user). Always created pending (moderated);
    // verified_purchase set from a real paid-order lookup.
    defineRoute({
        method: 'post', path: '/products/:productId/reviews', auth: 'user',
        summary: 'Submit a product review (user tier). Created pending for moderation.',
        input: { params: reviewProductParams, body: reviewCreateSchema, },
        handler: async ({ params, body, audit, },) => {
            const review = await reviews.create(
                { productId: params.productId, rating: body.rating, title: body.title, body: body.body, },
                audit(),
            );
            return reply(review, { status: 201, },);
        },
    },),

    // Mark a review helpful (public).
    defineRoute({
        method: 'post', path: '/reviews/:id/helpful', auth: 'optional',
        summary: 'Increment a review\'s helpful count.',
        input: { params: idParams, },
        handler: ({ params, },) => reviews.markHelpful(params.id,),
    },),

    // Moderation queue (admin, any status, filters).
    defineRoute({
        method: 'get', path: '/reviews', auth: 'admin',
        summary: 'List reviews for moderation (any status; filter by status/productId).',
        input: { query: reviewAdminListQuery, },
        handler: async ({ query, },) => {
            const result = await reviews.listAdmin(
                { status: query.status, productId: query.productId, },
                { page: query.page, limit: query.limit, },
            );
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    // Moderate a review (admin): approve/reject + recompute rating.
    defineRoute({
        method: 'put', path: '/reviews/:id', auth: 'admin',
        summary: 'Moderate a review (approve/reject); recomputes the product rating.',
        input: { params: idParams, body: reviewModerateSchema, },
        handler: ({ params, body, audit, },) => reviews.moderate(params.id, body.status, audit(),),
    },),

    // Delete a review (admin).
    defineRoute({
        method: 'delete', path: '/reviews/:id', auth: 'admin',
        summary: 'Delete a review; recomputes the product rating if it was approved.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await reviews.remove(params.id, audit(),);
            return { message: 'Review deleted', };
        },
    },),

    // ── Checkout ──
    // Literal /checkout* paths declared before the /orders/:id family so
    // they never collide. Both are `optional` (guest or logged-in).

    // Live-total preview — validate + price without creating an order.
    defineRoute({
        method: 'post', path: '/checkout/preview', auth: 'optional',
        summary: 'Preview checkout totals (subtotal/shipping/tax) without creating an order.',
        input: { body: checkoutPreviewSchema, },
        handler: ({ body, },) => checkout.previewCheckout(body,),
    },),

    // Place order → order(pending) + items + Stripe PaymentIntent.
    defineRoute({
        method: 'post', path: '/checkout', auth: 'optional',
        summary: 'Place an order: validate the cart, create a pending order + Stripe PaymentIntent, return the client secret.',
        input: { body: checkoutSchema, },
        handler: async ({ body, audit, },) => {
            const result = await checkout.createCheckout(body, audit(),);
            return reply(result, { status: 201, },);
        },
    },),

    // ── Orders ──
    // Literal /orders/number/:orderNumber before /orders/:id. The
    // download route (/orders/:orderNumber/download/:token, 4 segments)
    // never collides with /orders/:id.

    // List orders (auth required): user → own, admin → all. Paginated.
    defineRoute({
        method: 'get', path: '/orders', auth: 'user',
        summary: 'List orders. Regular users see their own (by user_id/email); admins see all. Paginated.',
        input: { query: orderListQuery, },
        handler: async ({ query, user, apiKey, },) => {
            const isAdmin = isAdminRole(user?.role,) || Boolean(apiKey,);
            const result = await orders.list(
                { status: query.status, },
                { isAdmin, userId: user?.id, email: user?.email, },
                { page: query.page, limit: query.limit, },
            );
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    // Public confirmation view by order number (limited projection for anon).
    defineRoute({
        method: 'get', path: '/orders/number/:orderNumber', auth: 'optional',
        summary: 'Fetch an order by its human order number (public confirmation view; limited fields for anonymous callers).',
        input: { params: orderNumberParams, },
        handler: async ({ params, user, apiKey, },) => {
            const isAdmin = isAdminRole(user?.role,) || Boolean(apiKey,);
            const order = await orders.getByNumber(params.orderNumber, isAdmin,);
            if (!order) throw new NotFoundError('Order',);
            return order;
        },
    },),

    // Token-gated digital download → resolved file URL (JSON).
    defineRoute({
        method: 'get', path: '/orders/:orderNumber/download/:token', auth: 'public',
        summary: 'Resolve a token-gated digital download to a file URL (public; unguessable token is the guard).',
        input: { params: downloadParams, },
        handler: ({ params, },) => orders.getDigitalDownload(params.orderNumber, params.token,),
    },),

    // Order detail by id: user → own, admin → any.
    defineRoute({
        method: 'get', path: '/orders/:id', auth: 'user',
        summary: 'Fetch an order by id with items. Users see their own; admins see any.',
        input: { params: idParams, },
        handler: ({ params, user, apiKey, },) => {
            const isAdmin = isAdminRole(user?.role,) || Boolean(apiKey,);
            return orders.get(params.id, { isAdmin, userId: user?.id, email: user?.email, },);
        },
    },),

    // Update order (admin): status/fulfillment/tracking/notes; refund on 'refunded'.
    defineRoute({
        method: 'patch', path: '/orders/:id', auth: 'admin',
        summary: 'Update an order (admin): status/fulfillment/tracking/notes. Transition to refunded issues a Stripe refund.',
        input: { params: idParams, body: orderUpdateSchema, },
        handler: ({ params, body, audit, },) => orders.update(params.id, body, audit(),),
    },),

    // Resend the receipt email (admin).
    defineRoute({
        method: 'post', path: '/orders/:id/resend-receipt', auth: 'admin',
        summary: 'Re-send the order receipt email (admin).',
        input: { params: idParams, },
        handler: ({ params, audit, },) => orders.resendReceipt(params.id, audit(),),
    },),

    // ── Settings ──
    // The literal /settings/admin is declared before /settings; neither
    // takes a path param, so there's no catch-all collision.

    // Public storefront projection (cache-safe: no Stripe secret keys).
    defineRoute({
        method: 'get', path: '/settings', auth: 'optional',
        summary: 'Storefront shop settings: appearance + a safe subset of config (currency, store/tax flags). No secret keys.',
        handler: () => shopSettings.getPublic(),
    },),

    // Full config (admin).
    defineRoute({
        method: 'get', path: '/settings/admin', auth: 'admin',
        summary: 'Full shop settings + appearance (admin).',
        handler: () => shopSettings.getAdmin(),
    },),

    // Stripe connection status (admin) — a live, cached Stripe API check so the
    // admin sees whether payments are actually wired up + accepting charges.
    defineRoute({
        method: 'get', path: '/settings/stripe-status', auth: 'admin',
        summary: 'Stripe connection status (cached ~60s; ?refresh=true forces a re-check).',
        input: { query: stripeStatusQuery, },
        handler: ({ query, },) => stripeStatus.getStripeStatus(query.refresh === 'true',),
    },),

    // Update config (admin): merge partial into shop_settings / shop_appearance.
    defineRoute({
        method: 'put', path: '/settings', auth: 'admin',
        summary: 'Update shop settings and/or appearance (admin); merges the partial and returns the full config.',
        input: { body: shopSettingsUpdateSchema, },
        handler: ({ body, audit, },) => shopSettings.update(body, audit(),),
    },),
];
