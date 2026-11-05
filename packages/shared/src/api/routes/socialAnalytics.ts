/**
 * /social-analytics — collected social account + post analytics (staff).
 */
import type {
    SocialAnalyticsOverview,
    SocialAnalyticsRun,
    SocialCollectorStatus,
    SocialPostAnalytics,
    SocialSeries,
} from '../../types/socialAnalytics';

/** Period, as YYYY-MM-DD (defaults: the last 28 days). */
export interface SocialAnalyticsRangeQuery {
    from?: string;
    to?: string;
}

export type SocialAnalyticsOverviewQuery = SocialAnalyticsRangeQuery;
export type SocialAnalyticsOverviewResponse = SocialAnalyticsOverview;

export interface SocialAnalyticsSeriesQuery extends SocialAnalyticsRangeQuery {
    platform: string;
    /** followers | views | likes | watchTimeMinutes | … */
    metric: string;
}
export type SocialAnalyticsSeriesResponse = SocialSeries;

export interface SocialAnalyticsPostsQuery extends SocialAnalyticsRangeQuery {
    platform?: string;
    kind?: string;
    search?: string;
    sort?: 'publishedAt' | 'views' | 'viewsInPeriod' | 'likes' | 'comments' | 'shares' | 'watchTimeS' | 'engagementRate' | 'impressions';
    dir?: 'asc' | 'desc';
    page?: number;
    limit?: number;
    /** Only posts published inside the period (default: every post with metrics). */
    publishedInPeriod?: boolean;
}
export type SocialAnalyticsPostsResponse = SocialPostAnalytics[];

export interface SocialAnalyticsPostSeriesParams {
    id: string;
}
export interface SocialAnalyticsPostSeriesResponse {
    post: SocialPostAnalytics;
    points: Array<{ date: string; views: number | null; likes: number | null; comments: number | null; shares: number | null; }>;
}

export type SocialAnalyticsCollectorsResponse = SocialCollectorStatus[];

export interface SocialAnalyticsCollectBody {
    /** Platforms to collect now; omitted = every ready collector. */
    platforms?: string[];
}
export type SocialAnalyticsCollectResponse = SocialAnalyticsRun[];

export interface SocialAnalyticsRunsQuery {
    platform?: string;
    limit?: number;
}
export type SocialAnalyticsRunsResponse = SocialAnalyticsRun[];

/** AI summary of a period — answered by the AI module (an `AiResult`). */
export type SocialAnalyticsSummaryBody = SocialAnalyticsRangeQuery;
