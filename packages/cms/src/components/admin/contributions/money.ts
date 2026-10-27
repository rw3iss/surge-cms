/** Cents ↔ display helpers for the contributor payout admin. */
export const formatMoney = (cents: number | null | undefined, currency = 'usd',): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase(), },).format((cents ?? 0) / 100,);

/** "40" / "40.50" / "$40" → cents, or null when not a valid amount. */
export const parseDollars = (v: string,): number | null => {
    const n = Number(String(v,).replace(/[$,\s]/g, '',),);
    return Number.isFinite(n,) && n >= 0 ? Math.round(n * 100,) : null;
};

export const centsToDollarsInput = (cents: number | null | undefined,): string => ((cents ?? 0) / 100).toFixed(2,);
