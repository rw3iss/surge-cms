/**
 * Frontend mirror of `backend/src/features/registry.ts`. Kept in sync
 * by hand because the backend is a separate workspace — the only fields
 * the frontend needs are presentation metadata (label, description,
 * requires graph). The runtime "enabled" state comes from
 * `siteSettings.features.<key>.enabled`.
 */

export type FeatureKey =
    | 'patreon' | 'posts' | 'campaigns' | 'forms' | 'messages' | 'users'
    | 'mailing_lists' | 'shop' | 'plugins' | 'social';

export interface FeatureConfig {
    key: FeatureKey;
    label: string;
    description?: string;
    requires?: FeatureKey[];
}

export const FEATURES: FeatureConfig[] = [
    { key: 'patreon',       label: 'Patreon',       description: 'Patreon OAuth + membership tier sync.', },
    { key: 'users',         label: 'Users',         description: 'Registered users, member tiers, gated content.', },
    { key: 'posts',         label: 'Posts',         description: 'Blog posts with rich content blocks.', },
    { key: 'campaigns',     label: 'Campaigns',     description: 'Fundraising campaigns + donations.', },
    { key: 'forms',         label: 'Forms',         description: 'Custom forms, surveys, polls.', },
    { key: 'messages',      label: 'Messages',      description: 'Public contact form inbox.', },
    { key: 'social',        label: 'Social',        description: 'Social feed hub: capture, compose, cross-post, connections.', },
    { key: 'mailing_lists', label: 'Mailing Lists', description: 'Subscriber lists + mail templates.', requires: ['users',], },
    { key: 'shop',          label: 'Shop',          description: 'Products, cart, orders, and Stripe checkout.', requires: ['users',], },
    { key: 'plugins',       label: 'Plugins',       description: 'Install and manage external plugins & extensions.', },
];

export function getFeature(key: FeatureKey,): FeatureConfig {
    const f = FEATURES.find((c,) => c.key === key,);
    if (!f) throw new Error(`Unknown feature: ${key}`,);
    return f;
}

export function getDependents(key: FeatureKey,): FeatureKey[] {
    return FEATURES.filter((f,) => (f.requires ?? []).includes(key,),).map((f,) => f.key,);
}
