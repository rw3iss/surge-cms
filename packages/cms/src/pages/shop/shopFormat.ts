import { formatCurrency, } from '@sitesurge/types';

/** Format a cents amount as currency (defaults USD). Thin re-export so shop
 *  pages import money formatting from one place. */
export function money(cents: number, currency = 'USD',): string {
    return formatCurrency(cents, currency,);
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
 * additional-items line for display, when the shop's additional-item rate is
 * in use. `firstItemCents` absorbs any remainder so the two lines always sum
 * back to `shippingCents` (the server total stays authoritative). Returns null
 * when the tier isn't active, shipping is free/zero, or there's ≤1 shippable
 * unit (nothing to break apart).
 */
export function shipBreakdown(
    shippingCents: number,
    shippableUnits: number,
    shipping: { useAdditionalItemRate?: boolean; additionalItemCents?: number; } | undefined,
): ShipBreakdown | null {
    if (!shipping?.useAdditionalItemRate || shippingCents <= 0 || shippableUnits <= 1) return null;
    const additionalItemCents = shipping.additionalItemCents ?? 0;
    const additionalUnits = shippableUnits - 1;
    const firstItemCents = Math.max(0, shippingCents - additionalItemCents * additionalUnits,);
    return { firstItemCents, additionalUnits, additionalItemCents, };
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
