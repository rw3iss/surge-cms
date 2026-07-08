/** Small shared helpers for the shop admin pages. */

/** Format an integer cents amount as a currency string. */
export function formatCents(cents: number | null | undefined, currency = 'USD',): string {
    const value = (cents ?? 0) / 100;
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency, },).format(value,);
    } catch {
        return `$${value.toFixed(2,)}`;
    }
}

/** Parse a dollars string (e.g. "12.50") into integer cents. Empty → 0. */
export function dollarsToCents(dollars: string,): number {
    const n = parseFloat(dollars,);
    if (!Number.isFinite(n,)) return 0;
    return Math.round(n * 100,);
}

/** Render integer cents as an editable dollars string ("12.50"); 0 → "". */
export function centsToDollars(cents: number | null | undefined,): string {
    if (cents === null || cents === undefined) return '';
    return (cents / 100).toFixed(2,);
}

/** lowercase-hyphen slug from arbitrary text. */
export function slugify(text: string,): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-',)
        .replace(/(^-|-$)/g, '',);
}

export function formatDate(iso: string | null | undefined,): string {
    if (!iso) return '—';
    const d = new Date(iso,);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', },);
}
