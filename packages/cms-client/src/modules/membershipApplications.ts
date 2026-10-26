import type {
    MembershipApplication, MembershipApplicationDecisionBody, MembershipApplicationsListQuery, MembershipApplicationsSummaryResponse, Paginated,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * membershipApplications namespace (admin + `memberships.applications:review`)
 * — applications for membership levels that require approval. Members apply
 * with `cms.payments.applyMembership`.
 */
export class MembershipApplicationsModule extends ModuleBase {
    protected readonly module = 'membershipApplications';

    /** GET /membership-applications (?status=pending, ?userId=) */
    list(query: MembershipApplicationsListQuery = {},): Promise<Paginated<MembershipApplication>> {
        return this.getPaged<MembershipApplication>('/membership-applications', { query: query as Record<string, unknown>, options: { cache: false, }, },);
    }

    /** GET /membership-applications/summary — `{ pending }` for the Users header. */
    summary(): Promise<MembershipApplicationsSummaryResponse> {
        return this.get<MembershipApplicationsSummaryResponse>('/membership-applications/summary', { options: { cache: false, }, },);
    }

    /** GET /membership-applications/:id — answers, tier and saved card. */
    getById(id: string,): Promise<MembershipApplication> {
        return this.get<MembershipApplication>('/membership-applications/:id', { params: { id, }, options: { cache: false, }, },);
    }

    /** POST /membership-applications/:id/approve — start the membership and charge the saved card now. */
    approve(id: string, body: MembershipApplicationDecisionBody = {},): Promise<MembershipApplication> {
        return this.mutate<MembershipApplication>('POST', '/membership-applications/:id/approve', { params: { id, }, body, invalidates: ['membershipApplications', 'users',], },);
    }

    /** POST /membership-applications/:id/link — link an account-less application to the account that uses its email. */
    link(id: string, userId: string,): Promise<MembershipApplication> {
        return this.mutate<MembershipApplication>('POST', '/membership-applications/:id/link', { params: { id, }, body: { userId, }, invalidates: ['membershipApplications', 'users',], },);
    }

    /** POST /membership-applications/:id/withdraw-offer — withdraw an approved, unstarted offer (hide-price levels). */
    withdrawOffer(id: string,): Promise<MembershipApplication> {
        return this.mutate<MembershipApplication>('POST', '/membership-applications/:id/withdraw-offer', { params: { id, }, invalidates: ['membershipApplications', 'users',], },);
    }

    /** POST /membership-applications/:id/reject — nothing is charged; the applicant is emailed. */
    reject(id: string, body: MembershipApplicationDecisionBody = {},): Promise<MembershipApplication> {
        return this.mutate<MembershipApplication>('POST', '/membership-applications/:id/reject', { params: { id, }, body, invalidates: ['membershipApplications', 'users',], },);
    }
}
