/**
 * Turn an Apliiq add-to-store payload into a shop product.
 *
 * Reuses the same repo writers as the Printify sync — `upsertExternalProduct`
 * (keyed on `(external_provider, external_id)`) and `replaceProductStructure` —
 * so variant UUIDs stay stable across a re-add. Carts and past orders reference
 * those ids; regenerating them on every push would orphan both.
 *
 * The payload arrives on an endpoint Apliiq does not sign, so everything here
 * treats it as untrusted: sizes and colours become options only when present,
 * prices are re-derived, and the product lands as a DRAFT for a human to
 * publish.
 */
import { query, } from '../../../../db';
import * as cache from '../../../cache';
import { logger, } from '../../../../utils/logger';
import * as repo from '../../../../repositories/shop/shopProducts.repo';
import { generateSlug, } from '@sitesurge/types';
import { toGrams, } from '../handlers';
import { designStemFromSku, } from './provider';

export interface ApliiqVariantPayload {
    sku?: string;
    price?: number;
    color?: string;
    size?: string;
    imageUrl?: string;
    weight?: number;
    weightUnit?: string;
    default?: boolean;
    width?: number; height?: number; length?: number; dimensionUnit?: string;
}

export interface ApliiqAddPayload {
    name?: string;
    type?: string;
    currency?: string;
    description?: string | null;
    imageUrls?: string[];
    sizes?: string[];
    colors?: string[];
    replaceProduct?: boolean;
    variants?: ApliiqVariantPayload[];
}

/** A slug that will not collide with an existing product. */
async function uniqueSlug(base: string, existingProductId: string | null,): Promise<string> {
    const root = generateSlug(base,) || 'apliiq-product';
    for (let n = 0; n < 50; n++) {
        const candidate = n === 0 ? root : `${root}-${n}`;
        const r = await query<{ id: string; }>(
            `SELECT id FROM shop_products WHERE slug = $1 LIMIT 1`, [candidate,],
        );
        const hit = r.rows[0];
        if (!hit || hit.id === existingProductId) return candidate;
    }
    return `${root}-${Date.now()}`;
}

export interface IngestResult {
    productId: string;
    variantCount: number;
    created: boolean;
}

export async function ingestApliiqProduct(
    payload: ApliiqAddPayload,
    designId: string,
    existingProductId: string | null,
): Promise<IngestResult> {
    const variants = payload.variants ?? [];
    const title = String(payload.name ?? '',).trim() || `Apliiq design ${designId}`;
    const slug = await uniqueSlug(title, existingProductId,);

    // Status on re-publish: KEEP whatever the product already has.
    //
    // `upsertExternalProduct` writes `status = EXCLUDED.status` on conflict, so
    // passing 'draft' unconditionally would silently UNPUBLISH a live product
    // every time the operator pushed an edit from the provider — the storefront
    // would lose the item with no indication why.
    //
    // New products still arrive as draft: the endpoint that delivered them
    // cannot authenticate its caller, so it must not be able to publish.
    let status = 'draft';
    if (existingProductId) {
        const cur = await query<{ status: string; }>(
            `SELECT status FROM shop_products WHERE id = $1`, [existingProductId,],
        );
        status = cur.rows[0]?.status ?? 'draft';
    }

    // Two different writes, because a merge is not an upsert.
    //
    // `upsertExternalProduct` keys on (external_provider, external_id). When a
    // SECOND colourway arrives its design id is new, so the upsert finds no
    // conflict and tries to INSERT — colliding on the slug of the product we
    // meant to merge into. Whenever the caller already told us which product
    // this belongs to, update that row by id instead.
    let product: { id: string; };
    if (existingProductId) {
        await query(
            `UPDATE shop_products
             SET title = $2, description = COALESCE($3, description),
                 status = $4, external_url = COALESCE(external_url, $5),
                 external_synced_at = NOW()
             WHERE id = $1`,
            [
                existingProductId, title, payload.description ?? null, status,
                `https://www.apliiq.com/product/${encodeURIComponent(designId,)}`,
            ],
        );
        product = { id: existingProductId, };
    } else {
        product = await repo.upsertExternalProduct({
            externalProvider: 'apliiq',
            externalId: designId,
            title,
            slug,
            description: payload.description ?? null,
            status,
            externalUrl: `https://www.apliiq.com/product/${encodeURIComponent(designId,)}`,
        },);
    }

    // Record every design folded into this product. A colourway merge means one
    // shop product spans several Apliiq designs, and re-publishing any of them
    // has to find its way back here.
    const priorRef = await query<{ external_ref: { designIds?: string[]; } | null; }>(
        `SELECT external_ref FROM shop_products WHERE id = $1`, [product.id,],
    );
    const designIds = [...new Set([
        ...(priorRef.rows[0]?.external_ref?.designIds ?? []),
        designId,
    ]),];
    await query(
        `UPDATE shop_products
         SET external_design_id = COALESCE(external_design_id, $2),
             external_ref = $3, external_synced_at = NOW()
         WHERE id = $1`,
        [
            product.id, designId,
            JSON.stringify({ apliiq: { type: payload.type ?? null, }, designIds, },),
        ],
    );

    // Colour is ALWAYS recorded, even when a design has only one.
    //
    // Apliiq models each colourway as a SEPARATE design, so "only one colour"
    // is the normal case — and dropping it loses the single fact that
    // distinguishes two otherwise identical designs. It was dropped originally
    // (a one-value selector looked like noise) and the result was two imported
    // products with identical sizes, identical titles and no way to tell which
    // was which, not even from Apliiq's own API.
    //
    // Sizes keep the old rule: a genuinely one-size product gains nothing from
    // a one-value selector, and nothing depends on knowing it.
    const colors = [...new Set(variants.map((v,) => v.color,).filter(Boolean,) as string[]),];
    const sizes = [...new Set(variants.map((v,) => v.size,).filter(Boolean,) as string[]),];
    const options: repo.StructureOptionInput[] = [];
    if (colors.length > 0) {
        options.push({ name: 'Color', position: 1, values: colors.map((v, i,) => ({ value: v, position: i, })), },);
    }
    if (sizes.length > 1) {
        options.push({ name: 'Size', position: options.length + 1, values: sizes.map((v, i,) => ({ value: v, position: i, })), },);
    }

    // Existing variants from OTHER designs of the same product must survive.
    // `replaceProductStructure` replaces the whole variant set, so a colourway
    // merge that passed only the incoming design's variants would delete the
    // colour already imported.
    const existingVariants = existingProductId
        ? (await query<{
            sku: string | null; external_id: string | null; price_cents: number;
            inventory_qty: number; weight_grams: number | null;
            option1: string | null; option2: string | null; option3: string | null;
            is_default: boolean;
        }>(
            `SELECT sku, external_id, price_cents, inventory_qty, weight_grams,
                    option1, option2, option3, is_default
             FROM shop_variants WHERE product_id = $1 ORDER BY position`,
            [existingProductId,],
        )).rows
        : [];

    const incomingSkus = new Set(variants.map((v,) => v.sku,).filter(Boolean,) as string[],);
    const carriedOver: repo.StructureVariantInput[] = existingVariants
        // Anything the incoming payload also covers is re-sent below with fresh
        // data; keep only what this design does not mention.
        .filter((v,) => !(v.external_id && incomingSkus.has(v.external_id,)))
        .map((v,) => ({
            sku: v.sku, priceCents: v.price_cents, inventoryQty: v.inventory_qty,
            weightGrams: v.weight_grams, requiresShipping: true,
            option1: v.option1, option2: v.option2, option3: v.option3,
            isDefault: false, externalId: v.external_id,
        }),);

    const structureVariants: repo.StructureVariantInput[] = variants.map((v, i,) => {
        let weightGrams: number | null = null;
        if (typeof v.weight === 'number' && v.weightUnit) {
            try {
                weightGrams = toGrams(v.weight, v.weightUnit,);
            } catch (err) {
                // Loud, not silent: a wrong weight quietly produces wrong
                // shipping, and Apliiq has no rate API to correct it.
                logger.warn(`[shop:apliiq] design ${designId}: ${(err as Error).message}`,);
            }
        }
        return {
            sku: v.sku ?? null,
            priceCents: Math.round(Number(v.price ?? 0,) * 100,),
            inventoryQty: 9999,          // made to order; never out of stock
            weightGrams,
            requiresShipping: true,
            option1: colors.length > 0 ? (v.color ?? null) : null,
            option2: sizes.length > 1 ? (v.size ?? null) : null,
            position: i,
            isDefault: v.default === true || i === 0,
            // The SKU is what POST /v1/Order matches on — this is the field the
            // whole fulfilment path depends on.
            externalId: v.sku ?? null,
        };
    },);

    const imageUrls = [...new Set([
        ...(payload.imageUrls ?? []),
        ...variants.map((v,) => v.imageUrl,).filter(Boolean,) as string[],
    ]),];

    // Media accumulates across colourways, exactly like variants.
    //
    // `replaceProductStructure` replaces the whole media set, so passing only
    // this design's images deletes the other colourway's — which is why a
    // merged product showed a single black mock-up and nothing for white.
    // Existing EXTERNAL rows are carried over (with their variant links), while
    // this design's own images are re-sent below with fresh data.
    const priorMedia = existingProductId
        ? (await query<{
            external_url: string | null; variant_id: string | null;
            kind: string; position: number;
        }>(
            `SELECT external_url, variant_id, kind, position
             FROM shop_product_media
             WHERE product_id = $1 AND media_id IS NULL AND external_url IS NOT NULL
             ORDER BY position`,
            [existingProductId,],
        )).rows
        : [];
    const carriedMedia: repo.StructureMediaInput[] = priorMedia
        .filter((m,) => !imageUrls.includes(String(m.external_url,),))
        .map((m,) => ({
            externalUrl: m.external_url, variantId: m.variant_id,
            kind: (m.kind === 'video' ? 'video' : 'image') as 'image' | 'video',
        }),);

    const media: repo.StructureMediaInput[] = imageUrls.map((url,) => ({
        externalUrl: url, kind: 'image' as const,
    }),);
    // Keep any media an operator imported themselves, as the Printify sync does.
    const operatorMedia = await repo.getImportedMedia(product.id,);

    // Options must cover the merged set, not just this design's colours.
    const mergedVariants = [...carriedOver, ...structureVariants,];
    const allColors = [...new Set(mergedVariants.map((v,) => v.option1,).filter(Boolean,) as string[]),];
    const allSizes = [...new Set(mergedVariants.map((v,) => v.option2,).filter(Boolean,) as string[]),];
    const mergedOptions: repo.StructureOptionInput[] = [];
    if (allColors.length > 0) {
        mergedOptions.push({ name: 'Color', position: 1, values: allColors.map((v, i,) => ({ value: v, position: i, })), },);
    }
    if (allSizes.length > 1) {
        mergedOptions.push({ name: 'Size', position: mergedOptions.length + 1, values: allSizes.map((v, i,) => ({ value: v, position: i, })), },);
    }
    // Exactly one default across the merged set.
    mergedVariants.forEach((v, i,) => { v.isDefault = i === 0; v.position = i; },);

    const allMedia = [...carriedMedia, ...media, ...operatorMedia,]
        .map((m, i,) => ({ ...m, position: i, }),);

    await repo.replaceProductStructure(product.id, {
        options: mergedOptions.length ? mergedOptions : options,
        variants: mergedVariants,
        media: allMedia,
    },);

    // Link each image to the variant it depicts.
    //
    // Has to run AFTER the structure write, because a variant's id does not
    // exist until it is inserted.
    //
    // Apliiq supplies ONE mock-up per colourway and repeats it on every size,
    // so an image identifies a COLOUR, not a specific variant. Linking per
    // variant in a loop therefore re-pointed the same media row once per size
    // and left it on whichever was processed last — the image ended up on
    // "5xl" for no reason anyone could infer. Bind each distinct image to the
    // FIRST variant carrying it instead, so the link is deterministic and
    // lands on the colour's leading size.
    const firstVariantForImage = new Map<string, string>();
    for (const v of variants) {
        if (!v.sku || !v.imageUrl) continue;
        if (!firstVariantForImage.has(v.imageUrl,)) firstVariantForImage.set(v.imageUrl, v.sku,);
    }
    for (const [imageUrl, sku,] of firstVariantForImage) {
        await query(
            `UPDATE shop_product_media m
             SET variant_id = sv.id
             FROM shop_variants sv
             WHERE m.product_id = $1 AND sv.product_id = $1
               AND sv.external_id = $2 AND m.external_url = $3
               AND m.variant_id IS DISTINCT FROM sv.id`,
            [product.id, sku, imageUrl,],
        );
    }

    // Drop the cached product/catalogue lists.
    //
    // Without this the rows exist but nothing shows them: the API serves a
    // cached list and the client's SWR cache serves a cached response on top of
    // that, so an operator sees "added successfully" and an unchanged admin.
    // The Printify sync has always done this; ingestion needs it for the same
    // reason.
    await cache.invalidateShopProductCache();
    await cache.invalidateShopCatalogCache();

    return {
        productId: product.id,
        variantCount: mergedVariants.length,
        created: existingProductId === null,
    };
}

export { designStemFromSku, };
