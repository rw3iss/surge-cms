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
