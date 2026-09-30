export type CampaignStatus = 'draft' | 'active' | 'completed' | 'cancelled';

export interface Campaign {
    id: string;
    title: string;
    slug: string;
    description: string;
    shortDescription?: string;
    featuredImage?: string;
    /** The media item behind `featuredImage` (title, description, credits…). */
    featuredMedia?: import('./content').MediaRef | null;
    goalAmountCents: number;
    /** When false, public renderings hide all monetary info (raised + goal). */
    showRaisedAmount: boolean;
    /** Show a Recent Donors list (most recent first) under the raised amount.
     *  Each donation's visibility applies: anonymous → "Anonymous", hidden → omitted. */
    showDonorListing?: boolean;
    currentAmountCents: number;
    status: CampaignStatus;
    startDate?: Date;
    endDate?: Date;
    donorCount: number;
    isPublished: boolean;
    /** Which system collects donations for this campaign. 'internal' = the
     *  built-in Stripe flow (default); 'givebutter' = the GiveButter plugin's
     *  embedded widget (only meaningful when that plugin is enabled). */
    donationProvider: DonationProvider;
    /** GiveButter numeric campaign id (API), when linked/created. */
    givebutterCampaignId?: number | null;
    /** GiveButter 6-char campaign code used by the embed widget. */
    givebutterCampaignCode?: string | null;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

export type DonationProvider = 'internal' | 'givebutter';

export type DonationVisibility = 'public' | 'anonymous' | 'hidden';

export interface Donation {
    id: string;
    campaignId?: string;
    userId?: string;
    donorName?: string;
    donorEmail: string;
    amountCents: number;
    message?: string;
    visibility: DonationVisibility;
    stripePaymentIntentId: string;
    stripeChargeId?: string;
    status: 'pending' | 'completed' | 'failed' | 'refunded';
    metadata?: Record<string, unknown>;
    createdAt: Date;
}

export interface DonationIntent {
    campaignId?: string;
    amountCents: number;
    donorName?: string;
    donorEmail: string;
    message?: string;
    visibility: DonationVisibility;
}

export interface CampaignStats {
    totalRaised: number;
    totalDonors: number;
    averageDonation: number;
    largestDonation: number;
    recentDonations: Donation[];
    progressPercentage: number;
}

export interface DonationSummary {
    totalAllTime: number;
    totalThisMonth: number;
    totalThisYear: number;
    campaignBreakdown: Array<{
        campaignId: string;
        campaignTitle: string;
        total: number;
    }>;
    generalDonations: number;
}
