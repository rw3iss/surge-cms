import type {
    AiResult,
    Paginated,
    SocialAnalyticsCollectorsResponse,
    SocialAnalyticsCollectResponse,
    SocialAnalyticsOverviewQuery,
    SocialAnalyticsOverviewResponse,
    SocialAnalyticsPostSeriesResponse,
    SocialAnalyticsPostsQuery,
    SocialAnalyticsRangeQuery,
    SocialAnalyticsRunsQuery,
    SocialAnalyticsRunsResponse,
    SocialAnalyticsSeriesQuery,
    SocialAnalyticsSeriesResponse,
    SocialPostAnalytics,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /social-analytics — collected social account + post analytics (staff).
 * Everything is read from the CMS's own daily snapshots; `collect` runs the
 * platform collectors now.
 */
export class SocialAnalyticsModule extends ModuleBase {
    protected readonly module = 'social-analytics';

    /** Per-platform totals for a period (default: the last 28 days). */
    overview(query: SocialAnalyticsOverviewQuery = {},): Promise<SocialAnalyticsOverviewResponse> {
        return this.get('/social-analytics/overview', { query: { ...query, }, },);
    }

    /** One daily series of a platform (followers, views, watchTimeMinutes, likes, …). */
    series(query: SocialAnalyticsSeriesQuery,): Promise<SocialAnalyticsSeriesResponse> {
        return this.get('/social-analytics/series', { query: { ...query, }, },);
    }

    /** Posts with their latest metrics (paginated). */
    posts(query: SocialAnalyticsPostsQuery = {},): Promise<Paginated<SocialPostAnalytics>> {
        return this.getPaged('/social-analytics/posts', { query: { ...query, }, },);
    }

    /** One post's metrics + daily history in the period. */
    post(id: string, query: SocialAnalyticsRangeQuery = {},): Promise<SocialAnalyticsPostSeriesResponse> {
        return this.get('/social-analytics/posts/:id', { params: { id, }, query: { ...query, }, },);
    }

    /** Each platform collector's state and what it collects. */
    collectors(): Promise<SocialAnalyticsCollectorsResponse> {
        return this.get('/social-analytics/collectors',);
    }

    /** Recent collector runs (admin). */
    runs(query: SocialAnalyticsRunsQuery = {},): Promise<SocialAnalyticsRunsResponse> {
        return this.get('/social-analytics/runs', { query: { ...query, }, },);
    }

    /** AI summary of a period (Markdown in `text`). A long answer comes back `timedOut` — poll `cms.ai.job(id, { wait })`. */
    summary(range: SocialAnalyticsRangeQuery = {},): Promise<AiResult> {
        return this.mutate('POST', '/social-analytics/summary', { body: { ...range, }, },);
    }

    /** Run the collectors now (all ready ones, or the named platforms). */
    collect(platforms?: string[],): Promise<SocialAnalyticsCollectResponse> {
        return this.mutate('POST', '/social-analytics/collect', { body: platforms ? { platforms, } : {}, invalidates: ['social-analytics',], },);
    }
}
