/**
 * Partner money + status helpers — ONE definition for every partner surface:
 * the admin (Posts → Contributions, Shop → Affiliates, discount codes) and the
 * member's Profile → Partner Program (affiliate + contributions tabs). Amounts
 * are always CENTS on the wire.
 */
import { formatCurrency, } from '@sitesurge/types';

/** Cents → "$40.00" in the given currency (any case; default usd). */
export const formatMoney = (cents: number | null | undefined, currency = 'usd',): string =>
    formatCurrency(Number.isFinite(cents,) ? Number(cents,) : 0, (currency || 'usd').toUpperCase(),);

/**
 * "40" / "40.50" / "$40" / "1,000" → cents, or null when not a valid amount.
 * An EMPTY field is null (not $0) — a blank amount must never save as zero.
 * Rounded with Math.round so 19.99 → 1999 (not 1998.9999…).
 */
export const parseDollars = (v: string | number | null | undefined,): number | null => {
    const s = String(v ?? '',).replace(/[$,\s]/g, '',);
    if (s === '' || !/^\d*(\.\d*)?$/.test(s,) || s === '.') return null;
    // Decimal maths on the digits, not on a float (1.005 * 100 = 100.4999…).
    const [whole = '', frac = '',] = s.split('.',);
    const cents = Number(whole || '0',) * 100 + Math.round(Number(`${frac}000`.slice(0, 3,),) / 10,);
    return Number.isSafeInteger(cents,) ? cents : null;
};

/** Cents → "40.00" for an amount input. */
export const centsToDollarsInput = (cents: number | null | undefined,): string => ((cents ?? 0) / 100).toFixed(2,);

/** A percent input → a number within [min, max] (NaN/blank → min). */
export const clampPercent = (v: string | number | null | undefined, max = 100, min = 0,): number => {
    const n = Number(v,);
    if (v === '' || v === null || v === undefined || !Number.isFinite(n,)) return min;
    return Math.min(max, Math.max(min, n,),);
};

/** An ISO date → "Nov 6, 2026" (empty → "—"). */
export const formatDay = (iso: string | null | undefined,): string =>
    (iso ? new Date(iso,).toLocaleDateString(undefined, { dateStyle: 'medium', },) : '—');

export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed' | string;

/** A payout row's status as a partner reads it (profile). */
export const payoutStatusForPartner = (s: PayoutStatus,): string =>
    (s === 'paid' ? 'Sent' : s === 'failed' ? 'Failed — our team will retry' : 'Processing');

/** A payout row's status as staff read it (admin). */
export const payoutStatusForAdmin = (s: PayoutStatus,): string =>
    (s === 'paid' ? 'Paid' : s === 'failed' ? 'Failed' : 'Processing');

/** A partner's Stripe Connect state → label + `badge--*` tone (admin tables). */
export function stripeState(s: { connected: boolean; payoutsEnabled: boolean; },): { label: string; tone: 'success' | 'warning' | 'muted'; } {
    if (s.payoutsEnabled) return { label: 'Payouts ready', tone: 'success', };
    if (s.connected) return { label: 'Setup not finished', tone: 'warning', };
    return { label: 'Not connected', tone: 'muted', };
}

/** Automatic payout schedule → words ("weekly"). */
export const SCHEDULE_LABEL: Record<string, string> = {
    off: 'manual only',
    weekly: 'weekly',
    biweekly: 'every 2 weeks',
    monthly: 'monthly',
};
