/**
 * Shop discount codes (`/shop/discounts`, admin) + the public code check.
 * One engine for site-wide codes and affiliate codes — an affiliate code is a
 * code with `affiliateUserId` + `commissionPercent` (see ./affiliates.ts).
 */

export type ShopDiscountKind = 'percent' | 'fixed';

export interface ShopDiscountCode {
    id: string;
    code: string;
    kind: ShopDiscountKind;
    /** Percent off (0–100) when `kind` = percent. For an affiliate code this is
     *  the buyer discount, which comes out of the affiliate's commission. */
    percent: number;
    /** Cents off when `kind` = fixed. */
    amountCents: number;
    active: boolean;
    startsAt: string | null;
    endsAt: string | null;
    /** Total paid uses allowed (null = unlimited). */
    maxUses: number | null;
    maxUsesPerUser: number | null;
    minSubtotalCents: number | null;
    /** Only buyers on one of these membership levels (empty = anyone). */
    allowedTierIds: string[];
    /** Only buyers with one of these roles (main or additional; empty = anyone). */
    allowedRoles: string[];
    /** Always applies to merchandise; true = ALSO to event tickets. */
    appliesToTickets: boolean;
    /** Affiliate codes: the member credited with the sales. */
    affiliateUserId: string | null;
    affiliate?: { id: string; displayName: string; email: string; } | null;
    /** Affiliate codes: their total share of the merchandise subtotal (0–100). */
    commissionPercent: number | null;
    note: string | null;
    /** Paid orders that used it (refunded ones excluded). */
    uses: number;
    createdAt: string;
    updatedAt: string;
}

/** Create / update body (PUT is partial). */
export interface ShopDiscountCodeBody {
    code?: string;
    kind?: ShopDiscountKind;
    percent?: number;
    amountCents?: number;
    active?: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
    maxUses?: number | null;
    maxUsesPerUser?: number | null;
    minSubtotalCents?: number | null;
    allowedTierIds?: string[];
    allowedRoles?: string[];
    appliesToTickets?: boolean;
    affiliateUserId?: string | null;
    commissionPercent?: number | null;
    note?: string | null;
}

/** GET /shop/discounts query. */
export interface ShopDiscountListQuery {
    /** `site` = codes without an affiliate; `affiliate` = affiliate codes only. */
    type?: 'site' | 'affiliate';
    affiliateUserId?: string;
    search?: string;
}

/** One paid use of a code (admin detail). */
export interface ShopDiscountRedemption {
    orderId: string;
    orderNumber: string;
    discountCents: number;
    merchSubtotalCents: number;
    status: 'paid' | 'refunded';
    createdAt: string;
}

/** POST /shop/discounts/check — is this code usable by the caller (before totals)? */
export interface ShopDiscountCheckBody { code: string; }
export interface ShopDiscountCheckResponse {
    valid: boolean;
    code?: string;
    summary?: string;
    message?: string;
}
