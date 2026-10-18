import { formatCurrency, shippingBreakdown, } from '@sitesurge/types';

/** Format a cents amount as currency (defaults USD). Thin re-export so shop
 *  pages import money formatting from one place. */
export function money(cents: number, currency = 'USD',): string {
    return formatCurrency(cents, currency,);
}

/** "12 in stock" / "Out of stock" — the storefront inventory label
 *  (shown when Shop → Appearance → Show inventory count is on). */
export function stockLabel(qty: number,): string {
    const n = Math.max(0, Math.floor(Number(qty,) || 0,),);
    return n > 0 ? `${n.toLocaleString()} in stock` : 'Out of stock';
}

/** Round a rating average to one decimal for display. Coerces in case the
 *  value arrives as a string (Postgres NUMERIC serializes to a string). */
export function ratingLabel(avg: number,): string {
    const n = Number(avg,) || 0;
    return (Math.round(n * 10,) / 10).toFixed(1,);
}

export interface ShipBreakdown {
    firstItemCents: number;
    additionalUnits: number;
    additionalItemCents: number;
}

/**
 * Split an authoritative shipping total into a first-item line + an
 * additional-items line for display. The shared `shippingBreakdown`
 * (`@sitesurge/types`, also behind `orderTotalsLines`) is the one rule.
 */
export function shipBreakdown(
    shippingCents: number,
    shippableUnits: number,
    shipping: { useAdditionalItemRate?: boolean; additionalItemCents?: number; } | undefined,
): ShipBreakdown | null {
    return shippingBreakdown(shippingCents, shippableUnits, shipping,);
}

/** Build a 5-slot star fill array ('full' | 'half' | 'empty') from an avg. */
export function starFills(avgInput: number,): ('full' | 'half' | 'empty')[] {
    const avg = Number(avgInput,) || 0;
    const out: ('full' | 'half' | 'empty')[] = [];
    for (let i = 1; i <= 5; i++) {
        if (avg >= i) out.push('full',);
        else if (avg >= i - 0.5) out.push('half',);
        else out.push('empty',);
    }
    return out;
}
