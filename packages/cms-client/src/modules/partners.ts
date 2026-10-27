import type { AffiliateLinkResponse, AffiliateStripeStatus, PartnerMeResponse, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * partners namespace — the member's Partner Program page (affiliates +
 * contributors): one Stripe Connect Express account, totals, contributions.
 */
export class PartnersModule extends ModuleBase {
    protected readonly module = 'partners';

    /** GET /partners/me/status — which programs the caller is in. */
    status(): Promise<{ affiliate: boolean; contributor: boolean; }> {
        return this.get('/partners/me/status', { options: { cache: false, }, },);
    }

    /** GET /partners/me — programs, Stripe account, totals, contributions. */
    me(): Promise<PartnerMeResponse> {
        return this.get('/partners/me', { options: { cache: false, }, },);
    }

    /** POST /partners/me/stripe/onboard — the Stripe Express onboarding link. */
    stripeOnboard(): Promise<AffiliateLinkResponse> {
        return this.mutate('POST', '/partners/me/stripe/onboard', {},);
    }

    /** POST /partners/me/stripe/dashboard — a one-time Express dashboard link. */
    stripeDashboard(): Promise<AffiliateLinkResponse> {
        return this.mutate('POST', '/partners/me/stripe/dashboard', {},);
    }

    /** POST /partners/me/stripe/refresh — re-read the Stripe account status. */
    stripeRefresh(): Promise<AffiliateStripeStatus> {
        return this.mutate('POST', '/partners/me/stripe/refresh', {},);
    }
}
