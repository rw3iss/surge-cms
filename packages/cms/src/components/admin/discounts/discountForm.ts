/**
 * The discount-code modal's form → request body, with the checks the server
 * also makes (services/shop/discounts.ts) so a mistake is named in the modal
 * before a round trip. Pure — tested in discountForm.test.ts.
 */
import type { ShopDiscountCodeBody, } from '@sitesurge/types';
import { clampPercent, parseDollars, } from '../contributions/money';

/** Same rule as the server's CODE_RE. */
export const DISCOUNT_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

export interface DiscountDraft {
    code: string;
    kind: 'percent' | 'fixed';
    percent: number | string;
    amountDollars: string;
    active: boolean;
    maxUses: string;
    maxUsesPerUser: string;
    minSubtotal: string;
    startsAt: string;
    endsAt: string;
    allowedTierIds: string[];
    allowedRoles: string[];
    appliesToTickets: boolean;
    commissionPercent: number | string;
    note: string;
}

/** `2026-11-01T09:30` (datetime-local, local time) ↔ ISO. */
export const toLocalInput = (iso: string | null | undefined,): string => {
    if (!iso) return '';
    const d = new Date(iso,);
    if (Number.isNaN(d.getTime(),)) return '';
    const pad = (n: number,) => String(n,).padStart(2, '0',);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1,)}-${pad(d.getDate(),)}T${pad(d.getHours(),)}:${pad(d.getMinutes(),)}`;
};
export const fromLocalInput = (v: string,): string | null => {
    if (!v) return null;
    const d = new Date(v,);
    return Number.isNaN(d.getTime(),) ? null : d.toISOString();
};

/** Blank → null (unlimited); else a whole number ≥ 1, or undefined when invalid. */
const usesLimit = (v: string,): number | null | undefined => {
    const t = String(v ?? '',).trim();
    if (t === '') return null;
    const n = Number(t,);
    return Number.isInteger(n,) && n >= 1 ? n : undefined;
};

export type DiscountFormResult = { ok: true; body: ShopDiscountCodeBody; } | { ok: false; error: string; };

export function buildDiscountBody(d: DiscountDraft, affiliate: boolean,): DiscountFormResult {
    const code = d.code.trim();
    if (!code) return { ok: false, error: 'Enter a code.', };
    if (!DISCOUNT_CODE_RE.test(code,)) return { ok: false, error: 'A code is 3–64 letters, digits, - or _, and starts with a letter or digit.', };

    const kind = affiliate ? 'percent' : d.kind;
    const percent = clampPercent(d.percent,);
    let commission: number | undefined;
    let amountCents = 0;
    if (affiliate) {
        commission = clampPercent(d.commissionPercent,);
        if (percent > commission) return { ok: false, error: 'The buyer discount cannot be more than the commission (it is paid out of it).', };
    } else if (kind === 'percent') {
        if (percent <= 0) return { ok: false, error: 'Enter a percent off above 0.', };
    } else {
        const cents = parseDollars(d.amountDollars,);
        if (cents === null || cents <= 0) return { ok: false, error: 'Enter an amount off above 0, e.g. 5 or 5.00.', };
        amountCents = cents;
    }

    const maxUses = usesLimit(d.maxUses,);
    if (maxUses === undefined) return { ok: false, error: 'Maximum uses must be a whole number of 1 or more (or empty).', };
    const maxUsesPerUser = usesLimit(d.maxUsesPerUser,);
    if (maxUsesPerUser === undefined) return { ok: false, error: 'Uses per buyer must be a whole number of 1 or more (or empty).', };

    let minSubtotalCents: number | null = null;
    if (d.minSubtotal.trim() !== '') {
        minSubtotalCents = parseDollars(d.minSubtotal,);
        if (minSubtotalCents === null) return { ok: false, error: 'Minimum order must be an amount, e.g. 25 or 25.00 (or empty).', };
    }

    const startsAt = fromLocalInput(d.startsAt,);
    const endsAt = fromLocalInput(d.endsAt,);
    if (startsAt && endsAt && endsAt <= startsAt) return { ok: false, error: 'The end must be after the start.', };

    return {
        ok: true,
        body: {
            code,
            kind,
            percent: kind === 'percent' ? percent : 0,
            amountCents,
            active: d.active,
            maxUses,
            maxUsesPerUser,
            minSubtotalCents,
            startsAt,
            endsAt,
            allowedTierIds: d.allowedTierIds,
            allowedRoles: d.allowedRoles,
            appliesToTickets: d.appliesToTickets,
            note: d.note.trim() || null,
            ...(affiliate ? { commissionPercent: commission, } : {}),
        },
    };
}
