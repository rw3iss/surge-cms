import type {
    AffiliateCode, AffiliateLinkResponse, AffiliateMeResponse, AffiliateMember, AffiliateMemberDetail, AffiliatePayoutResult,
    AffiliateSettings, AffiliateSettingsBody, AffiliateStats, AffiliateStripeStatus, ShopDiscountCode, ShopDiscountCodeBody,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * affiliates namespace (feature `affiliates`, requires `shop`). `me*` is the
 * signed-in affiliate's own page; `admin*` + settings need `affiliates:manage`.
 * Affiliate codes are discount codes — edit/delete them with `cms.shop.discounts`.
 */
export class AffiliatesModule extends ModuleBase {
    protected readonly module = 'affiliates';

    /** GET /affiliates/me/status — is the caller an affiliate? */
    status(): Promise<{ affiliate: boolean; }> {
        return this.get('/affiliates/me/status', { options: { cache: false, }, },);
    }

    /** GET /affiliates/me — Stripe status, balance, codes, commissions, payouts. */
    me(): Promise<AffiliateMeResponse> {
        return this.get('/affiliates/me', { options: { cache: false, }, },);
    }

    /** PUT /affiliates/me/codes/:id — how much of the commission buyers get as a discount. */
    setCodeSplit(id: string, buyerDiscountPercent: number,): Promise<AffiliateCode> {
        return this.mutate('PUT', '/affiliates/me/codes/:id', { params: { id, }, body: { buyerDiscountPercent, }, invalidates: ['affiliates',], },);
    }

    /** POST /affiliates/me/stripe/onboard — the Stripe Express onboarding link. */
    stripeOnboard(): Promise<AffiliateLinkResponse> {
        return this.mutate('POST', '/affiliates/me/stripe/onboard', {},);
    }

    /** POST /affiliates/me/stripe/dashboard — a one-time Express dashboard link. */
    stripeDashboard(): Promise<AffiliateLinkResponse> {
        return this.mutate('POST', '/affiliates/me/stripe/dashboard', {},);
    }

    /** POST /affiliates/me/stripe/refresh — re-read the Stripe account status. */
    stripeRefresh(): Promise<AffiliateStripeStatus> {
        return this.mutate('POST', '/affiliates/me/stripe/refresh', { invalidates: ['affiliates',], },);
    }

    /** GET /affiliates/settings */
    settings(): Promise<AffiliateSettings> {
        return this.get('/affiliates/settings', { options: { cache: false, }, },);
    }

    /** PUT /affiliates/settings */
    updateSettings(body: AffiliateSettingsBody,): Promise<AffiliateSettings> {
        return this.mutate('PUT', '/affiliates/settings', { body, invalidates: ['affiliates',], },);
    }

    /** GET /affiliates/admin/stats */
    adminStats(): Promise<AffiliateStats> {
        return this.get('/affiliates/admin/stats', { options: { cache: false, }, },);
    }

    /** GET /affiliates/admin/members */
    adminMembers(): Promise<AffiliateMember[]> {
        return this.get('/affiliates/admin/members', { options: { cache: false, }, },);
    }

    /** GET /affiliates/admin/members/:userId */
    adminMember(userId: string,): Promise<AffiliateMemberDetail> {
        return this.get('/affiliates/admin/members/:userId', { params: { userId, }, options: { cache: false, }, },);
    }

    /** POST /affiliates/admin/members/:userId/codes — give an affiliate a code. */
    adminCreateCode(userId: string, body: ShopDiscountCodeBody,): Promise<ShopDiscountCode> {
        return this.mutate('POST', '/affiliates/admin/members/:userId/codes', { params: { userId, }, body, invalidates: ['affiliates', 'shop',], },);
    }

    /** POST /affiliates/admin/members/:userId/payout — pay out their payable commission now. */
    adminPayout(userId: string,): Promise<AffiliatePayoutResult> {
        return this.mutate('POST', '/affiliates/admin/members/:userId/payout', { params: { userId, }, invalidates: ['affiliates',], },);
    }
}
