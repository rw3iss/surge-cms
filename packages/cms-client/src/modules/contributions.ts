import type {
    Contribution, ContributionListQuery, ContributionPayoutsResponse, ContributionSummary, ContributorSettings, ContributorSettingsBody, Paginated,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * contributions namespace — contributor payouts (admin). Approve a post with a
 * payout through `cms.posts.review(id, { action: 'approve', payoutCents })`.
 * Needs `contributions:manage` (settings READ: any staff).
 */
export class ContributionsModule extends ModuleBase {
    protected readonly module = 'contributions';

    /** GET /contributions/settings */
    settings(): Promise<ContributorSettings> {
        return this.get('/contributions/settings', { options: { cache: false, }, },);
    }

    /** PUT /contributions/settings */
    updateSettings(body: ContributorSettingsBody,): Promise<ContributorSettings> {
        return this.mutate('PUT', '/contributions/settings', { body, invalidates: ['contributions',], },);
    }

    /** GET /contributions/summary — counts, money owed / payable / paid, contributors. */
    summary(): Promise<ContributionSummary> {
        return this.get('/contributions/summary', { options: { cache: false, }, },);
    }

    /** GET /contributions — contributed posts (filter by state / author / search, sort, paginate). */
    list(query: ContributionListQuery = {},): Promise<Paginated<Contribution>> {
        return this.getPaged<Contribution>('/contributions', { query: query as Record<string, unknown>, options: { cache: false, }, },);
    }

    /** GET /contributions/:postId */
    byPost(postId: string,): Promise<Contribution> {
        return this.get('/contributions/:postId', { params: { postId, }, options: { cache: false, }, },);
    }

    /** PUT /contributions/:postId/payout — credit or change the payout (not once paid). */
    setPayout(postId: string, amountCents: number,): Promise<Contribution> {
        return this.mutate('PUT', '/contributions/:postId/payout', { params: { postId, }, body: { amountCents, }, invalidates: ['contributions',], },);
    }

    /** POST /contributions/:postId/revoke — revoke an unpaid payout. */
    revoke(postId: string,): Promise<Contribution> {
        return this.mutate('POST', '/contributions/:postId/revoke', { params: { postId, }, invalidates: ['contributions',], },);
    }

    /** POST /contributions/:postId/unpublish — back to draft (the payout is left as is). */
    unpublish(postId: string,): Promise<Contribution> {
        return this.mutate('POST', '/contributions/:postId/unpublish', { params: { postId, }, invalidates: ['contributions', 'posts',], },);
    }

    /** POST /contributions/payouts — pay the listed contributors (else everyone payable). */
    payOut(userIds?: string[],): Promise<ContributionPayoutsResponse> {
        return this.mutate('POST', '/contributions/payouts', { body: userIds?.length ? { userIds, } : {}, invalidates: ['contributions',], },);
    }
}
