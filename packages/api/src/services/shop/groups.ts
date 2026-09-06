/**
 * Fulfilment groups — the multi-cart model.
 *
 * A cart can hold items that different parties ship: stock we hold ourselves,
 * a Printify print, an Apliiq print, an event ticket that is never shipped at
 * all. Each of those quotes its own shipping and, for suppliers, becomes its own
 * order. Everything downstream — shipping totals, order fulfilment records,
 * grouped cart/email rendering — keys off these groups.
 *
 * The grouping key is deliberately NOT just `external_provider`:
 *
 *  - `event_tickets` are virtual. Their cart line has a synthetic
 *    `event:<id>:<date>:<tier>` id and no `shop_variants` row, and they are
 *    never posted. Lumping them with native stock would put a shipping charge
 *    on a ticket.
 *  - `native` is everything we fulfil ourselves, which keeps the shop's own
 *    flat-rate/free-threshold logic intact and unaware of suppliers.
 *
 * Grouping reads the SERVER-resolved line, never the client's cart item — the
 * cart carries no provider field on purpose, because it would go stale the
 * moment a product is reassigned to a different supplier.
 */
import type { ShopShippingOption, } from '@sitesurge/types';
import type { ResolvedLine, } from './checkout';
import { getProvider, } from './providers/registry';

export type GroupKey = string;

export const NATIVE_GROUP: GroupKey = 'native';
export const TICKETS_GROUP: GroupKey = 'event_tickets';

export interface FulfillmentGroup {
    key: GroupKey;
    /** Shown to the buyer when carts are displayed separately. */
    label: string;
    /** True for supplier groups — these become provider orders. */
    isProvider: boolean;
    lines: ResolvedLine[];
    subtotalCents: number;
    shippingCents: number;
    shippingOptions: ShopShippingOption[];
    shippingMethod?: string;
    shippingMethodLabel?: string;
    /** The quote failed and this is a flat-rate fallback — never ship free. */
    shippingQuoteFailed?: boolean;
    /** No address yet, so the figure is an estimate. */
    shippingEstimated?: boolean;
}

/** Which group a resolved line belongs to. */
export function groupKeyForLine(line: ResolvedLine,): GroupKey {
    // A ticket has no shop variant, so it can never carry a provider.
    if ((line as { kind?: string; }).kind === 'event_ticket') return TICKETS_GROUP;
    return line.externalProvider ?? NATIVE_GROUP;
}

/**
 * Human label for a group. Falls back to the raw key rather than throwing —
 * a provider removed from the registry must not break an existing order's
 * rendering.
 */
export function groupLabel(key: GroupKey, businessName?: string | null,): string {
    if (key === NATIVE_GROUP) return businessName?.trim() || 'Our store';
    if (key === TICKETS_GROUP) return 'Event tickets';
    return getProvider(key,)?.label ?? key;
}

/**
 * Split resolved lines into groups.
 *
 * Order is stable and meaningful: native first (the operator's own goods lead),
 * then suppliers alphabetically, then tickets last since they are not shipped.
 * A stable order matters because the buyer sees these as sections and the admin
 * sees them in emails.
 */
export function groupLines(lines: ResolvedLine[],): Map<GroupKey, ResolvedLine[]> {
    const map = new Map<GroupKey, ResolvedLine[]>();
    for (const line of lines) {
        const key = groupKeyForLine(line,);
        const list = map.get(key,) ?? [];
        list.push(line,);
        map.set(key, list,);
    }
    const ordered = [...map.keys(),].sort((a, b,) => {
        const rank = (k: GroupKey,) => (k === NATIVE_GROUP ? 0 : k === TICKETS_GROUP ? 2 : 1);
        const d = rank(a,) - rank(b,);
        return d !== 0 ? d : a.localeCompare(b,);
    },);
    return new Map(ordered.map((k,) => [k, map.get(k,)!,]),);
}

/** Build the group shells (no shipping yet — that is `buildGroupShipping`). */
export function buildGroups(
    lines: ResolvedLine[],
    businessName?: string | null,
): FulfillmentGroup[] {
    const out: FulfillmentGroup[] = [];
    for (const [key, groupLines_,] of groupLines(lines,)) {
        out.push({
            key,
            label: groupLabel(key, businessName,),
            isProvider: key !== NATIVE_GROUP && key !== TICKETS_GROUP,
            lines: groupLines_,
            subtotalCents: groupLines_.reduce((sum, l,) => sum + l.subtotalCents, 0,),
            shippingCents: 0,
            shippingOptions: [],
        },);
    }
    return out;
}
