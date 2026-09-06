/**
 * Shop's data layer for the `product` entity type. Reads product COLUMNS
 * through the generic repo (so admin schema extensions to `shop_products`
 * automatically appear) and ENRICHES each record with related-table data:
 * `media` (an ordered array from `shop_product_media` → `media`) and `tags`.
 *
 * Registered via `registerEntityDataProvider('product', …)` at boot when the
 * shop feature is enabled, so `cms.entities.*` / `{{product(...)}}` / the entity
 * block all see full products. Writes route to the Shop editor (products carry
 * variants/media the generic path can't build); admin schema-extension columns
 * are still updatable via the generic path.
 */
import type { EntityQuery, EntityRecord, } from '@sitesurge/types';
import { query, } from '../../db';
import * as genericRepo from '../../repositories/genericEntity.repo';
import * as entityManager from '../../entities/entityManager';
import type { EntityDataProvider, } from '../../entities/dataProviders';
import { ValidationError, } from '../../middleware/error';

interface ProductMedia {
    mediaId: string;
    url: string;
    thumbnailUrl: string | null;
    alt: string | null;
    kind: string;
    mimeType: string;
    position: number;
    isMain: boolean;
}

async function loadMedia(productIds: string[],): Promise<Map<string, ProductMedia[]>> {
    const map = new Map<string, ProductMedia[]>();
    if (productIds.length === 0) return map;
    // A product image is EITHER an uploaded media row (media_id) OR an external
    // URL (external_url, e.g. Printify mockups) — LEFT JOIN + coalesce covers both.
    const r = await query<{
        product_id: string; media_id: string | null; media_url: string | null; external_url: string | null;
        thumbnail_url: string | null; alt: string | null; kind: string; mime_type: string | null; position: number;
    }>(
        `SELECT spm.product_id, spm.media_id, spm.kind, spm.position, spm.external_url,
                m.url AS media_url, m.thumbnail_url, m.alt, m.mime_type
         FROM shop_product_media spm
         LEFT JOIN media m ON m.id = spm.media_id
         WHERE spm.product_id = ANY($1)
         ORDER BY spm.position ASC`,
        [productIds,],
    );
    for (const row of r.rows) {
        const url = row.media_url ?? row.external_url;
        if (!url) continue; // skip a media row with neither source
        const arr = map.get(row.product_id,) ?? [];
        arr.push({
            mediaId: row.media_id ?? '', url, thumbnailUrl: row.thumbnail_url ?? url, alt: row.alt,
            kind: row.kind, mimeType: row.mime_type ?? (row.kind === 'video' ? 'video/*' : 'image/*'),
            position: row.position, isMain: row.position === 0,
        },);
        map.set(row.product_id, arr,);
    }
    return map;
}

async function loadTags(productIds: string[],): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (productIds.length === 0) return map;
    const r = await query<{ product_id: string; tag: string; }>(
        `SELECT product_id, tag FROM shop_product_tags WHERE product_id = ANY($1) ORDER BY tag`,
        [productIds,],
    );
    for (const row of r.rows) {
        const arr = map.get(row.product_id,) ?? [];
        arr.push(row.tag,);
        map.set(row.product_id, arr,);
    }
    return map;
}

/** A product variant projected onto the entity record. `price` is a dollars
 *  convenience (cents / 100) so a template can do `{{product.variants[0].price}}`
 *  directly; `priceCents` is kept for `{{formatCurrency(...)}}` / exact math. */
interface ProductVariant {
    id: string;
    sku: string | null;
    priceCents: number;
    price: number;
    compareAtPriceCents: number | null;
    inventoryQty: number;
    option1: string | null;
    option2: string | null;
    option3: string | null;
    imageId: string | null;
    position: number;
    isDefault: boolean;
}

async function loadVariants(productIds: string[],): Promise<Map<string, ProductVariant[]>> {
    const map = new Map<string, ProductVariant[]>();
    if (productIds.length === 0) return map;
    const r = await query<{
        id: string; product_id: string; sku: string | null; price_cents: number;
        compare_at_price_cents: number | null; inventory_qty: number;
        option1: string | null; option2: string | null; option3: string | null;
        image_id: string | null; position: number; is_default: boolean;
    }>(
        `SELECT id, product_id, sku, price_cents, compare_at_price_cents, inventory_qty,
                option1, option2, option3, image_id, position, is_default
         FROM shop_variants WHERE product_id = ANY($1)
         ORDER BY position ASC, created_at ASC`,
        [productIds,],
    );
    for (const row of r.rows) {
        const arr = map.get(row.product_id,) ?? [];
        arr.push({
            id: row.id, sku: row.sku, priceCents: row.price_cents, price: row.price_cents / 100,
            compareAtPriceCents: row.compare_at_price_cents, inventoryQty: row.inventory_qty,
            option1: row.option1, option2: row.option2, option3: row.option3,
            imageId: row.image_id, position: row.position, isDefault: row.is_default,
        },);
        map.set(row.product_id, arr,);
    }
    return map;
}

function enrich(
    rec: EntityRecord,
    media: Map<string, ProductMedia[]>,
    tags: Map<string, string[]>,
    variants: Map<string, ProductVariant[]>,
): EntityRecord {
    return {
        ...rec,
        media: media.get(rec.id,) ?? [],
        tags: tags.get(rec.id,) ?? [],
        variants: variants.get(rec.id,) ?? [],
    };
}

/** Product's public status is `active` (not the post-style `published`); remap
 *  the generic route's injected default so anonymous queries return products. */
/**
 * Map a query onto the product status vocabulary, and decide the default.
 *
 * `published` is the generic entity word; products call it `active`.
 *
 * The default matters more: a query with NO status previously returned every
 * product including drafts and archived ones, so a carousel bound to
 * `isFeatured = true` kept rendering products that had been deactivated — the
 * catalogue equivalent of a dead link. Public reads therefore default to
 * `active`; an explicit status still wins, and admin reads (the picker, the
 * Data tab) are left alone so staff can still see everything.
 */
function normalizeQuery(q: EntityQuery, admin: boolean,): EntityQuery {
    if (q.status === 'published') return { ...q, status: 'active', };
    if (q.status === undefined && !admin) return { ...q, status: 'active', };
    return q;
}

export const productEntityProvider: EntityDataProvider = {
    async list(q, opts,) {
        const t = entityManager.requireType('product',);
        const res = await genericRepo.list(t, normalizeQuery(q, Boolean(opts?.admin,),),);
        const ids = res.items.map((i,) => i.id);
        const [media, tags, variants,] = await Promise.all([loadMedia(ids,), loadTags(ids,), loadVariants(ids,),],);
        return { items: res.items.map((r,) => enrich(r, media, tags, variants,)), total: res.total, };
    },
    async getById(id,) {
        const t = entityManager.requireType('product',);
        const rec = await genericRepo.getById(t, id,);
        if (!rec) return null;
        const [media, tags, variants,] = await Promise.all([loadMedia([id,],), loadTags([id,],), loadVariants([id,],),],);
        return enrich(rec, media, tags, variants,);
    },
    async getBySlug(slug,) {
        const t = entityManager.requireType('product',);
        const rec = await genericRepo.getBySlug(t, slug,);
        if (!rec) return null;
        const [media, tags, variants,] = await Promise.all([loadMedia([rec.id,],), loadTags([rec.id,],), loadVariants([rec.id,],),],);
        return enrich(rec, media, tags, variants,);
    },
    async create() {
        throw new ValidationError('Create products in the Shop editor (they carry variants + media).',);
    },
    // update/remove intentionally omitted → the generic path handles them: an
    // UPDATE only sets the provided (extension) columns; DELETE cascades.
};
