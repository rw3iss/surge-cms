/**
 * Membership price maths shared by the server, the SPA and emails — ONE
 * definition of "monthly equivalent", billing words and money formatting.
 * Before, five copies drifted (e.g. upgrade/downgrade compared raw cents
 * across intervals, so $25/month → $250/year read as an "upgrade").
 *
 * The tier-rank SQL (`TIER_RANK_SQL` in the api's services/subscriptionTiers.ts)
 * keeps its own copy of `perMonthCents`; keep the two in step.
 */

export interface RecurringPrice { amount: number; interval: string; intervalCount?: number | null; }

/** Months in one interval (day = 12/365 of a month, as the rank SQL uses). */
const MONTHS_PER: Record<string, number> = { day: 12 / 365, week: 12 / 52, month: 1, year: 12, };

/** A price's monthly-equivalent cost in cents ($250 / year → 2083.33). */
export function perMonthCents(p: RecurringPrice,): number {
    const months = MONTHS_PER[p.interval] ?? 1;
    return p.amount / (months * Math.max(1, p.intervalCount ?? 1,));
}

/** "monthly", "yearly", "every 3 months", "bi-weekly". */
export function billingFrequency(interval: string, count = 1,): string {
    if (interval === 'week' && count === 2) return 'bi-weekly';
    if (count > 1) return `every ${count} ${interval}s`;
    return ({ day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly', } as Record<string, string>)[interval] ?? `every ${interval}`;
}

/** "$1,500.00", "€25.00" — Intl currency formatting of a cents amount. */
export function formatMoney(cents: number, currency = 'usd', locale = 'en-US',): string {
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: (currency || 'usd').toUpperCase(), },).format(cents / 100,);
    } catch {
        return `${(cents / 100).toFixed(2,)} ${(currency || '').toUpperCase()}`;
    }
}

/** Is `to` dearer than `from` per month? (the direction of a level change). */
export function isUpgrade(to: RecurringPrice, from: RecurringPrice | null | undefined,): boolean {
    return perMonthCents(to,) > (from ? perMonthCents(from,) : 0);
}
