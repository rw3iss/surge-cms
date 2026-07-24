/**
 * Printify → Shop sync engine. Pulls every product from the configured Printify
 * shop and upserts it into the native shop_products tables (keyed on
 * external_provider='printify' + external_id), so the storefront, admin,
 * categories, and reviews all work on Printify products. Reconciles: products
 * that vanished from Printify are archived (soft delete).
 *
 * Reuses the shop repos (structure sync, taxonomy) rather than raw SQL, so a
 * Printify product ends up identical to a native one apart from provenance.
 */
import { generateSlug, } from '@sitesurge/types';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import {
    archiveExternalProducts,
    findExternalProductRefs,
    replaceProductStructure,
    type StructureMediaInput,
    type StructureOptionInput,
    type StructureVariantInput,
    upsertExternalProduct,
} from '../../repositories/shop/shopProducts.repo';
import {
    createCategory,
    findCategoryBySlug,
    setProductCategories,
    setProductTags,
} from '../../repositories/shop/shopCatalog.repo';
import { getPrintifyConfig, type PrintifyConfig, } from './config';
import { listAllProducts, type PrintifyProduct, } from './client';

const PROVIDER = 'printify';

/** Recognized Printify product-type tags → the shop category we file them under.
 *  Matched case-insensitively against a product's tags; the first hit wins. */
const PRODUCT_TYPE_TAGS = [
    'T-Shirts', 'Tank Tops', 'Long Sleeves', 'Hoodies', 'Sweatshirts', 'Sweaters',
    'Jackets', 'Leggings', 'Dresses', 'Shorts', 'Socks', 'Swimwear',
    'Hats', 'Caps', 'Beanies', 'Mugs', 'Bottles', 'Tumblers',
    'Stickers', 'Posters', 'Canvas', 'Phone Cases', 'Tote Bags', 'Bags',
    'Blankets', 'Pillows', 'Towels', 'Notebooks', 'Backpacks', 'Aprons',
];

export interface PrintifySyncResult {
    ok: boolean;
    fetched: number;
    upserted: number;
    archived: number;
    skipped: number;
    errors: string[];
    durationMs: number;
}

/** Build option-value-id → { which option it belongs to, its title }. A
 *  variant's `options` array is NOT guaranteed to be positionally aligned to
 *  `product.options`, so each value must be placed in ITS option's slot (else
 *  color/size get swapped). */
function valueInfoMap(p: PrintifyProduct,): Map<number, { optIdx: number; title: string; }> {
    const m = new Map<number, { optIdx: number; title: string; }>();
    (p.options ?? []).forEach((opt, idx,) => {
        for (const v of opt.values ?? []) m.set(v.id, { optIdx: idx, title: v.title, },);
    });
    return m;
}

/** Find/create the shop category for a product's type (from its tags). */
async function resolveTypeCategoryId(tags: string[],): Promise<string | null> {
    const lower = new Set(tags.map((t,) => t.toLowerCase()));
    const match = PRODUCT_TYPE_TAGS.find((t,) => lower.has(t.toLowerCase()));
    if (!match) return null;
    const slug = generateSlug(match,);
    const existing = await findCategoryBySlug(slug,);
    if (existing) return existing.id;
    const created = await createCategory({ name: match, slug, },);
    return created.id;
}

/** Adapt one Printify product into shop structure + taxonomy, then persist. */
async function upsertOne(p: PrintifyProduct, cfg: PrintifyConfig,): Promise<void> {
    const markup = 1 + (cfg.priceMarkupPercent || 0) / 100;
    const enabledVariants = (p.variants ?? []).filter((v,) => v.is_enabled);
    // Value ids actually used by enabled variants — so the storefront selector
    // only offers options that have a buyable variant.
    const usedValueIds = new Set<number>();
    for (const v of enabledVariants) for (const id of v.options ?? []) usedValueIds.add(id,);

    const info = valueInfoMap(p,);

    // Shop options (≤3), only the values used by enabled variants.
    const options: StructureOptionInput[] = (p.options ?? [])
        .slice(0, 3,)
        .map((opt,) => ({
            name: opt.name,
            values: (opt.values ?? [])
                .filter((v,) => usedValueIds.has(v.id))
                .map((v, i,) => ({ value: v.title, position: i, })),
        }))
        .filter((o,) => o.values.length > 0);

    // Variants → option1/2/3, placing each value in ITS option's slot (by the
    // option index it belongs to — Printify's variant.options order varies).
    const variants: StructureVariantInput[] = enabledVariants.map((v, i,) => {
        const slots: (string | null)[] = [null, null, null,];
        for (const id of v.options ?? []) {
            const hit = info.get(id,);
            if (hit && hit.optIdx < 3) slots[hit.optIdx] = hit.title;
        }
        return {
            sku: v.sku || null,
            priceCents: Math.round((v.price || 0) * markup,),
            inventoryQty: v.is_available ? 9999 : 0,
            weightGrams: v.grams ?? null,
            requiresShipping: true,
            option1: slots[0],
            option2: slots[1],
            option3: slots[2],
            position: i,
            isDefault: i === 0,
            externalId: String(v.id,),
        };
    });

    // Media — external Printify CDN URLs; default image first, deduped.
    const seen = new Set<string>();
    const orderedImages = [...(p.images ?? [])].sort((a, b,) => Number(b.is_default,) - Number(a.is_default,));
    const media: StructureMediaInput[] = [];
    for (const img of orderedImages) {
        if (!img.src || seen.has(img.src,)) continue;
        seen.add(img.src,);
        media.push({ externalUrl: img.src, position: media.length, kind: 'image', },);
        if (media.length >= 12) break;
    }

    const status = p.visible && !p.is_deleted ? (cfg.autoPublish ? 'active' : 'draft') : 'draft';
    const slug = `${generateSlug(p.title,)}-${String(p.id,).slice(-6,)}`;
    const externalUrl = `https://printify.com/app/store/${cfg.shopId}/products/${p.id}`;

    const product = await upsertExternalProduct({
        externalProvider: PROVIDER,
        externalId: String(p.id,),
        title: p.title,
        slug,
        description: p.description || null,
        status,
        externalUrl,
    },);

    await replaceProductStructure(product.id, { options, variants, media, },);
    await setProductTags(product.id, (p.tags ?? []).slice(0, 40,),);
    const catId = await resolveTypeCategoryId(p.tags ?? [],);
    await setProductCategories(product.id, catId ? [catId,] : [],);
}

/** Run a full sync. Pass a config or it reads the plugin config. */
export async function syncProducts(cfgArg?: PrintifyConfig,): Promise<PrintifySyncResult> {
    const started = Date.now();
    const cfg = cfgArg ?? (await getPrintifyConfig());
    if (!cfg) {
        return { ok: false, fetched: 0, upserted: 0, archived: 0, skipped: 0, errors: ['Printify is not enabled/configured.',], durationMs: 0, };
    }

    const errors: string[] = [];
    let products: PrintifyProduct[] = [];
    try {
        products = await listAllProducts(cfg,);
    } catch (err) {
        return { ok: false, fetched: 0, upserted: 0, archived: 0, skipped: 0, errors: [(err as Error).message,], durationMs: Date.now() - started, };
    }

    const seenExternalIds = new Set<string>();
    let upserted = 0;
    let skipped = 0;
    for (const p of products) {
        seenExternalIds.add(String(p.id,),);
        // Skip products with no sellable (enabled) variant.
        if (!(p.variants ?? []).some((v,) => v.is_enabled)) {
            skipped++;
            continue;
        }
        try {
            await upsertOne(p, cfg,);
            upserted++;
        } catch (err) {
            errors.push(`${p.title}: ${(err as Error).message}`,);
        }
    }

    // Reconcile — archive Printify products no longer present at the source.
    const existing = await findExternalProductRefs(PROVIDER,);
    const goneIds = existing
        .filter((e,) => !seenExternalIds.has(e.externalId,) && e.status !== 'archived')
        .map((e,) => e.id);
    const archived = await archiveExternalProducts(goneIds,);

    const durationMs = Date.now() - started;
    logger.info(`Printify sync: ${upserted} upserted, ${archived} archived, ${skipped} skipped, ${errors.length} errors in ${durationMs}ms`,);
    return { ok: errors.length === 0, fetched: products.length, upserted, archived, skipped, errors, durationMs, };
}

export interface PrintifyStatus {
    active: boolean;
    productCount: number;
    activeProductCount: number;
    lastSyncedAt: string | null;
    shopId: string | null;
    syncIntervalMinutes: number | null;
}

/** Status for the admin panel — derived from the ingested rows (no extra store). */
export async function getStatus(): Promise<PrintifyStatus> {
    const cfg = await getPrintifyConfig();
    const r = await query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
                MAX(external_synced_at) AS last_synced
             FROM shop_products WHERE external_provider = $1`,
        [PROVIDER,],
    );
    const row = r.rows[0] || {};
    return {
        active: cfg !== null,
        productCount: row.total ?? 0,
        activeProductCount: row.active_count ?? 0,
        lastSyncedAt: row.last_synced ? new Date(row.last_synced,).toISOString() : null,
        shopId: cfg?.shopId ?? null,
        syncIntervalMinutes: cfg?.syncIntervalMinutes ?? null,
    };
}
