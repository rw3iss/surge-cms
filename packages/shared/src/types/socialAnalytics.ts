/**
 * Social analytics — the shared vocabulary for the collectors, the API and
 * the admin dashboard. Every platform's raw numbers are stored as-is; these
 * definitions say what each normalised metric means, and when a platform
 * changed the meaning of "views" (shown as chart annotations).
 * Plan: docs/plans/2026-11-04-social-analytics-research.md §6.
 */

/** Platforms that can have an analytics collector (Threads is not a feed provider). */
export type SocialAnalyticsPlatform =
    | 'youtube' | 'instagram' | 'facebook' | 'tiktok' | 'twitter' | 'patreon' | 'threads';

/** Normalised per-post metric keys (columns of social_post_metrics). */
export type SocialPostMetricKey =
    | 'views' | 'likes' | 'comments' | 'shares' | 'saves'
    | 'watchTimeS' | 'avgWatchS' | 'completionRate' | 'reach' | 'impressions' | 'clicks';

export interface SocialMetricDefinition {
    key: string;
    label: string;
    description: string;
    /** How to show the number. */
    unit?: 'count' | 'seconds' | 'percent' | 'minutes';
}

/** The dashboard's metrics, with the definition shown in each tooltip. */
export const SOCIAL_METRICS: Record<string, SocialMetricDefinition> = {
    followers: { key: 'followers', label: 'Followers', description: 'Followers / subscribers on the day (YouTube rounds to 3 significant figures).', unit: 'count', },
    followerChange: { key: 'followerChange', label: 'Follower change', description: 'Followers at the end of the period minus at the start (from our daily snapshots).', unit: 'count', },
    views: { key: 'views', label: 'Views', description: 'Platform views in the period. Each platform counts a view differently (see the notes on the chart).', unit: 'count', },
    engagedViews: { key: 'engagedViews', label: 'Engaged views', description: 'YouTube only: views past the first few seconds — the old meaning of a view.', unit: 'count', },
    watchTimeMinutes: { key: 'watchTimeMinutes', label: 'Watch time', description: 'Minutes watched in the period (YouTube Analytics).', unit: 'minutes', },
    avgViewDuration: { key: 'avgViewDuration', label: 'Avg view duration', description: 'Average seconds watched per view.', unit: 'seconds', },
    likes: { key: 'likes', label: 'Likes', description: 'Likes / reactions in the period.', unit: 'count', },
    comments: { key: 'comments', label: 'Comments', description: 'Comments / replies in the period.', unit: 'count', },
    shares: { key: 'shares', label: 'Shares', description: 'Shares / reposts in the period.', unit: 'count', },
    posts: { key: 'posts', label: 'Posts', description: 'Posts published in the period (from the captured feed).', unit: 'count', },
    avgViewsPerPost: { key: 'avgViewsPerPost', label: 'Avg views / post', description: 'Current views of the posts published in the period, divided by their number.', unit: 'count', },
    engagementRate: { key: 'engagementRate', label: 'Engagement rate', description: '(likes + comments + shares + saves) ÷ views, for the posts published in the period.', unit: 'percent', },
    impressions: { key: 'impressions', label: 'Impressions', description: 'Times the post/thumbnail was shown (YouTube: thumbnail impressions, from the Reporting API).', unit: 'count', },
};

/** Dates a platform changed how it counts views — shown on charts. */
export interface SocialDefinitionChange {
    platform: SocialAnalyticsPlatform;
    date: string;
    note: string;
}

export const SOCIAL_DEFINITION_CHANGES: SocialDefinitionChange[] = [
    { platform: 'youtube', date: '2025-03-31', note: 'Shorts views count every start and replay.', },
    { platform: 'youtube', date: '2026-08-24', note: 'Views count from the first frame for all formats (engaged views keep the old meaning).', },
    { platform: 'instagram', date: '2025-04-21', note: 'Meta replaced impressions/plays with views.', },
    { platform: 'facebook', date: '2025-04-21', note: 'Meta replaced impressions/plays with views.', },
];

/** What a collector reports about itself, for the admin. */
export interface SocialCollectorStatus {
    platform: SocialAnalyticsPlatform;
    label: string;
    /** ready = collects everything it can; partial = some data needs more access; off = cannot collect. */
    state: 'ready' | 'partial' | 'off';
    /** What the operator must do (reconnect, add a scope…). */
    message: string | null;
    /** What this collector gathers at its current access. */
    collects: string[];
}

export interface SocialAnalyticsRun {
    id: string;
    platform: string;
    trigger: string;
    status: 'running' | 'ok' | 'partial' | 'failed';
    startedAt: string;
    finishedAt: string | null;
    counts: Record<string, number>;
    warnings: string[];
    error: string | null;
}

export interface SocialAccountSummary {
    platform: SocialAnalyticsPlatform;
    label: string;
    status: SocialCollectorStatus;
    lastRun: SocialAnalyticsRun | null;
    /** First day we have a snapshot ("data since"). */
    since: string | null;
    followers: number | null;
    followerChange: number | null;
    /** Period totals; null when the platform gives no such number. */
    views: number | null;
    engagedViews: number | null;
    watchTimeMinutes: number | null;
    avgViewDuration: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    posts: number;
    avgViewsPerPost: number | null;
    engagementRate: number | null;
}

export interface SocialAnalyticsOverview {
    from: string;
    to: string;
    accounts: SocialAccountSummary[];
    totals: {
        followers: number;
        followerChange: number;
        views: number;
        likes: number;
        comments: number;
        shares: number;
        posts: number;
    };
    definitionChanges: SocialDefinitionChange[];
}

export interface SocialSeriesPoint {
    date: string;
    value: number;
}

export interface SocialSeries {
    platform: string;
    metric: string;
    points: SocialSeriesPoint[];
}

export interface SocialPostAnalytics {
    id: string;
    platform: string;
    externalId: string;
    title: string;
    url: string | null;
    thumbnailUrl: string | null;
    kind: string | null;
    publishedAt: string | null;
    /** Date of the latest metrics row. */
    asOf: string | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    watchTimeS: number | null;
    avgWatchS: number | null;
    completionRate: number | null;
    reach: number | null;
    impressions: number | null;
    clicks: number | null;
    /** Views gained inside the requested period (latest − first row in it). */
    viewsInPeriod: number | null;
    /** Views 7 days after publishing (when we had a snapshot that day). */
    viewsDay7: number | null;
    engagementRate: number | null;
}

// ─── Digests (scheduled analytics reports) ─────────────────────────────────

export type DigestFrequency = 'daily' | 'weekly' | 'monthly';

/** The parts a digest can include. */
export type DigestSection = 'totals' | 'platforms' | 'trends' | 'topPosts' | 'audience' | 'ai';

export const DIGEST_SECTIONS: Array<{ key: DigestSection; label: string; description: string; }> = [
    { key: 'totals', label: 'Totals', description: 'Followers, views and engagement across every platform, with the change against the previous period.', },
    { key: 'platforms', label: 'Per platform', description: 'Each platform\'s numbers and changes.', },
    { key: 'trends', label: 'Trends', description: 'Daily followers and views per platform (charts in the browser, bars in email).', },
    { key: 'topPosts', label: 'Top posts', description: 'The posts that gained the most views in the period.', },
    { key: 'audience', label: 'Audience', description: 'Who follows and engages (age, gender, top countries), when followers are online, what content type gets the views, and benchmark accounts — where the platform provides it (Instagram today).', },
    { key: 'ai', label: 'AI insights', description: 'A headline, what changed, why the top posts worked and next steps — written by the AI module (claude-broker "analytics" pool).', },
];

export interface SocialAnalyticsSettings {
    digest: {
        enabled: boolean;
        frequency: DigestFrequency;
        /** Weekly: 0 = Sunday … 6 = Saturday. */
        weekday: number;
        /** Monthly: 1–28. */
        monthDay: number;
        /** Local hour (0–23) in `timezone`. */
        hour: number;
        timezone: string;
        /** Platforms to include; empty = every platform with data. */
        platforms: string[];
        sections: DigestSection[];
        /** How many top posts to list. */
        topPosts: number;
        /** The claude-broker pool the AI insights run on. */
        aiPool: string;
    };
    email: {
        enabled: boolean;
        /** full = the whole digest; summary = headline, totals, top 3 posts + a link. */
        format: 'full' | 'summary';
        /** Extra addresses for the digest email. */
        recipients: string[];
        /**
         * augment = these addresses + the email recipients of the "Analytics digest"
         * notification type (Settings → Notifications); override = only these.
         */
        recipientMode: 'augment' | 'override';
    };
    /** Keep digests (and their snapshots) this many days; null = forever. */
    retentionDays: number | null;
    /** Other public accounts to track for comparison, per platform (Instagram: Business/Creator usernames). */
    benchmarks: { instagram: string[]; facebook: string[]; };
}

export const DEFAULT_SOCIAL_ANALYTICS_SETTINGS: SocialAnalyticsSettings = {
    digest: {
        enabled: false,
        frequency: 'weekly',
        weekday: 1,
        monthDay: 1,
        hour: 9,
        timezone: 'America/New_York',
        platforms: [],
        sections: ['totals', 'platforms', 'trends', 'topPosts', 'audience', 'ai',],
        topPosts: 10,
        aiPool: 'analytics',
    },
    email: { enabled: true, format: 'full', recipients: [], recipientMode: 'augment', },
    retentionDays: 365,
    benchmarks: { instagram: [], facebook: [], },
};

/** One number with its previous-period value. */
export interface DigestMetric {
    value: number | null;
    previous: number | null;
    /** value − previous (null when either is missing). */
    change: number | null;
    /** change ÷ previous (null when previous is 0/missing). */
    changePct: number | null;
}

export interface DigestPlatform {
    platform: string;
    label: string;
    since: string | null;
    metrics: Record<string, DigestMetric>;
    /** Daily series for the trends section. */
    series: Record<string, SocialSeriesPoint[]>;
    status: SocialCollectorStatus['state'];
    statusMessage: string | null;
}

export interface DigestAiInsights {
    headline: string;
    highlights: string[];
    platforms: Array<{ platform: string; summary: string; }>;
    topPosts: Array<{ id: string; why: string; }>;
    suggestions: string[];
}

/** The snapshot a digest stores — enough to render it again, in the browser or email, at any time. */
export interface DigestData {
    v: 1;
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
    sections: DigestSection[];
    totals: Record<string, DigestMetric>;
    platforms: DigestPlatform[];
    topPosts: SocialPostAnalytics[];
    /** Per platform that provides it (the `audience` section). */
    audience?: SocialAudience[];
    definitionChanges: SocialDefinitionChange[];
    ai: { status: 'ok' | 'failed' | 'skipped'; insights: DigestAiInsights | null; error: string | null; provider: string | null; pool: string | null; };
}

export interface SocialAnalyticsDigestSummary {
    id: string;
    frequency: DigestFrequency | 'manual';
    from: string;
    to: string;
    status: 'generating' | 'ready' | 'failed';
    headline: string | null;
    trigger: 'schedule' | 'manual';
    createdAt: string;
    emailedAt: string | null;
    emailCount: number;
    error: string | null;
}

export interface SocialAnalyticsDigest extends SocialAnalyticsDigestSummary {
    data: DigestData | null;
}

// ─── Audience + content breakdowns (Instagram first; any platform can fill the same shape) ───

/** One bucket of a breakdown: `key` = age band, gender, country code, city, content type… */
export interface AudienceBucket {
    key: string;
    value: number;
    /** Share of the breakdown's total (0–1). */
    share: number;
}

export interface AudienceDemographics {
    age: AudienceBucket[];
    gender: AudienceBucket[];
    country: AudienceBucket[];
    city: AudienceBucket[];
}

export interface AudienceBenchmark {
    username: string;
    followers: number | null;
    followerChange: number | null;
    mediaCount: number | null;
    avgLikes: number | null;
    avgComments: number | null;
    /** (avg likes + avg comments) ÷ followers. */
    engagementRate: number | null;
    postsPerWeek: number | null;
    asOf: string | null;
}

export interface SocialAudience {
    platform: string;
    from: string;
    to: string;
    /** Latest snapshot day the demographics come from. */
    asOf: string | null;
    /** followers = who follows; engaged = who interacted; reached = who saw (each null when not available). */
    demographics: { followers: AudienceDemographics | null; engaged: AudienceDemographics | null; reached: AudienceDemographics | null; };
    /** Average followers online per hour (0–23) over the period; empty when not available. */
    onlineHours: Array<{ hour: number; value: number; }>;
    /** Content + audience splits summed over the period. */
    breakdowns: {
        viewsByType: AudienceBucket[];
        reachByType: AudienceBucket[];
        interactionsByType: AudienceBucket[];
        viewsByFollow: AudienceBucket[];
        reachByFollow: AudienceBucket[];
        /** Paid vs organic views (Facebook). */
        viewsByPaid?: AudienceBucket[];
        /** Autoplayed vs click-to-play video views (Facebook). */
        videoViewsByPlay?: AudienceBucket[];
        /** Reactions by type: like, love, wow, haha, sorry, anger (Facebook). */
        reactionsByType?: AudienceBucket[];
    };
    /** Posts / views / engagement per content kind, from our post metrics. */
    contentKinds: Array<{ kind: string; posts: number; views: number | null; avgViews: number | null; engagementRate: number | null; }>;
    hashtags: Array<{ tag: string; posts: number; avgViews: number | null; engagementRate: number | null; }>;
    stories: { count: number; views: number | null; reach: number | null; replies: number | null; };
    benchmarks: AudienceBenchmark[];
    /** What the connected account can provide (from the collector's last run). */
    capabilities: Record<string, boolean> | null;
}
