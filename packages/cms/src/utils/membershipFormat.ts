/** Shared tier price formatting for the profile Membership tab, /subscribe and sign-up. */
import type { MembershipTierOption, TierDisplayPrice, } from '@sitesurge/types';

export function money(cents: number, currency = 'usd',): string {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), },).format(cents / 100,);
}

interface Billing { isFree: boolean; interval: string; intervalCount: number; }

/** " / month", " every 2 weeks", '' for free. */
export function per(t: Billing,): string {
    if (t.isFree) return '';
    if (t.intervalCount > 1) return ` every ${t.intervalCount} ${t.interval}s`;
    return ` / ${t.interval}`;
}

/** "Monthly", "Every 2 weeks", "Free". */
export function freqOf(t: Billing,): string {
    if (t.isFree) return 'Free';
    if (t.intervalCount > 1) return `Every ${t.intervalCount} ${t.interval}s`;
    return ({ day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly', } as Record<string, string>)[t.interval] ?? t.interval;
}

type Priced = Billing & { priceCents: number; currency: string; display?: TierDisplayPrice | null; };

/**
 * What members SEE: the tier's custom price display when the admin set one,
 * else the Stripe billing price. Stripe always bills the billing price.
 */
export function shown(t: Priced,): Priced {
    if (t.isFree || !t.display) return t;
    return { ...t, priceCents: t.display.priceCents, interval: t.display.interval, intervalCount: t.display.intervalCount, display: null, };
}

/** "$3,000.00 / month" for what members see. */
export const shownPrice = (t: Priced,): string => (t.isFree ? 'Free' : `${money(shown(t,).priceCents, t.currency,)}${per(shown(t,),)}`);

/** Card frequency label, using the custom display when set. */
export const freq = (t: MembershipTierOption,): string => freqOf(shown(t,),);

/**
 * "Billed $1,500.00 every 2 weeks" — only when a custom display is set, so the
 * real charge is always visible next to the shown price.
 */
export function billedNote(t: Priced,): string {
    if (t.isFree || !t.display) return '';
    return `Billed ${money(t.priceCents, t.currency,)}${per(t,)}`;
}
