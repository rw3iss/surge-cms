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

    const product = await repo.upsertExternalProduct({
        externalProvider: 'apliiq',
        externalId: designId,
        title,
        slug,
        description: payload.description ?? null,
        status,
        externalUrl: `https://www.apliiq.com/product/${encodeURIComponent(designId,)}`,
    },);

    // Record the design reference + the raw payload for support/debugging.
    await query(
        `UPDATE shop_products
         SET external_design_id = $2, external_ref = $3, external_synced_at = NOW()
         WHERE id = $1`,
        [product.id, designId, JSON.stringify({ apliiq: { type: payload.type ?? null, }, },),],
    );

    // Options only when the payload actually varies on them — a single-colour
    // product should not gain a one-value "Color" selector.
    const colors = [...new Set(variants.map((v,) => v.color,).filter(Boolean,) as string[]),];
    const sizes = [...new Set(variants.map((v,) => v.size,).filter(Boolean,) as string[]),];
    const options: repo.StructureOptionInput[] = [];
    if (colors.length > 1) {
        options.push({ name: 'Color', position: 1, values: colors.map((v, i,) => ({ value: v, position: i, })), },);
    }
    if (sizes.length > 1) {
        options.push({ name: 'Size', position: options.length + 1, values: sizes.map((v, i,) => ({ value: v, position: i, })), },);
    }

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
            option1: colors.length > 1 ? (v.color ?? null) : null,
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
    const media: repo.StructureMediaInput[] = imageUrls.map((url, i,) => ({
        externalUrl: url, position: i, kind: 'image' as const,
    }),);
    // Keep any media an operator imported themselves, as the Printify sync does.
    const operatorMedia = await repo.getImportedMedia(product.id,);

    await repo.replaceProductStructure(product.id, {
        options,
        variants: structureVariants,
        media: [...media, ...operatorMedia,],
    },);

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
        variantCount: structureVariants.length,
        created: existingProductId === null,
    };
}

export { designStemFromSku, };
