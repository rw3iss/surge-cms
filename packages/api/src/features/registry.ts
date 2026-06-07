/**
 * Central registry of feature modules. Single source of truth replacing
 * the scattered `FEATURE_TO_SETTING_KEY` map in `routes/settings.ts`.
 *
 * Each feature can declare prerequisites (`requires`) and the migrations
 * that should run on first enable (`migrations`). The dependency
 * validator + `PUT /settings` enforce the prerequisites at toggle time;
 * the migration runner reads `migrations` and applies them inside an
 * advisory-locked transaction before flipping the feature bit on.
 */

export type FeatureKey =
    | 'patreon' | 'posts' | 'campaigns' | 'forms' | 'messages' | 'users'
    | 'mailing_lists';

export interface FeatureConfig {
    key: FeatureKey;
    label: string;
    description?: string;
    defaultEnabled: boolean;
    requires?: FeatureKey[];
    /** Migration filenames (relative to db/migrations/) to apply on first enable. */
    migrations?: string[];
}

export const FEATURE_REGISTRY: Record<FeatureKey, FeatureConfig> = {
    patreon: {
        key: 'patreon',
        label: 'Patreon',
        description: 'Patreon OAuth + membership tier sync.',
        defaultEnabled: false,
    },
    posts: {
        key: 'posts',
        label: 'Posts',
        description: 'Blog posts with rich content blocks.',
        defaultEnabled: true,
    },
    campaigns: {
        key: 'campaigns',
        label: 'Campaigns',
        description: 'Fundraising campaigns + donations.',
        defaultEnabled: true,
    },
    forms: {
        key: 'forms',
        label: 'Forms',
        description: 'Custom forms, surveys, polls.',
        defaultEnabled: true,
    },
    messages: {
        key: 'messages',
        label: 'Messages',
        description: 'Public contact form inbox.',
        defaultEnabled: true,
    },
    users: {
        key: 'users',
        label: 'Users',
        description: 'Registered users, member tiers, gated content.',
        defaultEnabled: false,
    },
    mailing_lists: {
        key: 'mailing_lists',
        label: 'Mailing Lists',
        description: 'Author mail templates and send to subscriber lists.',
        defaultEnabled: false,
        requires: ['users'],
        migrations: [
            '030_create_mailing_lists.sql',
            '031_create_mailing_list_subscribers.sql',
            '032_create_mail_templates.sql',
            '033_create_mail_template_blocks.sql',
            '034_create_mail_send_jobs.sql',
            '035_create_mail_send_recipients.sql',
            '036_seed_mailing_lists_feature_setting.sql',
            '037_add_send_job_template_snapshot.sql',
        ],
    },
};

/** Map feature key → site_settings row key. */
export function featureSettingKey(key: FeatureKey): string {
    return `${key}_enabled`;
}

/** Features that declare `key` as a prerequisite. */
export function getDependents(key: FeatureKey): FeatureKey[] {
    return (Object.values(FEATURE_REGISTRY) as FeatureConfig[])
        .filter((c) => (c.requires ?? []).includes(key))
        .map((c) => c.key);
}

/**
 * Detect simple cycles at boot. Called from `backend/src/index.ts` so a
 * misconfigured registry fails the process immediately instead of
 * surfacing later as a confusing 500 on a settings save.
 */
export function assertNoCycles(): void {
    const visiting = new Set<FeatureKey>();
    const visited = new Set<FeatureKey>();
    const dfs = (k: FeatureKey, stack: FeatureKey[]): void => {
        if (visiting.has(k)) {
            throw new Error(`Feature dependency cycle: ${[...stack, k].join(' → ')}`);
        }
        if (visited.has(k)) return;
        visiting.add(k);
        for (const r of FEATURE_REGISTRY[k].requires ?? []) {
            if (!FEATURE_REGISTRY[r]) {
                throw new Error(`Feature '${k}' requires unknown feature '${r}'`);
            }
            dfs(r, [...stack, k]);
        }
        visiting.delete(k);
        visited.add(k);
    };
    for (const k of Object.keys(FEATURE_REGISTRY) as FeatureKey[]) dfs(k, []);
}

export function getAllFeatures(): FeatureConfig[] {
    return Object.values(FEATURE_REGISTRY);
}
