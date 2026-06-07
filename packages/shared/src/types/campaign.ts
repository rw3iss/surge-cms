export type CampaignStatus = 'draft' | 'active' | 'completed' | 'cancelled';

export interface Campaign {
    id: string;
    title: string;
    slug: string;
    description: string;
    shortDescription?: string;
    featuredImage?: string;
    goalAmountCents: number;
    currentAmountCents: number;
    status: CampaignStatus;
    startDate?: Date;
    endDate?: Date;
    donorCount: number;
    isPublished: boolean;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

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
