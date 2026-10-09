/** Shared tier price formatting for the profile Membership tab and /subscribe. */
import type { MembershipTierOption, } from '@sitesurge/types';

export function money(cents: number, currency = 'usd',): string {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), },).format(cents / 100,);
}

/** " / month", " every 3 months", '' for free. */
export function per(t: { isFree: boolean; interval: string; intervalCount: number; },): string {
    if (t.isFree) return '';
    if (t.intervalCount > 1) return ` every ${t.intervalCount} ${t.interval}s`;
    return ` / ${t.interval}`;
}

/** "Monthly", "Every 3 months", "Free". */
export const freq = (t: MembershipTierOption,): string =>
    t.isFree ? 'Free' : t.intervalCount > 1 ? `Every ${t.intervalCount} ${t.interval}s` : ({ day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly', } as Record<string, string>)[t.interval] ?? t.interval;
