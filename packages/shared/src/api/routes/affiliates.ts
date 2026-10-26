/**
 * Affiliate program (`/affiliates`, feature `affiliates`, requires `shop`).
 * Members with the affiliate role (Shop Settings → Affiliate program) get
 * codes from an admin, earn a commission on paid orders that used them, and
 * are paid out to a Stripe Connect Express account.
 */
import type { ShopDiscountCode, } from './shopDiscounts';

export type AffiliatePayoutSchedule = 'off' | 'weekly' | 'biweekly' | 'monthly';

export interface AffiliateSettings {
    /** The role whose members are affiliates (default `affiliate`). */
    role: string;
    /** Days after payment before a commission can be paid out (refunds reverse it before). */
    refundWindowDays: number;
    /** Automatic payouts; a manual "Pay out" is always available. */
    payoutSchedule: AffiliatePayoutSchedule;
    /** Default commission % for a new affiliate code. */
    defaultCommissionPercent: number;
    /** Last automatic payout run (ISO), for the schedule. */
    lastAutoPayoutAt?: string | null;
}
export type AffiliateSettingsBody = Partial<Omit<AffiliateSettings, 'lastAutoPayoutAt'>>;

/** The Stripe Connect Express account of an affiliate. */
export interface AffiliateStripeStatus {
    connected: boolean;
    detailsSubmitted: boolean;
    payoutsEnabled: boolean;
}

/** Money totals (cents). `pending` = still inside the refund window. */
export interface AffiliateBalance {
    pendingCents: number;
    availableCents: number;
    paidCents: number;
    currency: string;
}

/** An affiliate code as its owner sees it. */
export interface AffiliateCode {
    id: string;
    code: string;
    active: boolean;
    /** Total share of the merchandise subtotal (set by an admin). */
    commissionPercent: number;
    /** The part of it given to buyers as a discount (chosen by the affiliate). */
    buyerDiscountPercent: number;
    maxUses: number | null;
    uses: number;
    appliesToTickets: boolean;
    /** `/shop?code=…` on this site. */
    shareUrl: string;
}

/** One commission (or reversal) — no buyer details. */
export interface AffiliateEarning {
    id: string;
    orderNumber: string;
    code: string | null;
    kind: 'commission' | 'reversal';
    merchSubtotalCents: number;
    sharePercent: number;
    amountCents: number;
    currency: string;
    /** `pending` (refund window) | `available` | `paid` | `reversed`. */
    status: 'pending' | 'available' | 'paid' | 'reversed';
    availableAt: string;
    createdAt: string;
}

export interface AffiliatePayout {
    id: string;
    amountCents: number;
    currency: string;
    status: 'pending' | 'paid' | 'failed';
    trigger: 'manual' | 'auto';
    error: string | null;
    createdAt: string;
}

/** GET /affiliates/me — the signed-in affiliate's page. */
export interface AffiliateMeResponse {
    stripe: AffiliateStripeStatus;
    balance: AffiliateBalance;
    codes: AffiliateCode[];
    earnings: AffiliateEarning[];
    payouts: AffiliatePayout[];
    refundWindowDays: number;
    payoutSchedule: AffiliatePayoutSchedule;
}

/** PUT /affiliates/me/codes/:id — the buyer discount split. */
export interface AffiliateCodeSplitBody { buyerDiscountPercent: number; }

/** A Stripe onboarding / dashboard link. */
export interface AffiliateLinkResponse { url: string; }

/** Admin: one affiliate (a user with the affiliate role). */
export interface AffiliateMember {
    userId: string;
    displayName: string;
    email: string;
    stripe: AffiliateStripeStatus;
    balance: AffiliateBalance;
    codes: ShopDiscountCode[];
    /** Paid orders with their codes, and their merchandise total. */
    orders: number;
    salesCents: number;
}

/** Admin: one affiliate's detail (members list row + history). */
export interface AffiliateMemberDetail extends AffiliateMember {
    earnings: AffiliateEarning[];
    payouts: AffiliatePayout[];
}

/** Admin: program-wide numbers (Shop dashboard card). */
export interface AffiliateStats {
    members: number;
    salesCents30d: number;
    commissionCents30d: number;
    owedCents: number;
    availableCents: number;
    currency: string;
}

/** POST /affiliates/admin/members/:userId/payout result. */
export interface AffiliatePayoutResult {
    paid: boolean;
    amountCents: number;
    message: string;
}
