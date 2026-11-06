/**
 * Facebook Page analytics — PURE mapping from Graph API answers to our points
 * and post metrics (no I/O; unit-tested with fixture answers).
 *
 * Metric names verified 2026-11-06 against
 *   https://developers.facebook.com/docs/graph-api/reference/insights/
 *   https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics
 *   https://developers.facebook.com/docs/graph-api/reference/video/video_insights/
 * Removed (never requested): page_fans*, page_impressions* (2025-11-15),
 * *_unique reach + unique video views (2026-06-15), page_engaged_users,
 * page_consumptions, page CTA clicks, page_fans_online (no online-hours metric).
 *
 * Dimension conventions (same as instagramMapping.ts, read by audience.ts):
 *   ''                     Page total
 *   follow:<FOLLOWER|NON_FOLLOWER>  page_media_view breakdown is_from_followers
 *   paid:<PAID|ORGANIC>    page_media_view breakdown is_from_ads; page video views paid/organic
 *   play:<AUTO|CLICK>      page video views autoplayed / click-to-play
 *   reaction:<type>        reactions on the Page's posts per day (like, love, wow, haha, sorry, anger)
 *   country:<ISO2> · city:<name>   audienceFollowers (page_follows_country / page_follows_city)
 */
import type { DailyPoint, PostMetric, } from '../types';
import { endTimeToDate, type InsightResponse, } from './metaGraph';

const num = (v: unknown,): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const x = Number(v,);
    return Number.isFinite(x,) ? x : null;
};

// ─── Page daily (period=day time series) ────────────────────────────────────

/** Graph Page metric → our daily metric (Page total). */
export const FB_DAILY_METRICS: Record<string, string> = {
    page_follows: 'followers',
    page_daily_follows_unique: 'followersGained',
    page_daily_unfollows_unique: 'followersLost',
    page_daily_follows: 'follows',
    page_media_view: 'views',
    page_total_media_view_unique: 'reach',
    page_post_engagements: 'engagements',
    page_views_total: 'pageViews',
    page_video_views: 'videoViews',
    page_video_view_time: 'watchTimeMinutes',
    page_video_complete_views_30s: 'videoViews30s',
    page_video_repeat_views: 'videoRepeatViews',
    page_actions_post_reactions_total: 'reactions',
};
/** page_video_view_time is milliseconds; we store minutes. */
export const FB_DAILY_SCALE: Record<string, number> = { page_video_view_time: 1 / 60000, };

/** Daily video splits → videoViews with a dimension. */
export const FB_VIDEO_SPLITS: Record<string, string> = {
    page_video_views_paid: 'paid:PAID',
    page_video_views_organic: 'paid:ORGANIC',
    page_video_views_autoplayed: 'play:AUTO',
    page_video_views_click_to_play: 'play:CLICK',
};

/** page_media_view breakdowns (one call each, per day). */
export const FB_BREAKDOWNS: Array<{ breakdown: string; metrics: string[]; }> = [
    { breakdown: 'is_from_followers', metrics: ['page_media_view',], },
    { breakdown: 'is_from_ads', metrics: ['page_media_view',], },
];

/** A boolean breakdown bucket → our dimension. */
export function breakdownDimension(breakdown: string, bucket: string,): string | null {
    const b = bucket.trim().toLowerCase();
    const yes = b === 'true' || b === '1' || b === 'yes';
    const no = b === 'false' || b === '0' || b === 'no';
    if (!yes && !no) return null;
    if (breakdown === 'is_from_followers') return yes ? 'follow:FOLLOWER' : 'follow:NON_FOLLOWER';
    if (breakdown === 'is_from_ads') return yes ? 'paid:PAID' : 'paid:ORGANIC';
    return null;
}

/**
 * Daily time series → Page totals, plus the reactions object
 * (`page_actions_post_reactions_total` = { like: n, love: n, … }) split per type.
 */
export function pageDailyPoints(resp: InsightResponse,): DailyPoint[] {
    const points: DailyPoint[] = [];
    for (const row of resp.data ?? []) {
        if (row.period && row.period !== 'day') continue;
        const metric = FB_DAILY_METRICS[row.name];
        const split = FB_VIDEO_SPLITS[row.name];
        if (!metric && !split) continue;
        for (const v of row.values ?? []) {
            const date = v.end_time ? endTimeToDate(v.end_time,) : null;
            if (!date) continue;
            if (split) {
                const value = num(v.value,);
                if (value !== null) points.push({ date, metric: 'videoViews', value, dimension: split, },);
                continue;
            }
            if (v.value && typeof v.value === 'object') {
                if (row.name !== 'page_actions_post_reactions_total') continue;
                // Reactions by type: a total + one point per type.
                let total = 0;
                for (const [type, n,] of Object.entries(v.value as Record<string, unknown>,)) {
                    const value = num(n,);
                    if (value === null) continue;
                    total += value;
                    points.push({ date, metric, value, dimension: `reaction:${type.toLowerCase()}`, },);
                }
                points.push({ date, metric, value: total, },);
                continue;
            }
            const value = num(v.value,);
            if (value !== null) points.push({ date, metric, value: value * (FB_DAILY_SCALE[row.name] ?? 1), },);
        }
    }
    return points;
}

/**
 * One day of a boolean breakdown (is_from_followers / is_from_ads) → points.
 * Meta does not document the Page answer's shape, so both are read: the
 * `total_value.breakdowns` form (as Instagram) and a `values[].value` object
 * keyed by bucket. A plain number (no breakdown applied) yields nothing.
 */
export function pageBreakdownPoints(resp: InsightResponse, breakdown: string, date: string,): DailyPoint[] {
    const points: DailyPoint[] = [];
    for (const row of resp.data ?? []) {
        const metric = FB_DAILY_METRICS[row.name];
        if (!metric) continue;
        for (const b of row.total_value?.breakdowns ?? []) {
            for (const r of b.results ?? []) {
                const dim = breakdownDimension(breakdown, String(r.dimension_values?.[0] ?? '',),);
                const value = num(r.value,);
                if (dim && value !== null) points.push({ date, metric, value, dimension: dim, },);
            }
        }
        const last = row.values?.[row.values.length - 1];
        if (last?.value && typeof last.value === 'object') {
            for (const [bucket, n,] of Object.entries(last.value as Record<string, unknown>,)) {
                const dim = breakdownDimension(breakdown, bucket,);
                const value = num(n,);
                if (dim && value !== null) points.push({ date, metric, value, dimension: dim, },);
            }
        }
    }
    return points;
}

// ─── Audience ───────────────────────────────────────────────────────────────

export const FB_AUDIENCE_METRICS: Record<string, string> = {
    page_follows_country: 'country',
    page_follows_city: 'city',
};

/** page_follows_country / page_follows_city ({ US: n, … }) → audienceFollowers points dated `date`. */
export function audiencePoints(resp: InsightResponse, date: string,): DailyPoint[] {
    const points: DailyPoint[] = [];
    for (const row of resp.data ?? []) {
        const prefix = FB_AUDIENCE_METRICS[row.name];
        if (!prefix) continue;
        const last = row.values?.[row.values.length - 1]?.value ?? row.total_value?.value;
        if (!last || typeof last !== 'object') continue;
        for (const [bucket, n,] of Object.entries(last as Record<string, unknown>,)) {
            const value = num(n,);
            const key = bucket.trim();
            if (key && value !== null) points.push({ date, metric: 'audienceFollowers', value, dimension: `${prefix}:${key}`, },);
        }
    }
    return points;
}

// ─── Posts ──────────────────────────────────────────────────────────────────

/** Lifetime insights asked of EVERY post. */
export const POST_METRICS = [
    'post_media_view',
    'post_total_media_view_unique',
    'post_clicks',
    'post_clicks_by_type',
    'post_reactions_by_type_total',
];
/** Extra lifetime insights asked only of video posts (a photo post refuses them). */
export const POST_VIDEO_METRICS = [
    'post_video_views',
    'post_video_views_organic',
    'post_video_views_paid',
    'post_video_views_autoplayed',
    'post_video_views_clicked_to_play',
    'post_video_views_sound_on',
    'post_video_complete_views_organic',
    'post_video_complete_views_paid',
    'post_video_view_time',
    'post_video_avg_time_watched',
    'post_video_length',
    'post_video_retention_graph',
];
/** Reels: /{video-id}/video_insights. */
export const REEL_METRICS = [
    'fb_reels_total_plays',
    'blue_reels_play_count',
    'fb_reels_replay_count',
    'post_video_avg_time_watched',
    'post_video_view_time',
    'post_video_followers',
    'post_video_social_actions',
    'post_video_likes_by_reaction_type',
    'post_video_retention_graph',
];

export interface FbPostNode {
    id: string;
    message?: string;
    created_time?: string;
    permalink_url?: string;
    full_picture?: string;
    status_type?: string;
    attachments?: { data?: Array<{ media_type?: string; type?: string; url?: string; media?: { image?: { src?: string; }; }; target?: { id?: string; }; }>; };
    shares?: { count?: number; };
    reactions?: { summary?: { total_count?: number; }; };
    comments?: { summary?: { total_count?: number; }; };
}

/** Our social_posts.media_kind for a Page post (≤ 16 chars). */
export function fbPostKind(p: Pick<FbPostNode, 'status_type' | 'attachments' | 'permalink_url'>,): string {
    const a = p.attachments?.data?.[0];
    const type = String(a?.type ?? '',).toLowerCase();
    const media = String(a?.media_type ?? '',).toLowerCase();
    const status = String(p.status_type ?? '',).toLowerCase();
    const link = String(p.permalink_url ?? a?.url ?? '',);
    if (/\/reel\//.test(link,) || type.includes('reel',)) return 'reel';
    if (type.includes('live',) || status.includes('live',)) return 'live';
    if (media === 'video' || type.startsWith('video',) || status === 'added_video') return 'video';
    if (media === 'album' || type === 'album') return 'album';
    if (media === 'photo' || type === 'photo' || status === 'added_photos') return 'photo';
    if (media === 'event' || type === 'event' || status === 'created_event') return 'event';
    if (media === 'link' || type === 'share' || status === 'shared_story') return 'link';
    return 'post';
}

export const isVideoKind = (kind: string | null | undefined,): boolean => kind === 'video' || kind === 'reel' || kind === 'live';

/** The video id behind a video post (attachment target), if any. */
export function fbVideoId(p: Pick<FbPostNode, 'attachments'>,): string | null {
    return p.attachments?.data?.[0]?.target?.id ?? null;
}

const sec = (msValue: number | undefined,): number | null => (msValue === undefined ? null : msValue / 1000);

/**
 * Post node fields (summaries) + lifetime insights → our post metric.
 * `reel` = the reel's video_insights numbers (plays replace views when present).
 */
export function mapFacebookPost(
    id: string,
    node: Pick<FbPostNode, 'reactions' | 'comments' | 'shares'> | null,
    insights: Map<string, number>,
    objects: Record<string, unknown> = {},
    reel: Map<string, number> = new Map(),
): PostMetric {
    const g = (k: string,): number | null => insights.get(k,) ?? null;
    const r = (k: string,): number | null => reel.get(k,) ?? null;
    const viewMs = reel.get('post_video_view_time',) ?? insights.get('post_video_view_time',);
    const avgMs = reel.get('post_video_avg_time_watched',) ?? insights.get('post_video_avg_time_watched',);
    // post_video_length is milliseconds, like the watch times.
    const lengthMs = g('post_video_length',);
    return {
        externalId: id,
        views: r('fb_reels_total_plays',) ?? g('post_media_view',),
        reach: g('post_total_media_view_unique',),
        clicks: g('post_clicks',),
        likes: node?.reactions?.summary?.total_count ?? null,
        comments: node?.comments?.summary?.total_count ?? null,
        shares: node?.shares?.count ?? (node ? 0 : null),
        watchTimeS: sec(viewMs,),
        avgWatchS: sec(avgMs,),
        // Average watched ÷ length.
        completionRate: avgMs !== undefined && lengthMs ? Math.max(0, Math.min(1, avgMs / lengthMs,),) : null,
        raw: {
            mediaViews: g('post_media_view',),
            videoViews: g('post_video_views',),
            videoViewsOrganic: g('post_video_views_organic',),
            videoViewsPaid: g('post_video_views_paid',),
            videoViewsAutoplayed: g('post_video_views_autoplayed',),
            videoViewsClickedToPlay: g('post_video_views_clicked_to_play',),
            videoViewsSoundOn: g('post_video_views_sound_on',),
            completeViewsOrganic: g('post_video_complete_views_organic',),
            completeViewsPaid: g('post_video_complete_views_paid',),
            reelPlays: r('fb_reels_total_plays',),
            reelInitialPlays: r('blue_reels_play_count',),
            reelReplays: r('fb_reels_replay_count',),
            reelFollows: r('post_video_followers',),
            reelSocialActions: r('post_video_social_actions',),
            reactionsByType: objects.post_reactions_by_type_total ?? objects.post_video_likes_by_reaction_type ?? null,
            clicksByType: objects.post_clicks_by_type ?? null,
            retention: objects.post_video_retention_graph ?? null,
        },
    };
}

// ─── Capabilities ───────────────────────────────────────────────────────────

/** What the connected Page could provide on the last run (status + Audience panel). */
export interface FbCapabilities {
    /** Basic tier. */
    pageNode: boolean;
    postsList: boolean;
    reels: boolean;
    /** Insights tier (read_insights + ANALYZE). */
    accountInsights: boolean;
    breakdowns: boolean;
    newFollowers: boolean;
    demographics: boolean;
    /** Facebook has no online-hours metric any more (page_fans_online removed) — always false. */
    onlineFollowers: boolean;
    mediaInsights: boolean;
    videoInsights: boolean;
    benchmarks: boolean;
    checkedAt: string;
}

/** The insights-tier families missing (empty = nothing to upgrade). */
export function fbCapabilityNotes(c: FbCapabilities | null | undefined,): string[] {
    if (!c) return [];
    const notes: string[] = [];
    if (!c.accountInsights) notes.push('daily views, reach, engagements, page visits');
    if (!c.newFollowers) notes.push('follows / unfollows per day');
    if (!c.mediaInsights) notes.push('per-post views, reach and clicks');
    return notes;
}

/** True when nothing of the insights tier worked (a basic connection). */
export function isBasicTier(c: FbCapabilities | null | undefined,): boolean {
    return !!c && !c.accountInsights && !c.mediaInsights && !c.newFollowers;
}
