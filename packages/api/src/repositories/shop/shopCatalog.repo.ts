/**
 * Shop catalog repository — categories (tree), collections (with curated
 * membership), tags (distinct list), and the m2m assignment writes that a
 * product save uses. Follows the campaigns.repo style.
 */
import type { ShopCategory, ShopCollection, ShopProduct, } from '@sitesurge/types';
import type { PoolClient, } from 'pg';
import { query, } from '../../db';
import { mapRow, mapRows, } from '../../utils/mapRow';
import { deleteById, updateById, } from '../base.repo';

/**
 * Extra computed columns for storefront product lists (min variant price +
 * position-0 image url). Correlated subqueries against the `p` product row.
 * mapRow camelCases these to fromPriceCents / primaryImageUrl. Mirrors
 * LIST_EXTRAS in shopProducts.repo (aliased `p` here).
 */
const PRODUCT_LIST_EXTRAS = `
    (SELECT MIN(v.price_cents) FROM shop_variants v
         WHERE v.product_id = p.id) AS from_price_cents,
    (SELECT COALESCE(m.url, spm.external_url) FROM shop_product_media spm
         LEFT JOIN media m ON m.id = spm.media_id
         WHERE spm.product_id = p.id AND spm.kind = 'image'
           AND (spm.media_id IS NOT NULL OR spm.external_url IS NOT NULL)
         ORDER BY spm.position ASC LIMIT 1) AS primary_image_url`;

// ─── Categories ───────────────────────────────────────────────────

export async function findAllCategories(): Promise<ShopCategory[]> {
    const result = await query(
        `SELECT * FROM shop_categories ORDER BY position ASC, name ASC`,
    );
    return mapRows<ShopCategory>(result.rows,);
}

export async function findCategoryBySlug(slug: string,): Promise<ShopCategory | null> {
    const result = await query(`SELECT * FROM shop_categories WHERE slug = $1`, [slug,],);
    return result.rows.length > 0 ? mapRow<ShopCategory>(result.rows[0],) : null;
}

export async function createCategory(data: Record<string, unknown>,): Promise<ShopCategory> {
    const result = await query(
        `INSERT INTO shop_categories (name, slug, parent_id, description, image_id, position)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
        [
            data.name,
            data.slug,
            data.parentId ?? null,
            data.description ?? null,
            data.imageId ?? null,
            data.position ?? 0,
        ],
    );
    return mapRow<ShopCategory>(result.rows[0],);
}

export async function updateCategory(id: string, data: Record<string, unknown>,): Promise<ShopCategory> {
    return updateById<ShopCategory>('shop_categories', id, data, 'Category',);
}

export async function deleteCategory(id: string,): Promise<void> {
    return deleteById('shop_categories', id, 'Category',);
}

/** Active products in a category (public). */
export async function findProductsInCategory(categoryId: string,): Promise<ShopProduct[]> {
    const result = await query(
        `SELECT p.*, ${PRODUCT_LIST_EXTRAS} FROM shop_products p
             JOIN shop_product_categories pc ON pc.product_id = p.id
             WHERE pc.category_id = $1 AND p.status = 'active'
             ORDER BY p.created_at DESC`,
        [categoryId,],
    );
    return mapRows<ShopProduct>(result.rows,);
}

// ─── Collections ──────────────────────────────────────────────────

export async function findAllCollections(publishedOnly: boolean,): Promise<ShopCollection[]> {
    const whereClause = publishedOnly ? 'WHERE c.is_published = true' : '';
    // Live product_count per collection — a cheap correlated subquery keeps it
    // always-correct (no denormalized column / trigger to maintain).
    const result = await query(
        `SELECT c.*,
                (SELECT COUNT(*) FROM shop_collection_products cp WHERE cp.collection_id = c.id)::int AS product_count
         FROM shop_collections c ${whereClause}
         ORDER BY c.position ASC, c.title ASC`,
    );
    return mapRows<ShopCollection>(result.rows,);
}

export async function findCollectionBySlug(slug: string,): Promise<ShopCollection | null> {
    const result = await query(`SELECT * FROM shop_collections WHERE slug = $1`, [slug,],);
    return result.rows.length > 0 ? mapRow<ShopCollection>(result.rows[0],) : null;
}

export async function createCollection(data: Record<string, unknown>,): Promise<ShopCollection> {
    const result = await query(
        `INSERT INTO shop_collections (title, slug, description, image_id, position, is_published)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
        [
            data.title,
            data.slug,
            data.description ?? null,
            data.imageId ?? null,
            data.position ?? 0,
            data.isPublished ?? true,
        ],
    );
    return mapRow<ShopCollection>(result.rows[0],);
}

export async function updateCollection(id: string, data: Record<string, unknown>,): Promise<ShopCollection> {
    return updateById<ShopCollection>('shop_collections', id, data, 'Collection',);
}

export async function deleteCollection(id: string,): Promise<void> {
    return deleteById('shop_collections', id, 'Collection',);
}

/** Active products in a collection (public), curated order. */
export async function findProductsInCollection(collectionId: string,): Promise<ShopProduct[]> {
    const result = await query(
        `SELECT p.*, ${PRODUCT_LIST_EXTRAS} FROM shop_products p
             JOIN shop_collection_products cp ON cp.product_id = p.id
             WHERE cp.collection_id = $1 AND p.status = 'active'
             ORDER BY cp.position ASC`,
        [collectionId,],
    );
    return mapRows<ShopProduct>(result.rows,);
}

// ─── Tags ─────────────────────────────────────────────────────────

/** Distinct tag list across all products (powers admin autocomplete). */
export async function findDistinctTags(): Promise<string[]> {
    const result = await query(
        `SELECT DISTINCT tag FROM shop_product_tags ORDER BY tag ASC`,
    );
    return result.rows.map((r,) => r.tag as string);
}

/** Active products carrying a tag (public). */
export async function findProductsByTag(tag: string,): Promise<ShopProduct[]> {
    const result = await query(
        `SELECT p.*, ${PRODUCT_LIST_EXTRAS} FROM shop_products p
             JOIN shop_product_tags pt ON pt.product_id = p.id
             WHERE pt.tag = $1 AND p.status = 'active'
             ORDER BY p.created_at DESC`,
        [tag,],
    );
    return mapRows<ShopProduct>(result.rows,);
}

// ─── m2m assignment writes (used by product save) ─────────────────

/** Uniform runner: use the txn client when supplied, else the module
 *  `query`. Both expose `(sql, params) => Promise<{ rows }>`. */
type Exec = (sql: string, params?: unknown[],) => Promise<unknown>;
function exec(client?: PoolClient,): Exec {
    return client ? (sql, params,) => client.query(sql, params,) : (sql, params,) => query(sql, params,);
}

/** Replace a product's category assignments. */
export async function setProductCategories(
    productId: string,
    categoryIds: string[],
    client?: PoolClient,
): Promise<void> {
    const run = exec(client,);
    await run(`DELETE FROM shop_product_categories WHERE product_id = $1`, [productId,],);
    for (const categoryId of categoryIds) {
        await run(
            `INSERT INTO shop_product_categories (product_id, category_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
            [productId, categoryId,],
        );
    }
}

/** Replace a product's collection memberships (position = insertion order). */
export async function setProductCollections(
    productId: string,
    collectionIds: string[],
    client?: PoolClient,
): Promise<void> {
    const run = exec(client,);
    await run(`DELETE FROM shop_collection_products WHERE product_id = $1`, [productId,],);
    for (let i = 0; i < collectionIds.length; i++) {
        await run(
            `INSERT INTO shop_collection_products (collection_id, product_id, position) VALUES ($1, $2, $3)
                 ON CONFLICT DO NOTHING`,
            [collectionIds[i], productId, i,],
        );
    }
}

/** Replace a collection's product membership (curated order). */
export async function setCollectionProducts(
    collectionId: string,
    productIds: string[],
    client?: PoolClient,
): Promise<void> {
    const run = exec(client,);
    await run(`DELETE FROM shop_collection_products WHERE collection_id = $1`, [collectionId,],);
    for (let i = 0; i < productIds.length; i++) {
        await run(
            `INSERT INTO shop_collection_products (collection_id, product_id, position) VALUES ($1, $2, $3)
                 ON CONFLICT DO NOTHING`,
            [collectionId, productIds[i], i,],
        );
    }
}

/** Replace a product's tag set. */
export async function setProductTags(
    productId: string,
    tags: string[],
    client?: PoolClient,
): Promise<void> {
    const run = exec(client,);
    await run(`DELETE FROM shop_product_tags WHERE product_id = $1`, [productId,],);
    for (const tag of tags) {
        await run(
            `INSERT INTO shop_product_tags (product_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [productId, tag,],
        );
    }
}
