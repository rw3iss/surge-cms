/**
 * Per-group shipping.
 *
 * Replaces the single `hasPrintify` branch that assumed one supplier. Each group
 * quotes independently and the cart's shipping is the SUM of the chosen option
 * per group — two suppliers means two parcels, which really is two shipping
 * charges.
 *
 * Two invariants worth keeping:
 *
 *  1. A failed quote NEVER means free shipping. It falls back to the shop's
 *     configured flat rate and flags `shippingQuoteFailed` so the storefront can
 *     say so. Shipping a Printify parcel for $0 is a silent loss per order.
 *  2. Only groups that require shipping get options. An all-digital or
 *     tickets-only group contributes nothing.
 */
import type { ShopSettings, ShopShippingOption, } from '@sitesurge/types';
import type { ResolvedLine, } from './checkout';
import type { FulfillmentGroup, } from './groups';
import { NATIVE_GROUP, TICKETS_GROUP, } from './groups';
import { getProvider, } from './providers/registry';
import { getActiveProviderConfig, } from './providers/settings';
import { logger, } from '../../utils/logger';

/** The shop's flat rate, or $8.99 when unset. */
export function fallbackFlatCents(settings: ShopSettings,): number {
    const flat = settings.shipping?.flatCents;
    return typeof flat === 'number' && flat > 0 ? flat : 899;
}

export interface GroupShippingInput {
    groups: FulfillmentGroup[];
    settings: ShopSettings;
    shippingAddress: unknown;
    /** Per-group method choice. A bare string applies to every group, which is
     *  what the pre-multi-cart storefront sends. */
    requestedMethod?: string | Record<string, string>;
    /** Native flat-rate shipping for the native group, already computed by the
     *  caller so the existing free-threshold logic stays in one place. */
    nativeShippingCents: number;
}

function requestedFor(
    key: string, requested: GroupShippingInput['requestedMethod'],
): string | undefined {
    if (!requested) return undefined;
    return typeof requested === 'string' ? requested : requested[key];
}

export async function buildGroupShipping(input: GroupShippingInput,): Promise<{
    groups: FulfillmentGroup[];
    totalShippingCents: number;
    anyQuoteFailed: boolean;
    anyEstimated: boolean;
}> {
    const { groups, settings, shippingAddress, } = input;
    let total = 0;
    let anyQuoteFailed = false;
    let anyEstimated = false;

    for (const group of groups) {
        const needsShipping = group.lines.some((l,) => l.requiresShipping);
        if (!needsShipping || group.key === TICKETS_GROUP) {
            group.shippingOptions = [];
            group.shippingCents = 0;
            continue;
        }

        if (group.key === NATIVE_GROUP) {
            group.shippingOptions = [
                { id: 'standard', label: 'Standard', cents: input.nativeShippingCents, },
            ];
        } else {
            group.shippingOptions = await quoteProviderGroup(
                group, settings, shippingAddress,
            ).then((r,) => {
                if (r.quoteFailed) { group.shippingQuoteFailed = true; anyQuoteFailed = true; }
                if (r.estimated) { group.shippingEstimated = true; anyEstimated = true; }
                return r.options;
            },);
        }

        const wanted = requestedFor(group.key, input.requestedMethod,);
        const chosen = (wanted ? group.shippingOptions.find((o,) => o.id === wanted) : undefined)
            ?? group.shippingOptions.find((o,) => o.id === 'standard')
            ?? group.shippingOptions[0];

        group.shippingMethod = chosen?.id;
        group.shippingMethodLabel = chosen?.label;
        group.shippingCents = chosen?.cents ?? 0;
        total += group.shippingCents;
    }

    return { groups, totalShippingCents: total, anyQuoteFailed, anyEstimated, };
}

async function quoteProviderGroup(
    group: FulfillmentGroup,
    settings: ShopSettings,
    shippingAddress: unknown,
): Promise<{ options: ShopShippingOption[]; quoteFailed: boolean; estimated: boolean; }> {
    const flat = fallbackFlatCents(settings,);
    const flatOption = [{ id: 'standard', label: 'Standard', cents: flat, },];

    const provider = getProvider(group.key,);
    // A provider with no rate API (Apliiq) is not a failure — it is a known
    // limitation, so the flat rate is used WITHOUT flagging an error. Only an
    // actual quote attempt that fails gets flagged.
    if (!provider?.quoteShipping) {
        return { options: flatOption, quoteFailed: false, estimated: false, };
    }

    const config = await getActiveProviderConfig(group.key,);
    if (!config) {
        return { options: flatOption, quoteFailed: true, estimated: false, };
    }

    try {
        const quote = await provider.quoteShipping(config, group.lines.map(toProviderLine,), shippingAddress,);
        if (quote.ok && quote.options.length) {
            return { options: quote.options, quoteFailed: false, estimated: false, };
        }
        // No address yet is a prompt, not a failure — the figure refines once
        // the buyer types a country and postcode.
        if (quote.reason === 'no-address') {
            return { options: flatOption, quoteFailed: false, estimated: true, };
        }
        return { options: flatOption, quoteFailed: true, estimated: false, };
    } catch (err) {
        logger.warn(`[shop] ${group.key} shipping quote failed: ${(err as Error).message}`,);
        return { options: flatOption, quoteFailed: true, estimated: false, };
    }
}

function toProviderLine(l: ResolvedLine,) {
    return {
        variantId: l.variantId,
        externalProductId: l.externalProductId,
        externalVariantId: l.externalVariantId,
        qty: l.qty,
        grams: 0,
    };
}
