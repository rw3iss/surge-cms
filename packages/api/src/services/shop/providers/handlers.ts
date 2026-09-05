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
interface ApliiqAddPayload {
    name?: string; type?: string; currency?: string;
    imageUrls?: string[]; sizes?: string[]; colors?: string[];
    replaceProduct?: boolean; variants?: ApliiqVariant[];
}

/** Bound the damage an unauthenticated caller can do. */
const MAX_VARIANTS = 500;

function normaliseApliiqAdd(payload: ApliiqAddPayload,): IncomingStoreProduct {
    const variants = payload.variants ?? [];
    if (!Array.isArray(variants,)) throw new Error('`variants` must be an array.',);
    if (variants.length > MAX_VARIANTS) {
        throw new Error(`Too many variants (${variants.length}).`,);
    }
    return {
        externalId: null,             // filled from the design stem by the hook
        externalDesignId: null,
        name: String(payload.name ?? '',).slice(0, 255,),
        replaceProduct: payload.replaceProduct === true,
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
            // create / update: ingestion lands in Task 7. Until then, refuse
            // honestly rather than reporting a success that wrote nothing.
            return {
                status: 200,
                body: {
                    storeProductId: null, stepsCompleted: [],
                    hasError: true,
                    errorMessages: ['The store is not finished accepting new products yet. Try again shortly.',],
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
            // Signed (fulfillment) or not (warehouse); either way the tracking
            // write lands in Task 5 with the per-provider fulfilment records.
            logger.info(`[shop:apliiq] ${event} received: ${JSON.stringify(input.body,).slice(0, 400,)}`,);
            return { status: 200, body: { received: true, }, };
        }

        default:
            return { status: 404, body: { error: 'Unknown event', }, };
    }
}
