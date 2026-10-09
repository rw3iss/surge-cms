import type {
    RoleCreateBody, RoleDef, RoleUpdateBody, StripeSubscriptionPricesResponse, SubscriptionTier, SubscriptionTierBody, SubscriptionTierOption,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/** roles namespace (admin) — built-in + custom roles. Writes need `roles:manage`. */
export class RolesModule extends ModuleBase {
    protected readonly module = 'roles';

    /** GET /roles — every role, with user counts. */
    list(): Promise<RoleDef[]> {
        return this.get<RoleDef[]>('/roles', { options: { cache: false, }, },);
    }

    /** POST /roles — a custom role (inherits a member-level base role). */
    create(body: RoleCreateBody,): Promise<RoleDef> {
        return this.mutate<RoleDef>('POST', '/roles', { body, invalidates: ['roles', 'permissions',], },);
    }

    /** PUT /roles/:key — label / description / base role of a custom role. */
    update(key: string, body: RoleUpdateBody,): Promise<RoleDef> {
        return this.mutate<RoleDef>('PUT', '/roles/:key', { params: { key, }, body, invalidates: ['roles', 'permissions',], },);
    }

    /** DELETE /roles/:key — refused while users or a subscription use it. */
    remove(key: string,): Promise<{ deleted: boolean; }> {
        return this.mutate<{ deleted: boolean; }>('DELETE', '/roles/:key', { params: { key, }, invalidates: ['roles', 'permissions',], },);
    }
}

/** subscriptionTiers namespace (admin) — what subscribers get. Writes need `subscriptions:manage`. */
export class SubscriptionTiersModule extends ModuleBase {
    protected readonly module = 'subscriptionTiers';

    /** GET /subscription-tiers */
    list(): Promise<SubscriptionTier[]> {
        return this.get<SubscriptionTier[]>('/subscription-tiers', { options: { cache: false, }, },);
    }

    /** GET /subscription-tiers/options (staff) — the tier picker for gating content, lowest rank first. */
    options(): Promise<SubscriptionTierOption[]> {
        return this.get<SubscriptionTierOption[]>('/subscription-tiers/options', { options: { cache: false, }, },);
    }

    /** GET /subscription-tiers/:id */
    getById(id: string,): Promise<SubscriptionTier> {
        return this.get<SubscriptionTier>('/subscription-tiers/:id', { params: { id, }, options: { cache: false, }, },);
    }

    /** GET /subscription-tiers/stripe-prices — recurring prices in the connected Stripe account. */
    stripePrices(): Promise<StripeSubscriptionPricesResponse> {
        return this.get<StripeSubscriptionPricesResponse>('/subscription-tiers/stripe-prices', { options: { cache: false, }, },);
    }

    /** POST /subscription-tiers */
    create(body: SubscriptionTierBody,): Promise<SubscriptionTier> {
        return this.mutate<SubscriptionTier>('POST', '/subscription-tiers', { body, invalidates: ['subscriptionTiers',], },);
    }

    /** PUT /subscription-tiers/:id — `permissions` replaces the extra grants. */
    update(id: string, body: SubscriptionTierBody,): Promise<SubscriptionTier> {
        return this.mutate<SubscriptionTier>('PUT', '/subscription-tiers/:id', { params: { id, }, body, invalidates: ['subscriptionTiers', 'users',], },);
    }

    /** DELETE /subscription-tiers/:id — only a tier that never had subscribers. */
    remove(id: string,): Promise<{ deleted: boolean; }> {
        return this.mutate<{ deleted: boolean; }>('DELETE', '/subscription-tiers/:id', { params: { id, }, invalidates: ['subscriptionTiers',], },);
    }
}
