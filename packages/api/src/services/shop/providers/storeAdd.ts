/**
 * The one pipeline every incoming product goes through, whichever direction it
 * arrived from — pushed by a webhook (Apliiq) or pulled by a sync (Printify).
 *
 * Sharing it is the point: dedupe, rejection and logging then behave identically
 * for both, so "why didn't my product import?" has one answer to look up rather
 * than two code paths to compare.
 */
import { query, } from '../../../db';
import { logger, } from '../../../utils/logger';
import { getProvider, } from './registry';
import type { IncomingStoreProduct, ProviderConfig, StoreAddDecision, } from './types';

/**
 * The fallback pre-flight for providers that declare no `beforeStoreAdd`.
 *
 * Dedupes on the provider's product id first, then on the design id — a design
 * re-added under a new product id is still the same design, and importing it
 * twice would put two identical products on the storefront.
 */
export async function defaultStoreAddCheck(
    provider: string,
    incoming: IncomingStoreProduct,
): Promise<StoreAddDecision> {
    const byExternal = incoming.externalId
        ? await query<{ id: string; }>(
            `SELECT id FROM shop_products
             WHERE external_provider = $1 AND external_id = $2 LIMIT 1`,
            [provider, incoming.externalId,],
        )
        : null;
    const existing = byExternal?.rows[0]
        ?? (incoming.externalDesignId
            ? (await query<{ id: string; }>(
                `SELECT id FROM shop_products
                 WHERE external_provider = $1 AND external_design_id = $2 LIMIT 1`,
                [provider, incoming.externalDesignId,],
            )).rows[0]
            : undefined);

    if (!existing) return { action: 'create', };

    // Re-publishing an existing product UPDATES it.
    //
    // A provider pushing the same product again is how an edit reaches us —
    // renamed, re-priced, new sizes, new artwork. Treating that as a no-op
    // would mean the store silently drifts from the provider, and the operator
    // has no other way to pull the change (Apliiq has no catalogue to sync).
    // Re-pushing identical data is simply an idempotent rewrite; variants are
    // matched on external_id so their ids — and therefore carts and past
    // orders — survive.
    return { action: 'update', productId: existing.id, };
}

export interface StoreAddOutcome {
    decision: StoreAddDecision;
    /** Our product id, when one exists or was created. */
    productId: string | null;
}

/**
 * Run the provider's pre-flight (or the default) and report what should happen.
 *
 * Deliberately does NOT write: the caller owns persistence, because a webhook
 * and a sync build their rows differently. This function's job is the decision,
 * and that the decision is logged.
 */
export async function runStoreAdd(
    providerKey: string,
    config: ProviderConfig,
    incoming: IncomingStoreProduct,
): Promise<StoreAddOutcome> {
    const provider = getProvider(providerKey,);
    if (!provider) {
        return { decision: { action: 'reject', reason: `Unknown provider “${providerKey}”.`, }, productId: null, };
    }

    let decision: StoreAddDecision;
    try {
        decision = provider.beforeStoreAdd
            ? await provider.beforeStoreAdd(config, incoming,)
            : await defaultStoreAddCheck(providerKey, incoming,);
    } catch (err) {
        // A throwing hook must not look like a silent skip.
        decision = { action: 'reject', reason: `Pre-import check failed: ${(err as Error).message}`, };
    }

    logger.info(
        `[shop:${providerKey}] store-add ${decision.action} `
            + `(external=${incoming.externalId ?? '-'}, design=${incoming.externalDesignId ?? '-'}, `
            + `name="${incoming.name}")`
            + ('reason' in decision ? ` — ${decision.reason}` : ''),
    );

    // On a refusal, record what actually arrived. Without this the only signal
    // is "no variants", which cannot distinguish a genuinely empty product from
    // a payload whose field names differ from the ones we read — and a webhook
    // we do not control is exactly where that happens.
    if (decision.action === 'reject') {
        const raw = incoming.raw;
        const keys = raw && typeof raw === 'object' ? Object.keys(raw as object,) : [];
        logger.warn(
            `[shop:${providerKey}] rejected payload had top-level keys [${keys.join(', ',)}]: `
                + JSON.stringify(raw,).slice(0, 4000,),
        );
    }

    return {
        decision,
        productId: 'productId' in decision ? decision.productId : null,
    };
}
