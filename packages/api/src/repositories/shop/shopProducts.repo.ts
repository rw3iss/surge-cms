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

// Default product ordering: manual `position` first (products with one sort
// ascending), then everything else by most-recently-updated. NULLS LAST puts
// unpositioned products after positioned ones; updated_at DESC is the fallback.
const POSITION_ORDER = 'ORDER BY position ASC NULLS LAST, updated_at DESC';

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
    (SELECT COALESCE(m.url, spm.external_url) FROM shop_product_media spm
         LEFT JOIN media m ON m.id = spm.media_id
         WHERE spm.product_id = shop_products.id AND spm.kind = 'image'
           AND (spm.media_id IS NOT NULL OR spm.external_url IS NOT NULL)
         ORDER BY spm.position ASC LIMIT 1) AS primary_image_url`;

export interface ProductFilters {
    status?: string;
    /** Fulfilment source: a provider key, or 'native' for our own stock. */
    provider?: string;
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

    // Storefront: manual position first, else updated_at (an explicit sortBy
    // — e.g. a future price sort — overrides).
    const orderClause = filters.sortBy
        ? buildSortClause(filters.sortBy, filters.sortOrder, VALID_SORT_COLUMNS, 'created_at',)
        : POSITION_ORDER;

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
    if (filters.provider) {
        // 'native' means we fulfil it ourselves — i.e. no external provider.
        if (filters.provider === 'native') {
            whereClause += ' AND external_provider IS NULL';
        } else {
            params.push(filters.provider,);
            whereClause += ` AND external_provider = $${params.length}`;
        }
    }

    // Admin: default to the manual position order (so the table matches the
    // storefront + drag-reorder is meaningful); explicit sortBy overrides.
    const orderClause = filters.sortBy
        ? buildSortClause(filters.sortBy, filters.sortOrder || 'desc', VALID_SORT_COLUMNS, 'created_at',)
        : POSITION_ORDER;

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
        // COALESCE lets a Printify (external_url) row resolve without an imported
        // media asset; native rows still resolve through the media join.
        `SELECT pm.*, COALESCE(m.url, pm.external_url) AS url, m.thumbnail_url, m.alt, m.mime_type AS media_type
             FROM shop_product_media pm
             LEFT JOIN media m ON m.id = pm.media_id
             WHERE pm.product_id = $1
               AND (pm.media_id IS NOT NULL OR pm.external_url IS NOT NULL)
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
                                    use_default_shipping, is_featured, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
        [
            data.title,
            data.slug,
            data.description ?? null,
            data.type || 'physical',
            data.status || 'draft',
            data.metaTitle ?? null,
            data.metaDescription ?? null,
            data.shippingType || 'calculated',
            data.useDefaultShipping ?? true,
            data.isFeatured ?? false,
            // created_by is a UUID FK; synthetic actors → NULL.
            uuidOrNull(userId,),
        ],
    );
    return mapRow<ShopProduct>(result.rows[0],);
}

export async function updateProduct(id: string, data: Record<string, unknown>,): Promise<ShopProduct> {
    return updateById<ShopProduct>('shop_products', id, data, 'Product',);
}

/**
 * Reorder products by MERGING the shown items' new relative order into the full
 * catalog order. `orderedShownIds` is the visible list (a page and/or a filtered
 * subset) in its new order. We keep every OTHER product exactly where it sits in
 * the current global order and only permute the shown items among the slots they
 * occupy — so reordering works with any status/search filter and pagination,
 * without disturbing rows that aren't on screen. Then the merged sequence gets
 * sequential positions (1..N) in one transaction.
 */
export async function reorderProducts(orderedShownIds: string[],): Promise<void> {
    if (orderedShownIds.length === 0) return;
    await transaction(async (c,) => {
        // Current global display order (matches POSITION_ORDER used everywhere).
        const all = await c.query<{ id: string; }>(
            `SELECT id FROM shop_products ORDER BY position ASC NULLS LAST, updated_at DESC`,
        );
        const globalOrder = all.rows.map((r,) => r.id);
        const shown = new Set(orderedShownIds,);
        const queue = [...orderedShownIds,]; // shown ids in their NEW order

        // Walk the global order; each slot that held a shown item receives the
        // next shown id from the new order. Unshown items stay in place.
        const merged = globalOrder.map((id,) => (shown.has(id,) ? (queue.shift() ?? id) : id));

        for (let i = 0; i < merged.length; i++) {
            await c.query(`UPDATE shop_products SET position = $1 WHERE id = $2`, [i + 1, merged[i],],);
        }
    },);
}

// ─── External-source (Printify) upsert + reconciliation ───────────────

export interface ExternalProductFields {
    externalProvider: string;
    externalId: string;
    title: string;
    slug: string;
    description?: string | null;
    status?: string;
    externalUrl?: string | null;
    metaTitle?: string | null;
    metaDescription?: string | null;
}

/**
 * Insert or update a product keyed on (external_provider, external_id) — the
 * idempotent core of a provider sync. Returns the product row (id stable across
 * re-syncs). Sets external_synced_at = now().
 */
export async function upsertExternalProduct(f: ExternalProductFields, client?: PoolClient,): Promise<ShopProduct> {
    const sql =
        `INSERT INTO shop_products (title, slug, description, type, status,
                                    meta_title, meta_description,
                                    external_provider, external_id, external_url, external_synced_at)
             VALUES ($1, $2, $3, 'physical', $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (external_provider, external_id) WHERE external_provider IS NOT NULL
         DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug,
                       description = EXCLUDED.description, status = EXCLUDED.status,
                       meta_title = EXCLUDED.meta_title, meta_description = EXCLUDED.meta_description,
                       external_url = EXCLUDED.external_url, external_synced_at = NOW()
         RETURNING *`;
    const params = [
        f.title,
        f.slug,
        f.description ?? null,
        f.status || 'active',
        f.metaTitle ?? null,
        f.metaDescription ?? null,
        f.externalProvider,
        f.externalId,
        f.externalUrl ?? null,
    ];
    const result = client ? await client.query(sql, params,) : await query(sql, params,);
    return mapRow<ShopProduct>(result.rows[0],);
}

/** All external products for a provider — id + external_id + status, used to
 *  reconcile (archive rows that vanished from the provider on a sync). */
export async function findExternalProductRefs(
    provider: string,
): Promise<{ id: string; externalId: string; status: string; }[]> {
    const result = await query(
        `SELECT id, external_id, status FROM shop_products WHERE external_provider = $1`,
        [provider,],
    );
    return result.rows.map((r,) => ({ id: r.id as string, externalId: r.external_id as string, status: r.status as string, }));
}

/** Archive external products (soft delete) whose ids are no longer present at
 *  the provider. Returns the count archived. */
export async function archiveExternalProducts(ids: string[],): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await query(
        `UPDATE shop_products SET status = 'archived', updated_at = NOW()
             WHERE id = ANY($1::uuid[]) AND status <> 'archived'`,
        [ids,],
    );
    return result.rowCount ?? 0;
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
    /** External provider variant id (Printify), for order fulfillment. */
    externalId?: string | null;
}

export interface StructureMediaInput {
    /** Imported media asset id. Provide EITHER mediaId OR externalUrl. */
    mediaId?: string | null;
    /** External image URL (e.g. a Printify CDN mockup) — no imported asset. */
    externalUrl?: string | null;
    variantId?: string | null;
    position?: number;
    kind?: 'image' | 'video';
}

export interface ProductStructure {
    options?: StructureOptionInput[];
    variants?: StructureVariantInput[];
    media?: StructureMediaInput[];
}

/** A product's CMS-added media — imported assets (media_id set), NOT the
 *  provider's external images. The Printify sync refreshes the external images
 *  from Printify but re-appends these so operator-added media survive a resync. */
export async function getImportedMedia(id: string,): Promise<StructureMediaInput[]> {
    const r = await query(
        `SELECT media_id, variant_id, kind FROM shop_product_media
             WHERE product_id = $1 AND media_id IS NOT NULL
             ORDER BY position ASC`,
        [id,],
    );
    return r.rows.map((row,) => ({
        mediaId: row.media_id as string,
        variantId: (row.variant_id as string | null) ?? null,
        kind: (row.kind as string) === 'video' ? 'video' : 'image',
    }),);
}

/** A product's provider provenance — used to resync a single item from its
 *  source (e.g. Printify) and to gate provider-only actions. */
export async function getExternalRef(id: string,): Promise<{ provider: string | null; externalId: string | null; }> {
    const r = await query(`SELECT external_provider, external_id FROM shop_products WHERE id = $1`, [id,],);
    const row = r.rows[0];
    return {
        provider: (row?.external_provider as string | null | undefined) ?? null,
        externalId: (row?.external_id as string | null | undefined) ?? null,
    };
}

/**
 * Transactionally replace a product's structure. Each part (options / variants /
 * media) is replaced ONLY when explicitly provided (non-undefined), so a partial
 * update preserves the parts it didn't send. Every product ends with ≥1 variant:
 * if none exist a default variant (is_default=true, all option slots null) is
 * created.
 */
export async function replaceProductStructure(
    productId: string,
    structure: ProductStructure,
    client?: PoolClient,
): Promise<void> {
    const run = async (c: PoolClient,): Promise<void> => {
        // Each part below is replaced ONLY when it was explicitly provided
        // (non-undefined), so a PARTIAL update preserves what it didn't send —
        // most importantly media synced from an external provider (Printify),
        // which the admin product editor does not round-trip. The ≥1-variant
        // invariant is enforced afterward regardless.

        // ── Options + values ──
        if (structure.options !== undefined) {
            await c.query(`DELETE FROM shop_product_options WHERE product_id = $1`, [productId,],);
            for (let i = 0; i < structure.options.length; i++) {
                const opt = structure.options[i];
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
        }

        // ── Variants ──
        // STABLE UUIDs: match incoming variants to existing rows and UPDATE them
        // in place, so a save or resync does NOT regenerate variant ids.
        // Regenerating them would orphan any cart holding the old id
        // (→ "Variant not found" at checkout) and NULL the order-item links.
        //
        // Matched on external_id (the provider's variant id) FIRST, then on the
        // option triple. That second key is not a nicety — the admin editor
        // sends neither an id nor an external_id for a variant, so external_id
        // alone missed every time, and the insert that followed collided with
        // the still-present row on
        // `UNIQUE (product_id, option1, option2, option3)`: a 23505, surfacing
        // as a 409 on every save of a product with real option values. (A
        // product whose single variant has all-NULL options never hit it,
        // because NULLs compare distinct — which is why this hid for so long.)
        //
        // The option triple is the right fallback because that unique index is
        // precisely the statement that it identifies a variant within a product.
        if (structure.variants !== undefined) {
            const variants = structure.variants;
            const existing = await c.query<{
                id: string; external_id: string | null;
                option1: string | null; option2: string | null; option3: string | null;
            }>(
                `SELECT id, external_id, option1, option2, option3 FROM shop_variants WHERE product_id = $1`,
                [productId,],
            );
            /**
             * Key for the option-triple map, or null when the triple is
             * entirely NULL.
             *
             * That null case matters: the unique index treats NULLs as
             * DISTINCT, so two optionless variants legitimately coexist on one
             * product. Matching them on "all nulls" would collapse them into
             * one another — so the fallback only applies where the index
             * actually constrains, i.e. at least one real option value.
             *
             * JSON-encoded so a value containing the separator can't be
             * confused with a different triple.
             */
            const optionKey = (a: unknown, b: unknown, c2: unknown,): string | null => {
                const t = [a ?? null, b ?? null, c2 ?? null,];
                return t.every((x,) => x === null) ? null : JSON.stringify(t,);
            };

            const byExternal = new Map<string, string>();
            const byOptions = new Map<string, string>();
            for (const row of existing.rows) {
                if (row.external_id) byExternal.set(String(row.external_id,), row.id,);
                const k = optionKey(row.option1, row.option2, row.option3,);
                if (k) byOptions.set(k, row.id,);
            }
            const keptIds = new Set<string>();

            for (let i = 0; i < variants.length; i++) {
                const v = variants[i];
                const cols = [
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
                    v.externalId ?? null,
                ];
                // external_id wins; the option triple is the fallback. `keptIds`
                // guards against two incoming variants claiming the same row.
                const optKey = optionKey(v.option1, v.option2, v.option3,);
                const byExt = v.externalId ? byExternal.get(String(v.externalId,),) : undefined;
                const byOpt = optKey ? byOptions.get(optKey,) : undefined;
                const existingId = (byExt && !keptIds.has(byExt,)) ? byExt
                    : (byOpt && !keptIds.has(byOpt,)) ? byOpt
                    : undefined;
                if (existingId) {
                    await c.query(
                        `UPDATE shop_variants SET
                            sku = $1, price_cents = $2, compare_at_price_cents = $3, inventory_qty = $4,
                            weight_grams = $5, requires_shipping = $6, shipping_cents = $7,
                            option1 = $8, option2 = $9, option3 = $10, image_id = $11, position = $12,
                            is_default = $13, external_id = $14, updated_at = NOW()
                         WHERE id = $15`,
                        [...cols, existingId,],
                    );
                    keptIds.add(existingId,);
                } else {
                    const ins = await c.query<{ id: string; }>(
                        `INSERT INTO shop_variants (product_id, sku, price_cents, compare_at_price_cents,
                                                    inventory_qty, weight_grams, requires_shipping, shipping_cents,
                                                    option1, option2, option3, image_id, position, is_default, external_id)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                             RETURNING id`,
                        [productId, ...cols,],
                    );
                    keptIds.add(ins.rows[0].id,);
                }
            }

            // Drop only the variants that are no longer present at the source
            // (order-item / product-media FKs are ON DELETE SET NULL).
            const removed = existing.rows.map((r,) => r.id).filter((id,) => !keptIds.has(id,));
            if (removed.length > 0) {
                await c.query(`DELETE FROM shop_variants WHERE id = ANY($1::uuid[])`, [removed,],);
            }
        }

        // ≥1-variant invariant: after a create (or a cleared variant set) the
        // product may have zero variants — synthesize a default. On a media-only
        // / options-only update the count is already ≥1, so this is a no-op.
        const variantCount = await c.query(
            `SELECT COUNT(*)::int AS n FROM shop_variants WHERE product_id = $1`,
            [productId,],
        );
        if (((variantCount.rows[0]?.n as number | undefined) ?? 0) === 0) {
            await c.query(
                `INSERT INTO shop_variants (product_id, price_cents, inventory_qty, requires_shipping, is_default, position)
                     VALUES ($1, 0, 0, true, true, 0)`,
                [productId,],
            );
        }

        // ── Media ── (delete-all + reinsert keeps ordering simple; the
        // media_id values come from the media library.)
        if (structure.media !== undefined) {
            await c.query(`DELETE FROM shop_product_media WHERE product_id = $1`, [productId,],);
            for (let i = 0; i < structure.media.length; i++) {
                const m = structure.media[i];
                // A media row references EITHER an imported asset (media_id) OR an
                // external URL. External rows have a NULL media_id (which never
                // conflicts on the (product_id, media_id) unique index — NULLs are
                // distinct), so the ON CONFLICT arm only applies to imported assets.
                await c.query(
                    `INSERT INTO shop_product_media (product_id, media_id, external_url, variant_id, position, kind)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (product_id, media_id) DO UPDATE SET
                             external_url = EXCLUDED.external_url, variant_id = EXCLUDED.variant_id,
                             position = EXCLUDED.position, kind = EXCLUDED.kind`,
                    [
                        productId,
                        uuidOrNull(m.mediaId ?? null,),
                        m.externalUrl ?? null,
                        uuidOrNull(m.variantId ?? null,),
                        m.position ?? i,
                        m.kind || 'image',
                    ],
                );
            }
        }
    };

    if (client) {
        await run(client,);
    } else {
        await transaction(run,);
    }
}
