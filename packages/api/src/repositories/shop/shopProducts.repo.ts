/**
 * Shop products repository — product CRUD plus assembly of the nested
 * structure (options + values, variants, media) and the transactional
 * structure-sync used by product saves.
 *
 * Public reads are active-only (`status = 'active'`); admin reads see any
 * status. Follows the campaigns.repo style: base.repo helpers + mapRow +
 * uuidOrNull for the `created_by` FK.
 */
import type {
    ShopProduct,
    ShopProductDetail,
    ShopProductMediaDetail,
    ShopProductOptionDetail,
    ShopVariant,
} from '@sitesurge/types';
import type { PoolClient, } from 'pg';
import { query, transaction, } from '../../db';
import { mapRow, mapRows, } from '../../utils/mapRow';
import { uuidOrNull, } from '../../utils/uuid';
import {
    buildSortClause,
    deleteById,
    findByIdOrThrow,
    paginatedQuery,
    PaginatedResult,
    PaginationOptions,
    updateById,
} from '../base.repo';

const VALID_SORT_COLUMNS: Record<string, string> = {
    created_at: 'created_at',
    updated_at: 'updated_at',
    title: 'title',
    status: 'status',
    rating_avg: 'rating_avg',
    rating_count: 'rating_count',
};

/**
 * Extra computed columns for list rows (public + admin lists). Correlated
 * subqueries against the outer `shop_products` row:
 *   - from_price_cents: min variant price across the product's variants.
 *   - primary_image_url: url of the position-0 (lowest position) image
 *     media row, resolved to the `media.url` column.
 * mapRow camelCases these to fromPriceCents / primaryImageUrl.
 */
const LIST_EXTRAS = `
    (SELECT MIN(v.price_cents) FROM shop_variants v
         WHERE v.product_id = shop_products.id) AS from_price_cents,
    (SELECT m.url FROM shop_product_media spm
         JOIN media m ON m.id = spm.media_id
         WHERE spm.product_id = shop_products.id AND spm.kind = 'image'
         ORDER BY spm.position ASC LIMIT 1) AS primary_image_url`;

export interface ProductFilters {
    status?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
}

// ─── Lists ────────────────────────────────────────────────────────

/** Public product list — active-only, paginated. Optional search/sort. */
export async function findPublicProducts(
    filters: Omit<ProductFilters, 'status'>,
    pagination: PaginationOptions,
): Promise<PaginatedResult<ShopProduct>> {
    let whereClause = `WHERE status = 'active'`;
    const params: unknown[] = [];

    if (filters.search) {
        params.push(`%${filters.search}%`,);
        whereClause += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }

    const orderClause = buildSortClause(filters.sortBy, filters.sortOrder, VALID_SORT_COLUMNS, 'created_at',);

    return paginatedQuery<ShopProduct>(
        `SELECT *, ${LIST_EXTRAS} FROM shop_products ${whereClause} ${orderClause}`,
        `SELECT COUNT(*) FROM shop_products ${whereClause}`,
        params,
        pagination,
    );
}

/** Admin product list — any status, paginated. Filters status/search. */
export async function findAllProducts(
    filters: ProductFilters,
    pagination: PaginationOptions,
): Promise<PaginatedResult<ShopProduct>> {
    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (filters.status) {
        params.push(filters.status,);
        whereClause += ` AND status = $${params.length}`;
    }
    if (filters.search) {
        params.push(`%${filters.search}%`,);
        whereClause += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }

    const orderClause = buildSortClause(filters.sortBy || 'updated_at', filters.sortOrder || 'desc', VALID_SORT_COLUMNS, 'created_at',);

    return paginatedQuery<ShopProduct>(
        `SELECT *, ${LIST_EXTRAS} FROM shop_products ${whereClause} ${orderClause}`,
        `SELECT COUNT(*) FROM shop_products ${whereClause}`,
        params,
        pagination,
    );
}

// ─── Structure assembly ───────────────────────────────────────────

async function loadOptions(productId: string,): Promise<ShopProductOptionDetail[]> {
    const opts = await query(
        `SELECT * FROM shop_product_options WHERE product_id = $1 ORDER BY position ASC`,
        [productId,],
    );
    const optionRows = mapRows<ShopProductOptionDetail>(opts.rows,);
    if (optionRows.length === 0) return [];

    const optionIds = optionRows.map((o,) => o.id);
    const vals = await query(
        `SELECT * FROM shop_option_values WHERE option_id = ANY($1::uuid[]) ORDER BY position ASC`,
        [optionIds,],
    );
    const valueRows = mapRows<{ id: string; optionId: string; value: string; position: number; }>(vals.rows,);

    return optionRows.map((o,) => ({
        ...o,
        values: valueRows.filter((v,) => v.optionId === o.id),
    }));
}

async function loadVariants(productId: string,): Promise<ShopVariant[]> {
    const result = await query(
        `SELECT * FROM shop_variants WHERE product_id = $1 ORDER BY position ASC, created_at ASC`,
        [productId,],
    );
    return mapRows<ShopVariant>(result.rows,);
}

async function loadMedia(productId: string,): Promise<ShopProductMediaDetail[]> {
    const result = await query(
        `SELECT pm.*, m.url, m.thumbnail_url, m.alt, m.mime_type AS media_type
             FROM shop_product_media pm
             JOIN media m ON m.id = pm.media_id
             WHERE pm.product_id = $1
             ORDER BY pm.position ASC`,
        [productId,],
    );
    return mapRows<ShopProductMediaDetail>(result.rows,);
}

async function loadTaxonomy(
    productId: string,
): Promise<{ categoryIds: string[]; collectionIds: string[]; tags: string[]; }> {
    const [cats, cols, tags,] = await Promise.all([
        query(`SELECT category_id FROM shop_product_categories WHERE product_id = $1`, [productId,],),
        query(`SELECT collection_id FROM shop_collection_products WHERE product_id = $1 ORDER BY position ASC`, [productId,],),
        query(`SELECT tag FROM shop_product_tags WHERE product_id = $1 ORDER BY tag ASC`, [productId,],),
    ],);
    return {
        categoryIds: cats.rows.map((r,) => r.category_id as string),
        collectionIds: cols.rows.map((r,) => r.collection_id as string),
        tags: tags.rows.map((r,) => r.tag as string),
    };
}

/** Assemble a full product detail from a base product row. */
async function assembleDetail(product: ShopProduct,): Promise<ShopProductDetail> {
    const [options, variants, media, taxonomy,] = await Promise.all([
        loadOptions(product.id,),
        loadVariants(product.id,),
        loadMedia(product.id,),
        loadTaxonomy(product.id,),
    ],);
    return { ...product, options, variants, media, ...taxonomy, };
}

// ─── Single reads ─────────────────────────────────────────────────

/** Public product by slug — active-only, full nested detail. */
export async function findPublicProductBySlug(slug: string,): Promise<ShopProductDetail | null> {
    const result = await query(
        `SELECT * FROM shop_products WHERE slug = $1 AND status = 'active'`,
        [slug,],
    );
    if (result.rows.length === 0) return null;
    return assembleDetail(mapRow<ShopProduct>(result.rows[0],),);
}

/** Admin-preview product by slug — any status, full nested detail. */
export async function findProductBySlugAnyStatus(slug: string,): Promise<ShopProductDetail | null> {
    const result = await query(`SELECT * FROM shop_products WHERE slug = $1`, [slug,],);
    if (result.rows.length === 0) return null;
    return assembleDetail(mapRow<ShopProduct>(result.rows[0],),);
}

/** Admin product by id — any status, full nested detail. Throws if absent. */
export async function findProductDetailById(id: string,): Promise<ShopProductDetail> {
    const product = await findByIdOrThrow<ShopProduct>('shop_products', id, 'Product',);
    return assembleDetail(product,);
}

export async function findProductById(id: string,): Promise<ShopProduct> {
    return findByIdOrThrow<ShopProduct>('shop_products', id, 'Product',);
}

// ─── Writes ───────────────────────────────────────────────────────

export async function createProduct(data: Record<string, unknown>, userId: string,): Promise<ShopProduct> {
    const result = await query(
        `INSERT INTO shop_products (title, slug, description, type, status,
                                    meta_title, meta_description, shipping_type,
                                    use_default_shipping, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
        [
            data.title,
            data.slug,
            data.description ?? null,
            data.type || 'physical',
            data.status || 'draft',
            data.metaTitle ?? null,
            data.metaDescription ?? null,
            data.shippingType || 'flat',
            data.useDefaultShipping ?? true,
            // created_by is a UUID FK; synthetic actors → NULL.
            uuidOrNull(userId,),
        ],
    );
    return mapRow<ShopProduct>(result.rows[0],);
}

export async function updateProduct(id: string, data: Record<string, unknown>,): Promise<ShopProduct> {
    return updateById<ShopProduct>('shop_products', id, data, 'Product',);
}

export async function deleteProduct(id: string,): Promise<void> {
    return deleteById('shop_products', id, 'Product',);
}

// ─── Nested structure sync ────────────────────────────────────────

export interface StructureOptionInput {
    name: string;
    position?: number;
    values: { value: string; position?: number; }[];
}

export interface StructureVariantInput {
    sku?: string | null;
    priceCents: number;
    compareAtPriceCents?: number | null;
    inventoryQty?: number;
    weightGrams?: number | null;
    requiresShipping?: boolean;
    shippingCents?: number | null;
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
    imageId?: string | null;
    position?: number;
    isDefault?: boolean;
}

export interface StructureMediaInput {
    mediaId: string;
    variantId?: string | null;
    position?: number;
    kind?: 'image' | 'video';
}

export interface ProductStructure {
    options?: StructureOptionInput[];
    variants?: StructureVariantInput[];
    media?: StructureMediaInput[];
}

/**
 * Transactionally replace a product's full structure. Deletes + reinserts
 * options/values and variants, and syncs product_media (delete rows no
 * longer present, upsert the rest). Every product ends with ≥1 variant:
 * if no variants are supplied a default variant (is_default=true, all
 * option slots null) is created.
 */
export async function replaceProductStructure(
    productId: string,
    structure: ProductStructure,
    client?: PoolClient,
): Promise<void> {
    const run = async (c: PoolClient,): Promise<void> => {
        // ── Options + values ──
        await c.query(`DELETE FROM shop_product_options WHERE product_id = $1`, [productId,],);
        const options = structure.options ?? [];
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const optRes = await c.query(
                `INSERT INTO shop_product_options (product_id, name, position) VALUES ($1, $2, $3) RETURNING id`,
                [productId, opt.name, opt.position ?? i,],
            );
            const optionId = optRes.rows[0].id as string;
            for (let j = 0; j < opt.values.length; j++) {
                const val = opt.values[j];
                await c.query(
                    `INSERT INTO shop_option_values (option_id, value, position) VALUES ($1, $2, $3)`,
                    [optionId, val.value, val.position ?? j,],
                );
            }
        }

        // ── Variants ── (dropping product's variants also SET NULLs any
        // product_media.variant_id referencing them, per the FK.)
        await c.query(`DELETE FROM shop_variants WHERE product_id = $1`, [productId,],);
        let variants = structure.variants ?? [];
        if (variants.length === 0) {
            // Every product needs ≥1 variant → synthesize a default.
            variants = [{ priceCents: 0, isDefault: true, inventoryQty: 0, }];
        }
        for (let i = 0; i < variants.length; i++) {
            const v = variants[i];
            await c.query(
                `INSERT INTO shop_variants (product_id, sku, price_cents, compare_at_price_cents,
                                            inventory_qty, weight_grams, requires_shipping, shipping_cents,
                                            option1, option2, option3, image_id, position, is_default)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                [
                    productId,
                    v.sku ?? null,
                    v.priceCents ?? 0,
                    v.compareAtPriceCents ?? null,
                    v.inventoryQty ?? 0,
                    v.weightGrams ?? null,
                    v.requiresShipping ?? true,
                    v.shippingCents ?? null,
                    v.option1 ?? null,
                    v.option2 ?? null,
                    v.option3 ?? null,
                    uuidOrNull(v.imageId ?? null,),
                    v.position ?? i,
                    v.isDefault ?? (variants.length === 1),
                ],
            );
        }

        // ── Media ── (delete-all + reinsert keeps ordering simple; the
        // media_id values come from the media library.)
        await c.query(`DELETE FROM shop_product_media WHERE product_id = $1`, [productId,],);
        const media = structure.media ?? [];
        for (let i = 0; i < media.length; i++) {
            const m = media[i];
            await c.query(
                `INSERT INTO shop_product_media (product_id, media_id, variant_id, position, kind)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (product_id, media_id) DO UPDATE SET
                         variant_id = EXCLUDED.variant_id, position = EXCLUDED.position, kind = EXCLUDED.kind`,
                [productId, m.mediaId, uuidOrNull(m.variantId ?? null,), m.position ?? i, m.kind || 'image',],
            );
        }
    };

    if (client) {
        await run(client,);
    } else {
        await transaction(run,);
    }
}
