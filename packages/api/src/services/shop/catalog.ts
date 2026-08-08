/**
 * Shop catalog service — categories (+tree), collections (+membership),
 * tags. Public reads are unrestricted-shape (categories) or published-only
 * (collections) → cache-safe; admin writes are audited + cache-invalidated.
 */
import type { ShopCategory, ShopCollection, ShopProduct, } from '@sitesurge/types';
import * as repo from '../../repositories/shop/shopCatalog.repo';
import { logAudit, } from '../audit';
import { cache, } from '../cache';
import type { AuditContext, } from '../types';

async function invalidateCatalogCache(): Promise<void> {
    await cache.invalidateShopCatalogCache();
}

// ─── Categories ───────────────────────────────────────────────────

/** All categories (flat; the tree is assembled client-side via parentId).
 *  Categories are not status-gated → cache-safe for everyone. */
export async function listCategoriesCached(): Promise<ShopCategory[]> {
    const cached = await cache.get<ShopCategory[]>(cache.CACHE_KEYS.shopCategories,);
    if (cached) return cached;
    const categories = await repo.findAllCategories();
    await cache.set(cache.CACHE_KEYS.shopCategories, categories, 300,);
    return categories;
}

export async function getCategoryBySlug(slug: string,): Promise<ShopCategory | null> {
    return repo.findCategoryBySlug(slug,);
}

export async function productsInCategory(categoryId: string,): Promise<ShopProduct[]> {
    return repo.findProductsInCategory(categoryId,);
}

export async function createCategory(data: Record<string, unknown>, ctx: AuditContext,): Promise<ShopCategory> {
    const category = await repo.createCategory(data,);
    await invalidateCatalogCache();
    await logAudit({
        userId: ctx.userId, action: 'create', entityType: 'shop-category', entityId: category.id,
        newValues: data, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return category;
}

export async function updateCategory(
    id: string,
    data: Record<string, unknown>,
    ctx: AuditContext,
): Promise<ShopCategory> {
    const category = await repo.updateCategory(id, data,);
    await invalidateCatalogCache();
    await logAudit({
        userId: ctx.userId, action: 'update', entityType: 'shop-category', entityId: id,
        newValues: data, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return category;
}

export async function removeCategory(id: string, ctx: AuditContext,): Promise<void> {
    await repo.deleteCategory(id,);
    await invalidateCatalogCache();
    await logAudit({
        userId: ctx.userId, action: 'delete', entityType: 'shop-category', entityId: id,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
}

/** Persist a manual category order (drag-reorder). Invalidates the catalog cache
 *  so the storefront sidebar reflects the new order. */
export async function reorderCategories(orderedIds: string[], ctx: AuditContext,): Promise<void> {
    await repo.reorderCategories(orderedIds,);
    await invalidateCatalogCache();
    await logAudit({
        userId: ctx.userId, action: 'reorder', entityType: 'shop-category',
        entityId: orderedIds[0] ?? 'multiple', newValues: { orderedIds, },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
}

// ─── Collections ──────────────────────────────────────────────────

/** Published collections (public), cached. */
export async function listCollectionsPublicCached(): Promise<ShopCollection[]> {
    const cacheKey = cache.CACHE_KEYS.shopCollections('published',);
    const cached = await cache.get<ShopCollection[]>(cacheKey,);
    if (cached) return cached;
    const collections = await repo.findAllCollections(true,);
    await cache.set(cacheKey, collections, 300,);
    return collections;
}

/** All collections (admin), any published state. */
export async function listCollectionsAdmin(): Promise<ShopCollection[]> {
    return repo.findAllCollections(false,);
}

export async function getCollectionBySlug(slug: string,): Promise<ShopCollection | null> {
    return repo.findCollectionBySlug(slug,);
}

export async function productsInCollection(collectionId: string,): Promise<ShopProduct[]> {
    return repo.findProductsInCollection(collectionId,);
}

export async function createCollection(
    data: Record<string, unknown>,
    productIds: string[] | undefined,
    ctx: AuditContext,
): Promise<ShopCollection> {
    const collection = await repo.createCollection(data,);
    if (productIds !== undefined) {
        await repo.setCollectionProducts(collection.id, productIds,);
    }
    await invalidateCatalogCache();
    await logAudit({
        userId: ctx.userId, action: 'create', entityType: 'shop-collection', entityId: collection.id,
        newValues: data, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return collection;
}

export async function updateCollection(
    id: string,
    data: Record<string, unknown>,
    productIds: string[] | undefined,
    ctx: AuditContext,
): Promise<ShopCollection> {
    const collection = await repo.updateCollection(id, data,);
    if (productIds !== undefined) {
        await repo.setCollectionProducts(id, productIds,);
    }
    await invalidateCatalogCache();
    await logAudit({
        userId: ctx.userId, action: 'update', entityType: 'shop-collection', entityId: id,
        newValues: data, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return collection;
}

export async function removeCollection(id: string, ctx: AuditContext,): Promise<void> {
    await repo.deleteCollection(id,);
    await invalidateCatalogCache();
    await logAudit({
        userId: ctx.userId, action: 'delete', entityType: 'shop-collection', entityId: id,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
}

// ─── Tags ─────────────────────────────────────────────────────────

/** Distinct tag list (public), cached. */
export async function listTagsCached(): Promise<string[]> {
    const cached = await cache.get<string[]>(cache.CACHE_KEYS.shopTags,);
    if (cached) return cached;
    const tags = await repo.findDistinctTags();
    await cache.set(cache.CACHE_KEYS.shopTags, tags, 300,);
    return tags;
}

export async function productsByTag(tag: string,): Promise<ShopProduct[]> {
    return repo.findProductsByTag(tag,);
}
