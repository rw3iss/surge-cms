import type {
    CampaignListQuery, CampaignPublicListResponse, CampaignAdminListResponse,
    CampaignBySlugResponse, CampaignDonationsQuery, CampaignDonationsResponse,
    CampaignDonationSummaryResponse, CampaignAllDonationsQuery, CampaignAllDonationsResponse,
    CampaignByIdResponse, CampaignCreateBody, CampaignCreateResponse, CampaignUpdateBody,
    CampaignUpdateResponse, CampaignDeleteResponse, CampaignBulkBody, CampaignBulkResponse,
} from '@sitesurge/types';
import type { Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /campaigns namespace — public bare-array list + admin all-statuses list, donations. */
export class CampaignsModule extends ModuleBase {
    protected readonly module = 'campaigns';

    /** GET /campaigns — public bare array of published campaigns. */
    listPublic(query?: CampaignListQuery,): Promise<CampaignPublicListResponse> {
        return this.get<CampaignPublicListResponse>('/campaigns', { query: query as Record<string, unknown>, },);
    }

    /** GET /campaigns (admin) — passes all=true to switch to the paginated all-statuses list. */
    list(query?: CampaignListQuery,): Promise<Paginated<CampaignAdminListResponse[number]>> {
        return this.getPaged<CampaignAdminListResponse[number]>('/campaigns', { query: { all: true, ...(query as Record<string, unknown>), }, },);
    }

    /** GET /campaigns/slug/:slug — the published campaign. */
    getBySlug(slug: string,): Promise<CampaignBySlugResponse> {
        return this.get<CampaignBySlugResponse>('/campaigns/slug/:slug', { params: { slug, }, },);
    }

    /** GET /campaigns/:id/donations — masked public donations, paginated. */
    donations(id: string, query?: CampaignDonationsQuery,): Promise<Paginated<CampaignDonationsResponse[number]>> {
        return this.getPaged<CampaignDonationsResponse[number]>('/campaigns/:id/donations', { params: { id, }, query: query as Record<string, unknown>, },);
    }

    /** GET /campaigns/donations/summary — dashboard donation totals (admin). */
    donationSummary(): Promise<CampaignDonationSummaryResponse> {
        return this.get<CampaignDonationSummaryResponse>('/campaigns/donations/summary',);
    }

    /** GET /campaigns/donations/all — full donation rows (admin), paginated. */
    allDonations(query?: CampaignAllDonationsQuery,): Promise<Paginated<CampaignAllDonationsResponse[number]>> {
        return this.getPaged<CampaignAllDonationsResponse[number]>('/campaigns/donations/all', { query: query as Record<string, unknown>, },);
    }

    /** GET /campaigns/:id (admin) — the campaign at any status. */
    getById(id: string,): Promise<CampaignByIdResponse> {
        return this.get<CampaignByIdResponse>('/campaigns/:id', { params: { id, }, },);
    }

    create(body: CampaignCreateBody,): Promise<CampaignCreateResponse> {
        return this.mutate<CampaignCreateResponse>('POST', '/campaigns', { body, invalidates: ['campaigns',], },);
    }

    update(id: string, body: CampaignUpdateBody,): Promise<CampaignUpdateResponse> {
        return this.mutate<CampaignUpdateResponse>('PUT', '/campaigns/:id', { params: { id, }, body, invalidates: ['campaigns',], },);
    }

    remove(id: string,): Promise<CampaignDeleteResponse> {
        return this.mutate<CampaignDeleteResponse>('DELETE', '/campaigns/:id', { params: { id, }, invalidates: ['campaigns',], },);
    }

    bulk(body: CampaignBulkBody,): Promise<CampaignBulkResponse> {
        return this.mutate<CampaignBulkResponse>('POST', '/campaigns/bulk', { body, invalidates: ['campaigns',], },);
    }
}
