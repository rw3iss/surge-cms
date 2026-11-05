/**
 * Instagram analytics collector — Business / Creator accounts (plan §3.2).
 *
 *  1. Account node: followers_count, follows_count, media_count (snapshot).
 *  2. Account insights, per day for the last 3 days (Meta lags up to 48 h,
 *     so each run rewrites them): views, reach, likes, comments, shares,
 *     saves, total_interactions, accounts_engaged, profile_links_taps
 *     (`metric_type=total_value`, one call per day) + follows_and_unfollows
 *     (breakdown follow_type → followersGained / followersLost), with the
 *     older `follower_count` series as the gains fallback.
 *  3. Media insights for the due posts: views, reach, likes, comments,
 *     shares, saved, total_interactions (+ profile_visits/follows for feed;
 *     Reels add ig_reels_avg_watch_time / ig_reels_video_view_total_time,
 *     which the API returns in MILLISECONDS → stored as seconds).
 *  4. Stories (24 h only, not in social_posts): the `social-analytics-ig-stories`
 *     cron, every 3 hours, stores each live story's numbers as daily points
 *     — metric `storyViews` / `storyReach` / `storyReplies` / `storyShares` /
 *     `storyInteractions` with dimension `story:<id>`, on the story's UTC
 *     posting day — then re-sums that day's per-story rows into the account
 *     total (dimension '') plus `stories` (how many). Re-summing from the
 *     table, not from the current API answer, keeps stories that expired
 *     since the last sweep in the total.
 *
 * Host: a Facebook-Login token (EAA…, from our OAuth) uses graph.facebook.com
 * and the IG business account id; an Instagram-Login token (IG…) uses
 * graph.instagram.com. Every metric group is fetched separately and dead
 * metrics turn into warnings (metaGraph.fetchInsights), never a failed run.
 */
import type { SocialCollectorStatus, } from '@sitesurge/types';
import { config, } from '../../../../config';
import { query, } from '../../../../db';
import { logger, } from '../../../../utils/logger';
import { registerCollector, } from '../registry';
import type { AccountSnapshot, CollectContext, CollectResult, DailyPoint, PostMetric, } from '../types';
import {
    addDays,
    FACEBOOK_GRAPH,
    fetchInsights,
    graphGet,
    INSTAGRAM_GRAPH,
    type InsightResponse,
    insightNumbers,
    isPermissionError,
    isTokenError,
    envValue,
    mapLimit,
    timeSeriesPoints,
    unixDay,
    WarningBag,
} from './metaGraph';

const DAILY_WINDOW = 3;
const CONCURRENCY = 4;
const INSIGHTS_SCOPES = ['instagram_manage_insights', 'instagram_business_manage_insights',];

export interface InstagramAuth {
    token: string;
    userId: string;
    base: string;
    instagramLogin: boolean;
}

export function resolveInstagramAuth(credentials: Record<string, unknown>,): InstagramAuth | null {
    const token = String(credentials.accessToken || envValue(config.social.facebook.accessToken,),).trim();
    const userId = String(
        credentials.igUserId || credentials.businessAccountId || credentials.id || credentials.userId
            || envValue(config.social.instagram.businessAccountId,),
    ).trim();
    if (!token || !userId) return null;
    const instagramLogin = credentials.loginType === 'instagram' || /^IG/.test(token,);
    return { token, userId, base: instagramLogin ? INSTAGRAM_GRAPH : FACEBOOK_GRAPH, instagramLogin, };
}

function grantedScopes(credentials: Record<string, unknown>,): string[] | null {
    const s = credentials.grantedScopes ?? credentials.scope;
    if (Array.isArray(s,)) return s.map(String,);
    if (typeof s === 'string' && s.trim()) return s.split(/[\s,]+/,);
    return null;
}

/** Last access problem seen by a collect in THIS process (shown by status()). */
let accessProblem: string | null = null;

const INSIGHTS_DENIED = 'Instagram insights are not allowed for this token. Reconnect Instagram (Social → Configuration) and grant '
    + '"instagram_manage_insights" (Facebook Login) or "instagram_business_manage_insights" (Instagram Login). '
    + 'The account must be a Business or Creator account — personal accounts have no insights.';
const PERSONAL_ACCOUNT = 'This Instagram account is a personal account — switch it to Business or Creator in the Instagram app, '
    + 'then reconnect, to collect insights.';

function status(credentials: Record<string, unknown>, connected: boolean,): SocialCollectorStatus {
    const base = { platform: 'instagram' as const, label: 'Instagram', };
    const auth = resolveInstagramAuth(credentials,);
    if (!connected || !auth) {
        return { ...base, state: 'off', message: 'Connect Instagram (a Business or Creator account) in Social → Configuration.', collects: [], };
    }
    const expires = Date.parse(String(credentials.tokenExpiresAt ?? '',),);
    if (Number.isFinite(expires,) && expires < Date.now()) {
        return { ...base, state: 'off', message: 'The Instagram token has expired — reconnect Instagram in Social → Configuration.', collects: [], };
    }
    const basic = ['Followers, following, post count', 'Per-post likes and comments',];
    const scopes = grantedScopes(credentials,);
    if (scopes && !scopes.some((s,) => INSIGHTS_SCOPES.includes(s,))) {
        return { ...base, state: 'partial', message: INSIGHTS_DENIED, collects: basic, };
    }
    if (accessProblem) return { ...base, state: 'partial', message: accessProblem, collects: basic, };
    return {
        ...base,
        state: 'ready',
        message: null,
        collects: [
            ...basic,
            'Daily views, reach, likes, comments, shares, saves, interactions, profile link taps',
            'Daily follows / unfollows',
            'Per-post views, reach, shares, saves; Reels watch time + avg watch time',
            'Stories (views, reach, replies, shares) every 3 hours while live',
        ],
    };
}

/** Account total_value metric → our daily metric. */
export const IG_DAILY_METRICS: Record<string, string> = {
    views: 'views',
    reach: 'reach',
    likes: 'likes',
    comments: 'comments',
    shares: 'shares',
    saves: 'saves',
    total_interactions: 'engagements',
    accounts_engaged: 'accountsEngaged',
    profile_links_taps: 'profileLinkTaps',
};

/** One day's total_value response → points on that day. */
export function totalValuePoints(resp: InsightResponse, date: string,): DailyPoint[] {
    const points: DailyPoint[] = [];
    for (const [name, value,] of insightNumbers(resp,)) {
        const metric = IG_DAILY_METRICS[name];
        if (metric) points.push({ date, metric, value, },);
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
                const value = Number(r.value,);
                if (!Number.isFinite(value,)) continue;
                if (kind === 'FOLLOWER') points.push({ date, metric: 'followersGained', value, },);
                else if (kind === 'NON_FOLLOWER') points.push({ date, metric: 'followersLost', value, },);
            }
        }
    }
    return points;
}

type MediaKind = 'REELS' | 'FEED' | 'STORY';

const MEDIA_METRICS: Record<MediaKind, string[]> = {
    FEED: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'profile_visits', 'follows',],
    REELS: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time',],
    STORY: ['views', 'reach', 'replies', 'shares', 'total_interactions', 'follows', 'profile_visits',],
};

export function mediaKind(fields: { media_product_type?: string; media_type?: string; },): MediaKind {
    const t = String(fields.media_product_type ?? '',).toUpperCase();
    if (t === 'REELS' || t === 'STORY') return t;
    return 'FEED';
}

const ms = (v: number | undefined,): number | null => (v === undefined ? null : v / 1000);

/** Media node fields + its insights → our post metric. */
export function mapInstagramMedia(
    id: string,
    fields: { like_count?: number; comments_count?: number; media_product_type?: string; media_type?: string; },
    insights: Map<string, number>,
): PostMetric {
    const g = (k: string,): number | null => insights.get(k,) ?? null;
    return {
        externalId: id,
        views: g('views',),
        reach: g('reach',),
        likes: g('likes',) ?? fields.like_count ?? null,
        comments: g('comments',) ?? fields.comments_count ?? null,
        shares: g('shares',),
        saves: g('saved',),
        watchTimeS: ms(insights.get('ig_reels_video_view_total_time',),),
        avgWatchS: ms(insights.get('ig_reels_avg_watch_time',),),
        raw: {
            mediaProductType: fields.media_product_type ?? null,
            mediaType: fields.media_type ?? null,
            totalInteractions: g('total_interactions',),
            profileVisits: g('profile_visits',),
            follows: g('follows',),
        },
    };
}

/** Story insights → per-story daily points on the story's posting day. */
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

/** Thrown out of a phase when insights are refused — the rest is skipped. */
class InsightsDenied extends Error {}

function guard(e: unknown,): never {
    if (isTokenError(e,)) throw new Error(`Instagram token rejected — reconnect Instagram in Social → Configuration (${(e as Error).message}).`,);
    if (isPermissionError(e,)) throw new InsightsDenied((e as Error).message,);
    throw e;
}

async function accountSnapshot(auth: InstagramAuth,): Promise<AccountSnapshot> {
    const fields = ['followers_count', 'follows_count', 'media_count', 'username',];
    if (auth.instagramLogin) fields.push('account_type',);
    const a = await graphGet<Record<string, unknown>>(auth.base, auth.userId, { fields: fields.join(',',), }, auth.token,);
    if (a.account_type === 'PERSONAL') accessProblem = PERSONAL_ACCOUNT;
    const n = (v: unknown,): number | null => (typeof v === 'number' ? v : null);
    return { followers: n(a.followers_count,), following: n(a.follows_count,), postsCount: n(a.media_count,), raw: a, };
}

async function dailyInsights(auth: InstagramAuth, ctx: CollectContext, warnings: WarningBag,): Promise<DailyPoint[]> {
    const dead = new Set<string>();
    const points: DailyPoint[] = [];
    const path = `${auth.userId}/insights`;
    for (let i = DAILY_WINDOW; i >= 1; i--) {
        const date = addDays(ctx.today, -i,);
        const window = { period: 'day', since: String(unixDay(date,),), until: String(unixDay(addDays(date, 1,),),), };
        try {
            const totals = await fetchInsights(auth.base, path, Object.keys(IG_DAILY_METRICS,), { ...window, metric_type: 'total_value', }, auth.token, dead, warnings, 'Instagram daily',);
            points.push(...totalValuePoints(totals, date,),);
            const follows = await fetchInsights(auth.base, path, ['follows_and_unfollows',], { ...window, metric_type: 'total_value', breakdown: 'follow_type', }, auth.token, dead, warnings, 'Instagram follows',);
            points.push(...followPoints(follows, date,),);
        } catch (e) {
            guard(e,);
        }
    }
    // Older daily series of new followers — fills followersGained where the
    // breakdown returned nothing (under 100 followers, older Graph data…).
    try {
        const series = await fetchInsights(auth.base, path, ['follower_count',], {
            period: 'day',
            since: String(unixDay(addDays(ctx.today, -DAILY_WINDOW,),),),
            until: String(unixDay(ctx.today,),),
        }, auth.token, dead, warnings, 'Instagram follower_count',);
        const have = new Set(points.filter((p,) => p.metric === 'followersGained').map((p,) => p.date),);
        for (const p of timeSeriesPoints(series, { follower_count: 'followersGained', },)) {
            if (!have.has(p.date,)) points.push(p,);
        }
    } catch (e) {
        guard(e,);
    }
    return points;
}

async function mediaInsights(auth: InstagramAuth, ctx: CollectContext, warnings: WarningBag,): Promise<PostMetric[]> {
    const dead: Record<MediaKind, Set<string>> = { FEED: new Set(), REELS: new Set(), STORY: new Set(), };
    let denied: unknown = null;
    const results = await mapLimit(ctx.posts, CONCURRENCY, async (post,): Promise<PostMetric | null> => {
        let fields: Record<string, any>;
        try {
            fields = await graphGet(auth.base, post.externalId, { fields: 'id,media_type,media_product_type,like_count,comments_count', }, auth.token,);
        } catch (e) {
            if (isTokenError(e,)) guard(e,);
            warnings.add(`Instagram media lookup failed — ${(e as Error).message}`,);
            return null;
        }
        const kind = mediaKind(fields,);
        let insights = new Map<string, number>();
        if (!denied) {
            try {
                const resp = await fetchInsights(auth.base, `${post.externalId}/insights`, MEDIA_METRICS[kind], {}, auth.token, dead[kind], warnings, `Instagram ${kind.toLowerCase()} insights`,);
                insights = insightNumbers(resp,);
            } catch (e) {
                if (isTokenError(e,)) guard(e,);
                if (isPermissionError(e,)) denied = e;
                else warnings.add(`Instagram media insights failed — ${(e as Error).message}`,);
            }
        }
        return mapInstagramMedia(post.externalId, fields, insights,);
    },);
    if (denied) throw new InsightsDenied((denied as Error).message,);
    return results.filter((r,): r is PostMetric => r !== null);
}

async function collect(ctx: CollectContext,): Promise<CollectResult> {
    const auth = resolveInstagramAuth(ctx.credentials,);
    if (!auth) throw new Error('Instagram is not connected (no access token or account id).',);
    const warnings = new WarningBag();
    const result: CollectResult = { daily: [], posts: [], };
    accessProblem = null;

    try {
        result.account = await accountSnapshot(auth,);
    } catch (e) {
        if (isTokenError(e,)) guard(e,);
        ctx.warn(`Instagram account: ${(e as Error).message}`,);
    }

    let insightsOk = accessProblem === null;
    if (insightsOk) {
        try {
            result.daily = await dailyInsights(auth, ctx, warnings,);
        } catch (e) {
            if (!(e instanceof InsightsDenied)) throw e;
            insightsOk = false;
            accessProblem = INSIGHTS_DENIED;
        }
    }

    if (insightsOk) {
        try {
            result.posts = await mediaInsights(auth, ctx, warnings,);
        } catch (e) {
            if (!(e instanceof InsightsDenied)) throw e;
            insightsOk = false;
            accessProblem = INSIGHTS_DENIED;
        }
    }
    // No insights access: keep the likes / comments counters the basic
    // permission still returns.
    if (!insightsOk) result.posts = await basicCounts(auth, ctx, warnings,);
    if (accessProblem) ctx.warn(accessProblem,);
    warnings.flush(ctx.warn,);
    return result;
}

async function basicCounts(auth: InstagramAuth, ctx: CollectContext, warnings: WarningBag,): Promise<PostMetric[]> {
    const out = await mapLimit(ctx.posts, CONCURRENCY, async (post,): Promise<PostMetric | null> => {
        try {
            const f = await graphGet(auth.base, post.externalId, { fields: 'id,media_type,media_product_type,like_count,comments_count', }, auth.token,);
            return mapInstagramMedia(post.externalId, f, new Map(),);
        } catch (e) {
            if (isTokenError(e,)) guard(e,);
            warnings.add(`Instagram media lookup failed — ${(e as Error).message}`,);
            return null;
        }
    },);
    return out.filter((r,): r is PostMetric => r !== null);
}

/** Per-story rows for `dates`, re-summed into the account total + a story count. */
async function storyTotals(dates: string[],): Promise<DailyPoint[]> {
    if (!dates.length) return [];
    const r = await query<{ date: string; metric: string; total: string; stories: string; }>(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date, metric, SUM(value) AS total, COUNT(DISTINCT dimension) AS stories
           FROM social_account_daily
          WHERE platform = 'instagram' AND dimension LIKE 'story:%' AND date = ANY($1::date[])
          GROUP BY date, metric`,
        [dates,],
    );
    const points: DailyPoint[] = [];
    const counts = new Map<string, number>();
    for (const row of r.rows) {
        points.push({ date: row.date, metric: row.metric, value: Number(row.total,), },);
        counts.set(row.date, Math.max(counts.get(row.date,) ?? 0, Number(row.stories,),),);
    }
    for (const [date, value,] of counts) points.push({ date, metric: 'stories', value, },);
    return points;
}

/** Cron: capture live stories' insights before they expire (24 h). */
export async function collectStories(): Promise<void> {
    const { loadConnection, storeResult, utcDay, } = await import('../runner.js');
    const conn = await loadConnection('instagram',);
    if (!conn?.is_connected || !conn.is_enabled) return;
    const auth = resolveInstagramAuth(conn.credentials ?? {},);
    if (!auth) return;
    const warnings = new WarningBag();
    const dead = new Set<string>();
    let stories: Array<{ id: string; timestamp?: string; }>;
    try {
        const r = await graphGet<{ data?: Array<{ id: string; timestamp?: string; }>; }>(auth.base, `${auth.userId}/stories`, { fields: 'id,timestamp,media_type', }, auth.token,);
        stories = r.data ?? [];
    } catch (e) {
        logger.warn('social-analytics: Instagram stories fetch failed', { error: (e as Error).message, },);
        return;
    }
    const points: DailyPoint[] = [];
    for (const s of stories) {
        if (!s.timestamp) continue;
        let resp: InsightResponse;
        try {
            resp = await fetchInsights(auth.base, `${s.id}/insights`, Object.keys(STORY_METRICS,), {}, auth.token, dead, warnings, 'Instagram story',);
        } catch (e) {
            // Under 5 viewers → "(#10) Not enough viewers": nothing to store yet.
            if (isTokenError(e,) || isPermissionError(e,)) {
                logger.warn('social-analytics: Instagram story insights refused', { error: (e as Error).message, },);
                return;
            }
            continue;
        }
        points.push(...storyPoints(s.id, s.timestamp, insightNumbers(resp,),),);
    }
    if (!points.length) return;
    const today = utcDay();
    await storeResult('instagram', today, { daily: points, }, [],);
    const dates = [...new Set(points.map((p,) => p.date),),];
    await storeResult('instagram', today, { daily: await storyTotals(dates,), }, [],);
    warnings.flush((m,) => logger.warn(`social-analytics: ${m}`,),);
}

registerCollector({
    platform: 'instagram',
    label: 'Instagram',
    connection: 'instagram',
    status,
    collect,
    crons: [{
        name: 'social-analytics-ig-stories',
        schedule: '25 */3 * * *',
        description: 'Captures live Instagram Stories insights (views, reach, replies, shares) before the 24-hour expiry.',
        handler: collectStories,
    },],
},);
