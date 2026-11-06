/**
 * Instagram analytics — PURE mapping from Graph API answers to our points and
 * post metrics (no I/O; unit-tested with fixture answers).
 *
 * Dimension conventions in social_account_daily (read by read.ts `audience`):
 *   ''             account total
 *   type:<KIND>    content type split (media_product_type: POST, REEL, STORY, CAROUSEL_CONTAINER …)
 *   follow:<KIND>  followers vs non-followers (FOLLOWER, NON_FOLLOWER, UNKNOWN)
 *   age:<band> · gender:<F|M|U> · country:<ISO2> · city:<name>   (audience* metrics)
 *   hour:<0-23>    onlineFollowers
 *   story:<id>     per-story numbers
 *   peer:<username> benchmark accounts
 */
import type { DailyPoint, PostMetric, } from '../types';
import { endTimeToDate, type InsightResponse, } from './metaGraph';

// ─── Account daily (metric_type=total_value) ────────────────────────────────

/** Graph account metric → our daily metric. */
export const IG_DAILY_METRICS: Record<string, string> = {
    views: 'views',
    reach: 'reach',
    likes: 'likes',
    comments: 'comments',
    shares: 'shares',
    saves: 'saves',
    replies: 'replies',
    total_interactions: 'engagements',
    accounts_engaged: 'accountsEngaged',
    profile_links_taps: 'profileLinkTaps',
};

/** Breakdown calls made per day: which metrics, split by which dimension. */
export const IG_BREAKDOWNS: Array<{ breakdown: string; metrics: string[]; }> = [
    { breakdown: 'media_product_type', metrics: ['views', 'reach', 'total_interactions',], },
    { breakdown: 'follow_type', metrics: ['views', 'reach',], },
];

/** Graph breakdown key → our dimension prefix. */
export const DIMENSION_PREFIX: Record<string, string> = {
    media_product_type: 'type',
    follow_type: 'follow',
    follower_type: 'follow',
    age: 'age',
    gender: 'gender',
    country: 'country',
    city: 'city',
};

const num = (v: unknown,): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const x = Number(v,);
    return Number.isFinite(x,) ? x : null;
};

/** One day's total_value answer → account totals on that day. */
export function totalValuePoints(resp: InsightResponse, date: string,): DailyPoint[] {
    const points: DailyPoint[] = [];
    for (const row of resp.data ?? []) {
        const metric = IG_DAILY_METRICS[row.name];
        const value = num(row.total_value?.value,);
        if (metric && value !== null) points.push({ date, metric, value, },);
    }
    return points;
}

/**
 * total_value breakdowns → one point per bucket, dimension `<prefix>:<value>`.
 * `metricFor` maps the Graph metric name to ours (default: IG_DAILY_METRICS).
 */
export function breakdownPoints(resp: InsightResponse, date: string, metricFor: (name: string,) => string | undefined = (n,) => IG_DAILY_METRICS[n],): DailyPoint[] {
    const points: DailyPoint[] = [];
    for (const row of resp.data ?? []) {
        const metric = metricFor(row.name,);
        if (!metric) continue;
        for (const b of row.total_value?.breakdowns ?? []) {
            const key = b.dimension_keys?.[0];
            const prefix = key ? DIMENSION_PREFIX[key] : undefined;
            if (!prefix) continue;
            for (const r of b.results ?? []) {
                const bucket = String(r.dimension_values?.[0] ?? '',).trim();
                const value = num(r.value,);
                if (!bucket || value === null) continue;
                points.push({ date, metric, value, dimension: `${prefix}:${bucket}`, },);
            }
        }
    }
    return points;
}

/** follows_and_unfollows (breakdown follow_type) → followersGained / followersLost. */
export function followPoints(resp: InsightResponse, date: string,): DailyPoint[] {
    const points: DailyPoint[] = [];
    for (const row of resp.data ?? []) {
        if (row.name !== 'follows_and_unfollows') continue;
        for (const b of row.total_value?.breakdowns ?? []) {
            for (const r of b.results ?? []) {
                const kind = r.dimension_values?.[0];
                const value = num(r.value,);
                if (value === null) continue;
                if (kind === 'FOLLOWER') points.push({ date, metric: 'followersGained', value, },);
                else if (kind === 'NON_FOLLOWER') points.push({ date, metric: 'followersLost', value, },);
            }
        }
    }
    return points;
}

// ─── Audience ───────────────────────────────────────────────────────────────

/** Graph demographics metric → our metric. */
export const AUDIENCE_METRICS: Record<string, string> = {
    follower_demographics: 'audienceFollowers',
    engaged_audience_demographics: 'audienceEngaged',
    reached_audience_demographics: 'audienceReached',
};
export const AUDIENCE_BREAKDOWNS = ['age', 'gender', 'country', 'city',];

export function demographicPoints(resp: InsightResponse, date: string,): DailyPoint[] {
    return breakdownPoints(resp, date, (n,) => AUDIENCE_METRICS[n],);
}

/**
 * online_followers (period=lifetime): one value per day = { "0": n, … "23": n }
 * → metric onlineFollowers, dimension hour:<h>, on the day it covers.
 */
export function onlineFollowerPoints(resp: InsightResponse,): DailyPoint[] {
    const points: DailyPoint[] = [];
    for (const row of resp.data ?? []) {
        if (row.name !== 'online_followers') continue;
        for (const v of row.values ?? []) {
            const date = v.end_time ? endTimeToDate(v.end_time,) : null;
            if (!date || !v.value || typeof v.value !== 'object') continue;
            for (const [hour, n,] of Object.entries(v.value as Record<string, unknown>,)) {
                const h = Number(hour,);
                const value = num(n,);
                if (!Number.isInteger(h,) || h < 0 || h > 23 || value === null) continue;
                points.push({ date, metric: 'onlineFollowers', value, dimension: `hour:${h}`, },);
            }
        }
    }
    return points;
}

// ─── Media ──────────────────────────────────────────────────────────────────

export type MediaKind = 'REELS' | 'FEED' | 'STORY';

/** Insight metrics per media product type (a dead one is skipped for the run, see fetchInsights). */
export const MEDIA_METRICS: Record<MediaKind, string[]> = {
    // Verified on a live account 2026-11-05: Reels do not support profile_visits / follows, and
    // profile_activity needs its own breakdown call (it invalidates a grouped request).
    FEED: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'profile_visits', 'follows',],
    REELS: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate',],
    STORY: ['views', 'reach', 'replies', 'shares', 'total_interactions', 'follows', 'profile_visits',],
};

export function mediaKind(fields: { media_product_type?: string; media_type?: string; },): MediaKind {
    const t = String(fields.media_product_type ?? '',).toUpperCase();
    if (t === 'REELS' || t === 'STORY') return t;
    return 'FEED';
}

/** Our social_posts.media_kind for an Instagram item. */
export function igPostKind(fields: { media_product_type?: string; media_type?: string; },): string {
    const p = String(fields.media_product_type ?? '',).toUpperCase();
    const t = String(fields.media_type ?? '',).toUpperCase();
    if (p === 'REELS') return 'reel';
    if (p === 'STORY') return 'story';
    if (t === 'CAROUSEL_ALBUM') return 'carousel';
    if (t === 'VIDEO') return 'video';
    return 'image';
}

const ms = (v: number | undefined,): number | null => (v === undefined ? null : v / 1000);

/** Media node fields + its insights → our post metric (likes/comments fall back to the node counters). */
export function mapInstagramMedia(
    id: string,
    fields: { like_count?: number; comments_count?: number; media_product_type?: string; media_type?: string; },
    insights: Map<string, number>,
    extra: Record<string, unknown> = {},
): PostMetric {
    const g = (k: string,): number | null => insights.get(k,) ?? null;
    const skip = g('reels_skip_rate',);
    return {
        externalId: id,
        views: g('views',),
        reach: g('reach',),
        likes: g('likes',) ?? fields.like_count ?? null,
        // Story replies are its comments.
        comments: g('comments',) ?? g('replies',) ?? fields.comments_count ?? null,
        shares: g('shares',),
        saves: g('saved',),
        watchTimeS: ms(insights.get('ig_reels_video_view_total_time',),),
        avgWatchS: ms(insights.get('ig_reels_avg_watch_time',),),
        // Skip rate is the share that skipped in the first seconds → the rest kept watching.
        completionRate: skip === null ? null : Math.max(0, Math.min(1, 1 - (skip > 1 ? skip / 100 : skip),),),
        raw: {
            mediaProductType: fields.media_product_type ?? null,
            mediaType: fields.media_type ?? null,
            totalInteractions: g('total_interactions',),
            profileVisits: g('profile_visits',),
            profileActivity: g('profile_activity',),
            follows: g('follows',),
            replies: g('replies',),
            skipRate: skip,
            ...extra,
        },
    };
}

/** Story navigation (breakdown story_navigation_action_type) → { tap_forward: n, … }. */
export function navigationBreakdown(resp: InsightResponse,): Record<string, number> | null {
    const out: Record<string, number> = {};
    for (const row of resp.data ?? []) {
        if (row.name !== 'navigation') continue;
        for (const b of row.total_value?.breakdowns ?? []) {
            for (const r of b.results ?? []) {
                const k = String(r.dimension_values?.[0] ?? '',).toLowerCase();
                const v = num(r.value,);
                if (k && v !== null) out[k] = v;
            }
        }
        const total = num(row.total_value?.value,);
        if (total !== null) out.total = total;
    }
    return Object.keys(out,).length ? out : null;
}

/** Story insights → per-story daily points on the story's posting day (kept for the 0.x totals). */
export const STORY_METRICS: Record<string, string> = {
    views: 'storyViews',
    reach: 'storyReach',
    replies: 'storyReplies',
    shares: 'storyShares',
    total_interactions: 'storyInteractions',
};

export function storyPoints(storyId: string, timestamp: string, insights: Map<string, number>,): DailyPoint[] {
    const t = Date.parse(timestamp.replace(/\+0000$/, 'Z',),);
    if (!Number.isFinite(t,)) return [];
    const date = new Date(t,).toISOString().slice(0, 10,);
    const points: DailyPoint[] = [];
    for (const [name, metric,] of Object.entries(STORY_METRICS,)) {
        const v = insights.get(name,);
        if (v !== undefined) points.push({ date, metric, value: v, dimension: `story:${storyId}`, },);
    }
    return points;
}

// ─── Benchmarks (business_discovery) ────────────────────────────────────────

export interface DiscoveredAccount {
    username?: string;
    followers_count?: number;
    media_count?: number;
    media?: { data?: Array<{ like_count?: number; comments_count?: number; timestamp?: string; }>; };
}

/** A public Business/Creator account's numbers → peer:<username> points. */
export function benchmarkPoints(username: string, d: DiscoveredAccount, date: string,): DailyPoint[] {
    const dim = `peer:${username.toLowerCase()}`;
    const points: DailyPoint[] = [];
    const push = (metric: string, v: number | null | undefined,) => {
        if (typeof v === 'number' && Number.isFinite(v,)) points.push({ date, metric, value: v, dimension: dim, },);
    };
    push('peerFollowers', d.followers_count,);
    push('peerMediaCount', d.media_count,);
    const media = d.media?.data ?? [];
    if (media.length) {
        const avg = (k: 'like_count' | 'comments_count',) => {
            const vals = media.map((m,) => m[k],).filter((v,): v is number => typeof v === 'number',);
            return vals.length ? vals.reduce((a, b,) => a + b, 0,) / vals.length : null;
        };
        push('peerAvgLikes', avg('like_count',),);
        push('peerAvgComments', avg('comments_count',),);
        const times = media.map((m,) => Date.parse(String(m.timestamp ?? '',).replace(/\+0000$/, 'Z',),),).filter(Number.isFinite,).sort((a, b,) => a - b);
        if (times.length >= 2) {
            const weeks = (times[times.length - 1] - times[0]) / (7 * 86_400_000);
            if (weeks > 0) push('peerPostsPerWeek', (times.length - 1) / weeks,);
        }
    }
    return points;
}

// ─── Capabilities ───────────────────────────────────────────────────────────

/** What the connected account could provide on the last run (shown by status + the Audience panel). */
export interface IgCapabilities {
    accountInsights: boolean;
    breakdowns: boolean;
    newFollowers: boolean;
    demographics: boolean;
    onlineFollowers: boolean;
    mediaInsights: boolean;
    stories: boolean;
    benchmarks: boolean;
    checkedAt: string;
}

export function capabilityNotes(c: IgCapabilities | null | undefined,): string[] {
    if (!c) return [];
    const notes: string[] = [];
    if (!c.accountInsights) notes.push('account totals (views, reach, interactions per day)');
    if (!c.demographics) notes.push('audience demographics (needs 100+ followers)');
    if (!c.onlineFollowers) notes.push('when followers are online');
    if (!c.mediaInsights) notes.push('per-post views, reach and saves');
    return notes;
}
