/**
 * CONTRIBUTOR compensation + the PARTNER overview (`/api/v1/contributions`,
 * `/api/v1/partners`). A contributor's post that an admin approves earns the
 * default payout (Posts → Settings → Contributions) or an override; it is
 * paid out through the shared partner layer (Stripe Connect Express — the
 * same account affiliates use). Guide: docs/how-it-works/CONTRIBUTOR-PAYOUTS.md.
 */
import type { AffiliatePayout, AffiliatePayoutResult, AffiliatePayoutSchedule, AffiliateStripeStatus, } from './affiliates';

export interface ContributorSettings {
    /** Pay contributors for approved posts. */
    enabled: boolean;
    /** Credited for each approved contribution unless overridden (cents). */
    defaultPayoutCents: number;
    currency: string;
    /** Days after approval before an earning can be paid out. */
    holdDays: number;
    /** Automatic payouts; a manual Pay out is always available. */
    payoutSchedule: AffiliatePayoutSchedule;
    lastAutoPayoutAt?: string | null;
    /** The shared Connect webhook signing secret (partner settings), masked when read. */
    connectWebhookSecret?: string;
}
export type ContributorSettingsBody = Partial<Omit<ContributorSettings, 'lastAutoPayoutAt'>>;

/** An earning's state: `pending` = in its holding period, `available` = payable now. */
export type ContributionEarningStatus = 'pending' | 'available' | 'paid' | 'revoked';

export interface ContributionEarning {
    id: string;
    amountCents: number;
    currency: string;
    status: ContributionEarningStatus;
    availableAt: string;
    paidAt: string | null;
    createdAt: string;
}

/** The contribution state used by the filters. */
export type ContributionState = 'pending_review' | 'returned' | 'approved' | 'paid' | 'revoked';

export interface Contribution {
    postId: string;
    title: string;
    slug: string;
    postStatus: string;
    state: ContributionState;
    author: { id: string; name: string; email: string; } | null;
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewNote: string | null;
    updatedAt: string;
    earning: ContributionEarning | null;
}

export interface ContributionListQuery {
    state?: ContributionState | 'all';
    authorId?: string;
    search?: string;
    /** `submitted_desc` (default) | `submitted_asc` | `title_asc` | `title_desc` | `amount_desc` | `amount_asc` | `author_asc` | `author_desc`. */
    sort?: string;
    page?: number;
    limit?: number;
}

export interface ContributorBalance {
    userId: string;
    name: string;
    email: string;
    approvedCount: number;
    pendingReviewCount: number;
    pendingCents: number;
    availableCents: number;
    paidCents: number;
    stripe: AffiliateStripeStatus;
}

export interface ContributionSummary {
    counts: Record<ContributionState, number>;
    /** Earned, not paid yet (holding + payable). */
    owedCents: number;
    payableCents: number;
    paidCents: number;
    currency: string;
    contributors: ContributorBalance[];
}

export interface ContributionPayoutBody { amountCents: number; }
export interface ContributionReviewBody { action: 'approve' | 'return'; note?: string; /** Override the default payout for this post (cents). */ payoutCents?: number; }
export interface ContributionPayoutsBody { /** Pay these contributors; omitted = everyone with a payable balance. */ userIds?: string[]; }
export interface ContributionPayoutsResponse { results: Array<AffiliatePayoutResult & { userId: string; name: string; }>; }

/** Profile → Partner Program. */
export interface PartnerMeResponse {
    programs: { affiliate: boolean; contributor: boolean; };
    stripe: AffiliateStripeStatus;
    /** Across the programs. */
    totals: { pendingCents: number; availableCents: number; paidCents: number; currency: string; };
    contributions: null | {
        defaultPayoutCents: number;
        holdDays: number;
        items: Contribution[];
        payouts: AffiliatePayout[];
        balance: { pendingCents: number; availableCents: number; paidCents: number; currency: string; };
    };
}
