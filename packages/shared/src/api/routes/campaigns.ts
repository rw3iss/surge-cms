/**
 * Wire DTOs for the /campaigns module. Validation schemas live in
 * `packages/api/src/routes/campaigns.ts`.
 */

import type { Campaign, CampaignStatus, Donation, DonationSummary, } from '../../types/campaign';
import type { BulkActionResult, } from './_shared';

// ─── Entities carried on the wire ─────────────────────────────────

/**
 * A campaign donation as exposed on the PUBLIC per-campaign list. The
 * repo masks anonymous donors ("Anonymous") and nulls hidden messages,
 * returning only this subset — defined here because the masked shape only
 * exists on the wire. `createdAt` serializes to an ISO string.
 */
export interface PublicDonation {
    id: string;
    donorName: string | null;
    amountCents: number;
    message: string | null;
    createdAt: string;
}

// ─── GET /campaigns ───────────────────────────────────────────────

/** Query accepted by GET /campaigns. */
export interface CampaignListQuery {
    /** public: include campaigns whose end date has passed */
    includePast?: string;
    /** public: 'false' to include inactive campaigns */
    activeOnly?: string;
    sortBy?: string;
    sortOrder?: string;
    /** admin trigger: 'true' switches to the paginated all-statuses list */
    all?: string;
    /** admin filter (presence also triggers the admin list) */
    status?: string;
    page?: number;
    limit?: number;
}

/**
 * GET /campaigns (PUBLIC shape) — a bare array of published campaigns,
 * returned when neither `all=true` nor `status` is present. No pagination
 * meta.
 */
export type CampaignPublicListResponse = Campaign[];

/**
 * GET /campaigns (ADMIN shape) — list items returned when an admin passes
 * `all=true` or `status`. Page meta rides the ApiResponse envelope.
 */
export type CampaignAdminListResponse = Campaign[];

// ─── GET /campaigns/slug/:slug ────────────────────────────────────

/** Params for GET /campaigns/slug/:slug. */
export interface CampaignBySlugParams {
    slug: string;
}

/** GET /campaigns/slug/:slug — the published campaign. */
export type CampaignBySlugResponse = Campaign;

// ─── GET /campaigns/donations/summary ─────────────────────────────

/** GET /campaigns/donations/summary — dashboard donation totals. */
export type CampaignDonationSummaryResponse = DonationSummary;

// ─── GET /campaigns/donations/all ─────────────────────────────────

/** Query accepted by GET /campaigns/donations/all. */
export interface CampaignAllDonationsQuery {
    campaignId?: string;
    status?: string;
    page?: number;
    limit?: number;
}

/** GET /campaigns/donations/all — full donation rows (admin). Page meta
 *  on the envelope. */
export type CampaignAllDonationsResponse = Donation[];

// ─── GET /campaigns/:id/donations ─────────────────────────────────

/** Params for the campaign-by-id family of routes. */
export interface CampaignIdParams {
    id: string;
}

/** Query accepted by GET /campaigns/:id/donations. */
export interface CampaignDonationsQuery {
    page?: number;
    limit?: number;
}

/** GET /campaigns/:id/donations — masked public donations. Page meta on
 *  the envelope. */
export type CampaignDonationsResponse = PublicDonation[];

// ─── POST /campaigns/bulk ─────────────────────────────────────────

/** Body for POST /campaigns/bulk (unified bulk runner). */
export interface CampaignBulkBody {
    ids: string[];
    action: 'delete' | 'status';
    /** status value when action='status' */
    value?: string;
}

/** POST /campaigns/bulk — count + action performed. */
export type CampaignBulkResponse = BulkActionResult;

// ─── GET /campaigns/:id (admin) ───────────────────────────────────

/** GET /campaigns/:id — the campaign at any status. */
export type CampaignByIdResponse = Campaign;

// ─── POST /campaigns ──────────────────────────────────────────────

/** Body for POST /campaigns (create). */
export interface CampaignCreateBody {
    title: string;
    slug: string;
    description: string;
    shortDescription?: string;
    featuredImage?: string | null;
    goalAmountCents?: number | null;
    status?: CampaignStatus;
    /** ISO date-time */
    startDate?: string | null;
    /** ISO date-time */
    endDate?: string | null;
    isPublished?: boolean;
}

/** POST /campaigns (201) — the created campaign. */
export type CampaignCreateResponse = Campaign;

// ─── PUT /campaigns/:id ───────────────────────────────────────────

/** Body for PUT /campaigns/:id — partial create body. */
export type CampaignUpdateBody = Partial<CampaignCreateBody>;

/** PUT /campaigns/:id — the updated campaign. */
export type CampaignUpdateResponse = Campaign;

// ─── DELETE /campaigns/:id ────────────────────────────────────────

/** DELETE /campaigns/:id — confirmation message. */
export interface CampaignDeleteResponse {
    message: string;
}
