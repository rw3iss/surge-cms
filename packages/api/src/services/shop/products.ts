/**
 * Shop products service — public cached reads (active-only → cacheable),
 * admin reads (any status), and CRUD with the nested structure sync
 * (options / variants / media / taxonomy). Owns shop-product cache
 * invalidation + audit.
 *
 * Caching note: public reads resolve through the repo's active-only
 * queries. There is no admin bypass in those queries, so the public list
 * and slug caches are safe to populate for anonymous readers — mirrors the
 * campaigns module. The admin list handler never touches these caches.
 */
import type { ShopProduct, ShopProductDetail, } from '@sitesurge/types';
import { transaction, } from '../../db';
import * as catalog from '../../repositories/shop/shopCatalog.repo';
import * as repo from '../../repositories/shop/shopProducts.repo';
import { performBulkAction, } from '../../utils/bulkActions';
import type { BulkActionResult, } from '../../utils/bulkActions';
import { logAudit, } from '../audit';
import { cache, } from '../cache';
import type { AuditContext, ListResult, PaginationOpts, } from '../types';

export type { ProductFilters, } from '../../repositories/shop/shopProducts.repo';

async function invalidateProductCache(): Promise<void> {
    await cache.invalidateShopProductCache();
    // Category/collection product COUNTS (shown in the storefront sidebar) depend
    // on the product set + status + membership, so any product mutation must also
    // bust the catalog cache that carries those counts.
    await cache.invalidateShopCatalogCache();
}

// ─── Admin reads (any status) ─────────────────────────────────────

export async function list(
    filters: repo.ProductFilters = {},
    pagination: PaginationOpts = {},
): Promise<ListResult<ShopProduct>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const result = await repo.findAllProducts(filters, { page, limit, },);
    return {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };
}

export async function getDetailById(id: string,): Promise<ShopProductDetail | null> {
    try {
        return await repo.findProductDetailById(id,);
    } catch {
        return null;
    }
}

/** Admin-preview slug fetch — any status, full detail. */
export async function getBySlugAnyStatus(slug: string,): Promise<ShopProductDetail | null> {
    return repo.findProductBySlugAnyStatus(slug,);
}

// ─── Public reads (active-only — cache freely for anonymous) ────────

export async function listPublic(
    filters: Omit<repo.ProductFilters, 'status'> = {},
    pagination: PaginationOpts = {},
): Promise<ListResult<ShopProduct>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const result = await repo.findPublicProducts(filters, { page, limit, },);
    return {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };
}

/** Public product list with anonymous caching. Active-only → safe. */
export async function listPublicCached(
    filters: Omit<repo.ProductFilters, 'status'> = {},
    pagination: PaginationOpts = {},
): Promise<ListResult<ShopProduct>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const cacheKey = `${cache.CACHE_KEYS.shopProductsPrefix}${filters.search ?? ''}:${filters.sortBy ?? 'created_at'}:${filters.sortOrder ?? 'desc'}:${page}:${limit}`;

    const cached = await cache.get<ListResult<ShopProduct>>(cacheKey,);
    if (cached) return cached;

    const result = await listPublic(filters, { page, limit, },);
    await cache.set(cacheKey, result, 300,);
    return result;
}

/** Public slug fetch with anonymous caching. Active-only → safe. */
export async function getPublicBySlugCached(slug: string,): Promise<ShopProductDetail | null> {
    const cacheKey = cache.CACHE_KEYS.shopProductSlug(slug,);
    const cached = await cache.get<ShopProductDetail>(cacheKey,);
    if (cached) return cached;

    const product = await repo.findPublicProductBySlug(slug,);
    if (!product) return null;

    await cache.set(cacheKey, product, 300,);
    return product;
}

// ─── Writes (structure + taxonomy synced in one transaction) ────────

export interface ProductWriteInput {
    title: string;
    slug: string;
    description?: string | null;
    type?: 'physical' | 'digital';
    status?: 'draft' | 'active' | 'archived';
    metaTitle?: string | null;
    metaDescription?: string | null;
    shippingType?: 'flat' | 'calculated';
    useDefaultShipping?: boolean;
    options?: repo.StructureOptionInput[];
    variants?: repo.StructureVariantInput[];
    media?: repo.StructureMediaInput[];
    categoryIds?: string[];
    collectionIds?: string[];
    tags?: string[];
    /** Manual sort position (null clears it → falls back to updated_at order). */
    position?: number | null;
}

function splitStructure(input: Partial<ProductWriteInput>,): {
    fields: Record<string, unknown>;
    structure: repo.ProductStructure;
    taxonomy: { categoryIds?: string[]; collectionIds?: string[]; tags?: string[]; };
} {
    const { options, variants, media, categoryIds, collectionIds, tags, ...fields } = input;
    return {
        fields,
        structure: { options, variants, media, },
        taxonomy: { categoryIds, collectionIds, tags, },
    };
}

async function syncStructure(
    productId: string,
    structure: repo.ProductStructure | null,
    taxonomy: { categoryIds?: string[]; collectionIds?: string[]; tags?: string[]; },
): Promise<void> {
    await transaction(async (client,) => {
        // Only replace options/variants/media when structure was supplied.
        // A `null` structure (e.g. a taxonomy-only update) must NOT wipe the
        // product's variants — that would destroy the catalog + inventory.
        if (structure !== null) {
            await repo.replaceProductStructure(productId, structure, client,);
        }
        if (taxonomy.categoryIds !== undefined) {
            await catalog.setProductCategories(productId, taxonomy.categoryIds, client,);
        }
        if (taxonomy.collectionIds !== undefined) {
            await catalog.setProductCollections(productId, taxonomy.collectionIds, client,);
        }
        if (taxonomy.tags !== undefined) {
            await catalog.setProductTags(productId, taxonomy.tags, client,);
        }
    },);
}

export async function create(input: ProductWriteInput, ctx: AuditContext,): Promise<ShopProductDetail> {
    const { fields, structure, taxonomy, } = splitStructure(input,);
    const product = await repo.createProduct(fields, ctx.userId,);
    // Always sync structure so a product without options still gets a
    // default variant (≥1 variant invariant).
    await syncStructure(product.id, structure, taxonomy,);
    await invalidateProductCache();
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'shop-product',
        entityId: product.id,
        newValues: fields,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return repo.findProductDetailById(product.id,);
}

export async function update(
    id: string,
    input: Partial<ProductWriteInput>,
    ctx: AuditContext,
): Promise<ShopProductDetail> {
    const { fields, structure, taxonomy, } = splitStructure(input,);
    if (Object.keys(fields,).length > 0) {
        await repo.updateProduct(id, fields,);
    }
    // Only re-sync structure when any structural/taxonomy field was sent. The
    // editor round-trips external (Printify) media, so a save no longer drops
    // them — and `replaceProductStructure` only touches the parts provided, so
    // an operator can add / remove / reorder media and it persists.
    const hasStructure = input.options !== undefined || input.variants !== undefined
        || input.media !== undefined;
    const hasTaxonomy = taxonomy.categoryIds !== undefined
        || taxonomy.collectionIds !== undefined
        || taxonomy.tags !== undefined;
    if (hasStructure || hasTaxonomy) {
        await syncStructure(id, hasStructure ? structure : null, taxonomy,);
    }
    await invalidateProductCache();
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'shop-product',
        entityId: id,
        newValues: fields,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return repo.findProductDetailById(id,);
}

/** Persist a manual product order: assign sequential positions to `orderedIds`
 *  starting at `startPosition` (the page offset, 1-based). Invalidates caches so
 *  every listing reflects the new order. */
export async function reorder(
    orderedIds: string[],
    startPosition: number,
    ctx: AuditContext,
): Promise<void> {
    await repo.reorderProducts(orderedIds, startPosition,);
    await invalidateProductCache();
    await logAudit({
        userId: ctx.userId,
        action: 'reorder',
        entityType: 'shop-product',
        entityId: orderedIds[0] ?? 'multiple',
        newValues: { orderedIds, startPosition, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

export async function remove(id: string, ctx: AuditContext,): Promise<ShopProduct | null> {
    let existing: ShopProduct;
    try {
        existing = await repo.findProductById(id,);
    } catch {
        return null;
    }
    await repo.deleteProduct(id,);
    await invalidateProductCache();
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'shop-product',
        entityId: id,
        oldValues: existing as unknown as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return existing;
}

export async function bulk(body: unknown,): Promise<BulkActionResult> {
    return performBulkAction(body, {
        table: 'shop_products',
        allowedStatuses: ['draft', 'active', 'archived',],
        softDelete: false,
        onInvalidate: () => invalidateProductCache(),
    },);
}
