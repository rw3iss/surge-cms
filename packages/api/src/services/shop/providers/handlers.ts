/**
 * Per-provider webhook handlers.
 *
 * Kept apart from `webhooks.ts` so the transport (match token, verify, record)
 * stays free of provider specifics, and a new provider adds an arm here rather
 * than editing the dispatcher.
 */
import { query, } from '../../../db';
import { logger, } from '../../../utils/logger';
import { runStoreAdd, } from './storeAdd';
import { designStemFromSku, } from './apliiq/provider';
import { parseApliiqTracking, } from './apliiq/tracking';
import type { IncomingStoreProduct, ProviderConfig, } from './types';
import type { WebhookResult, } from './webhooks';

interface HandlerInput {
    body: unknown;
    query: Record<string, string>;
}

/** oz/lb/g/kg → grams. Unknown units throw: silently recording 0 g would make
 *  weight-based shipping wrong in a way nobody notices until it costs money. */
export function toGrams(value: number, unit: string,): number {
    const u = unit.trim().toLowerCase();
    if (u === 'g' || u === 'gram' || u === 'grams') return Math.round(value,);
    if (u === 'kg') return Math.round(value * 1000,);
    if (u === 'oz') return Math.round(value * 28.349523125,);
    if (u === 'lb' || u === 'lbs') return Math.round(value * 453.59237,);
    throw new Error(`Unrecognised weight unit “${unit}”.`,);
}

interface ApliiqVariant {
    sku?: string; price?: number; color?: string; size?: string;
    imageUrl?: string; weight?: number; weightUnit?: string; default?: boolean;
}
interface ApliiqProductBody {
    name?: string; type?: string; currency?: string; description?: string;
    imageUrls?: string[]; sizes?: string[]; colors?: string[];
    replaceProduct?: boolean; variants?: ApliiqVariant[];
}

/**
 * What Apliiq actually POSTs.
 *
 * Their docs show the product FLAT at the top level. The live webhook instead
 * wraps it: `{ ApliiqProductIds: [6068710], product: { name, variants, … } }`.
 * Both are accepted — the documented shape because it is documented, the nested
 * one because it is what arrives.
 */
interface ApliiqAddPayload extends ApliiqProductBody {
    ApliiqProductIds?: Array<number | string>;
    product?: ApliiqProductBody;
}

/** Unwrap to the product body, whichever shape arrived. */
function apliiqProductOf(payload: ApliiqAddPayload,): ApliiqProductBody {
    return payload.product && typeof payload.product === 'object' ? payload.product : payload;
}

/** Bound the damage an unauthenticated caller can do. */
const MAX_VARIANTS = 500;

function normaliseApliiqAdd(payload: ApliiqAddPayload,): IncomingStoreProduct {
    const product = apliiqProductOf(payload,);
    const variants = product.variants ?? [];
    if (!Array.isArray(variants,)) throw new Error('`variants` must be an array.',);
    if (variants.length > MAX_VARIANTS) {
        throw new Error(`Too many variants (${variants.length}).`,);
    }
    // Identity: prefer Apliiq's own id — it is what their public product URL
    // uses (/product/6068710), so the admin deep-link resolves. Fall back to the
    // SKU stem when the wrapper is absent (the documented flat shape).
    const apliiqId = payload.ApliiqProductIds?.[0];
    const stem = variants.length ? designStemFromSku(String(variants[0].sku ?? '',),) : null;
    const identity = apliiqId != null ? String(apliiqId,) : stem;
    return {
        externalId: identity,
        externalDesignId: identity,
        name: String(product.name ?? '',).slice(0, 255,),
        replaceProduct: product.replaceProduct === true,
        variants: variants.map((v,) => ({
            sku: String(v.sku ?? '',).slice(0, 100,),
            // Apliiq quotes dollars; we store cents everywhere.
            priceCents: Math.round(Number(v.price ?? 0,) * 100,),
        }),),
        raw: payload,
    };
}

export async function dispatchProviderWebhook(
    provider: string,
    event: string,
    config: ProviderConfig,
    input: HandlerInput,
): Promise<WebhookResult> {
    if (provider === 'apliiq') return apliiqWebhook(event, config, input,);
    return { status: 202, body: { received: true, handled: false, }, };
}

async function apliiqWebhook(
    event: string, config: ProviderConfig, input: HandlerInput,
): Promise<WebhookResult> {
    switch (event) {
        case 'product_add_or_update': {
            const incoming = normaliseApliiqAdd((input.body ?? {}) as ApliiqAddPayload,);
            const { decision, productId, } = await runStoreAdd('apliiq', config, incoming,);

            // Apliiq reads this response and shows it to the operator, so a
            // refusal has to carry a sentence they can act on.
            if (decision.action === 'reject') {
                return {
                    status: 200,
                    body: {
                        storeProductId: null, stepsCompleted: [],
                        hasError: true, errorMessages: [decision.reason,],
                    },
                };
            }
            if (decision.action === 'skip') {
                return {
                    status: 200,
                    body: {
                        storeProductId: productId, stepsCompleted: ['Completed',],
                        hasError: false, errorMessages: [],
                    },
                };
            }
            // create / update
            const designId = incoming.externalDesignId;
            if (!designId) {
                return {
                    status: 200,
                    body: {
                        storeProductId: null, stepsCompleted: [],
                        hasError: true, errorMessages: ['Could not determine the design id from the SKUs.',],
                    },
                };
            }
            const { ingestApliiqProduct, } = await import('./apliiq/ingest.js');
            const res = await ingestApliiqProduct(
                apliiqProductOf((input.body ?? {}) as ApliiqAddPayload,) as never,
                designId, productId,
            );
            return {
                status: 200,
                body: {
                    storeProductId: res.productId,
                    // Apliiq shows these to the operator as progress. We do the
                    // whole thing in one transaction-ish pass, so report the
                    // steps that genuinely happened rather than echoing all of them.
                    stepsCompleted: res.created
                        ? ['DraftCreated', 'InventoryCreated', 'ImagesUploaded', 'Completed',]
                        : ['InventoryCreated', 'ImagesUploaded', 'Completed',],
                    hasError: false,
                    errorMessages: [],
                },
            };
        }

        case 'product_search': {
            // Apliiq asks whether a design is already in the store. Scoped to
            // apliiq products only — it must never enumerate the rest of the
            // catalogue, and it is unauthenticated beyond the path token.
            const term = String(input.query.search ?? '',).trim().slice(0, 120,);
            const r = await query(
                `SELECT id, title, external_id, external_design_id
                 FROM shop_products
                 WHERE external_provider = 'apliiq'
                   AND ($1 = '' OR title ILIKE '%' || $1 || '%'
                        OR external_design_id = $1 OR external_id = $1)
                 ORDER BY created_at DESC LIMIT 50`,
                [term,],
            );
            return {
                status: 200,
                body: r.rows.map((row,) => ({
                    storeProductId: row.id,
                    name: row.title,
                    designId: row.external_design_id,
                }),),
            };
        }

        case 'fulfillment':
        case 'warehouse_shipment_complete': {
            // Tracking pushed by Apliiq → the same write path Printify's
            // reconcile uses. Logs carry ids only: the body also holds the
            // customer's name and address.
            const update = parseApliiqTracking(event, input.body,);
            if (!update) {
                logger.warn(`[shop:apliiq] ${event}: no order id in the payload — ignored`,);
                return { status: 200, body: { received: true, matched: false, }, };
            }
            const match = await query<{ order_id: string; external_order_id: string | null; }>(
                `SELECT f.order_id, f.external_order_id
                   FROM shop_order_fulfillments f
                  WHERE f.provider = 'apliiq' AND $1::text IS NOT NULL AND f.external_order_id = $1
                 UNION ALL
                 SELECT o.id, f.external_order_id
                   FROM shop_orders o
                   LEFT JOIN shop_order_fulfillments f ON f.order_id = o.id AND f.provider = 'apliiq'
                  WHERE $2::text IS NOT NULL AND o.order_number = $2
                    AND EXISTS (SELECT 1 FROM shop_order_items oi
                                 WHERE oi.order_id = o.id AND oi.fulfillment_group = 'apliiq')
                  LIMIT 1`,
                [update.externalOrderId, update.orderNumber,],
            );
            const row = match.rows[0];
            if (!row) {
                logger.warn(`[shop:apliiq] ${event} for unknown order (apliiq ${update.externalOrderId ?? '-'}, ours ${update.orderNumber ?? '-'})`,);
                return { status: 200, body: { received: true, matched: false, }, };
            }
            const externalId = update.externalOrderId ?? row.external_order_id;
            if (!externalId) {
                logger.warn(`[shop:apliiq] ${event} for ${update.orderNumber}: no Apliiq order id to link — ignored`,);
                return { status: 200, body: { received: true, matched: false, }, };
            }
            const { applyFulfilmentState, } = await import('../providerFulfillment.js');
            const applied = await applyFulfilmentState(row.order_id, 'apliiq', externalId, update.state,);
            logger.info(`[shop:apliiq] ${event}: order ${row.order_id} → ${update.state.status}`
                + `${applied.conflict ? ` (conflict: linked to ${applied.conflict})` : ''}`,);
            return { status: 200, body: { received: true, matched: true, }, };
        }

        default:
            return { status: 404, body: { error: 'Unknown event', }, };
    }
}
