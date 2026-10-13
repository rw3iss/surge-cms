/** Shared tier price formatting for the profile Membership tab, /subscribe and sign-up. */
import type { MembershipTierOption, TierDisplayPrice, } from '@sitesurge/types';

export function money(cents: number, currency = 'usd',): string {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), },).format(cents / 100,);
}

interface Billing { isFree: boolean; interval: string; intervalCount: number; }

/** " / month", " every 2 weeks", '' for free. */
export function per(t: Billing,): string {
    if (t.isFree) return '';
    if (t.interval === 'week' && t.intervalCount === 2) return ' bi-weekly';
    if (t.intervalCount > 1) return ` every ${t.intervalCount} ${t.interval}s`;
    return ` / ${t.interval}`;
}

/** "Monthly", "Every 2 weeks", "Free". */
export function freqOf(t: Billing,): string {
    if (t.isFree) return 'Free';
    if (t.interval === 'week' && t.intervalCount === 2) return 'Bi-weekly';
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

// ─── Alternative prices (one level, several Stripe prices: monthly / yearly …) ──

type PriceOpt = { priceId: string; amount: number; currency: string; interval: string; intervalCount: number; isDefault: boolean; };

/** "$250 / year", "$25 / month". */
export const priceOptionLabel = (p: PriceOpt,): string => `${money(p.amount, p.currency,)}${per({ isFree: false, interval: p.interval, intervalCount: p.intervalCount, },)}`;

/** Short frequency for a price chip: "Monthly", "Yearly", "Every 2 weeks". */
export const priceOptionFreq = (p: PriceOpt,): string => freqOf({ isFree: false, interval: p.interval, intervalCount: p.intervalCount, },);

/** The level re-priced to one of its prices (client twin of the server's `withPrice`). */
export function tierAtPrice(t: MembershipTierOption, priceId?: string | null,): MembershipTierOption {
    const prices = t.prices ?? [];
    if (t.isFree || !prices.length || !priceId) return t;
    const p = prices.find((x,) => x.priceId === priceId,);
    if (!p) return t;
    return { ...t, priceCents: p.amount, currency: p.currency, interval: p.interval, intervalCount: p.intervalCount, selectedPriceId: p.priceId, display: p.isDefault ? t.display : null, };
}

/** The level's default price id (what "no choice" means). */
export const defaultPriceId = (t: MembershipTierOption,): string | null =>
    (t.prices ?? []).find((p,) => p.isDefault,)?.priceId ?? t.selectedPriceId ?? null;

/**
 * The price shown BIG (and selected first). Normally the default. But when the
 * level's custom display price is identical to one of its REAL prices (e.g. a
 * $3,000/month display over a bi-weekly default, plus a real $3,000/month
 * price), that real price leads — otherwise two options read the same, and the
 * default then shows its true billing ("$1,500 every 2 weeks") as a chip.
 */
export function leadPriceId(t: MembershipTierOption,): string | null {
    const d = t.display;
    if (d) {
        const twin = (t.prices ?? []).find((p,) => !p.isDefault && p.amount === d.priceCents && p.interval === d.interval && p.intervalCount === d.intervalCount,);
        if (twin) return twin.priceId;
    }
    return defaultPriceId(t,);
}
