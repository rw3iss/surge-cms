import { formatCurrency, } from '@sitesurge/types';

/** Format a cents amount as currency (defaults USD). Thin re-export so shop
 *  pages import money formatting from one place. */
export function money(cents: number, currency = 'USD',): string {
    return formatCurrency(cents, currency,);
}

/** Round a rating average to one decimal for display. */
export function ratingLabel(avg: number,): string {
    return (Math.round(avg * 10,) / 10).toFixed(1,);
}

/** Build a 5-slot star fill array ('full' | 'half' | 'empty') from an avg. */
export function starFills(avg: number,): ('full' | 'half' | 'empty')[] {
    const out: ('full' | 'half' | 'empty')[] = [];
    for (let i = 1; i <= 5; i++) {
        if (avg >= i) out.push('full',);
        else if (avg >= i - 0.5) out.push('half',);
        else out.push('empty',);
    }
    return out;
}
