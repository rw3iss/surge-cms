/**
 * Facebook Page analytics collector (plan §3.3).
 *
 *  1. Page node: followers_count (fan_count as the fallback) — snapshot.
 *  2. Page insights, period=day, last 3 days (rewritten each run):
 *     page_follows (total followers that day) → followers,
 *     page_daily_follows_unique / page_daily_unfollows_unique → followersGained / followersLost,
 *     page_media_view → views, page_total_media_view_unique → reach,
 *     page_post_engagements → engagements, page_views_total → pageViews,
 *     page_video_views → videoViews, page_video_view_time (ms) → watchTimeMinutes.
 *     Meta removed page_fans / page_impressions* (2025-11-15) and the *_unique
 *     impression variants (2026-06-15); every metric that fails is dropped for
 *     the run with a warning (metaGraph.fetchInsights).
 *  3. Per due post: reactions / comments / shares summaries (no insights
 *     permission needed) + lifetime insights post_media_view → views,
 *     post_total_media_view_unique → reach, post_clicks → clicks,
 *     post_video_view_time (ms) → watchTimeS, post_video_views and
 *     post_reactions_by_type_total → raw.
 *
 * Credentials (social_connections 'facebook', else FACEBOOK_* env): a Page
 * access token, or a user token with a role on the Page (the Page token is
 * then fetched from `/{page-id}?fields=access_token`), + the Page id
 * (`pageId`; when missing, the first Page of `/me/accounts`, else `/me`).
 * Permissions: pages_read_engagement + read_insights (+ pages_show_list), and
 * the ANALYZE task on the Page.
 */
import type { SocialCollectorStatus, } from '@sitesurge/types';
import { config, } from '../../../../config';
import { registerCollector, } from '../registry';
import type { AccountSnapshot, CollectContext, CollectResult, DailyPoint, PostMetric, } from '../types';
import {
    addDays,
    chunk,
    envValue,
    FACEBOOK_GRAPH,
    fetchInsights,
    graphGet,
    insightNumbers,
    insightObjects,
    isPermissionError,
    isTokenError,
    mapLimit,
    timeSeriesPoints,
    unixDay,
    WarningBag,
} from './metaGraph';

const DAILY_WINDOW = 3;
const CONCURRENCY = 4;

const SETUP = 'Facebook is not connected. In Social → Configuration → Facebook, add a Page access token (permissions '
    + 'pages_read_engagement, read_insights, pages_show_list — the user must be able to ANALYZE the Page) and the Page ID.';

export const FB_DAILY_METRICS: Record<string, string> = {
    page_follows: 'followers',
    page_daily_follows_unique: 'followersGained',
    page_daily_unfollows_unique: 'followersLost',
    page_media_view: 'views',
    page_total_media_view_unique: 'reach',
    page_post_engagements: 'engagements',
    page_views_total: 'pageViews',
    page_video_views: 'videoViews',
    page_video_view_time: 'watchTimeMinutes',
};
/** page_video_view_time is milliseconds; we store minutes. */
const FB_DAILY_SCALE: Record<string, number> = { page_video_view_time: 1 / 60000, };

const POST_INSIGHTS = [
    'post_media_view',
    'post_total_media_view_unique',
    'post_clicks',
    'post_video_views',
    'post_video_view_time',
    'post_reactions_by_type_total',
];

interface FacebookCreds {
    token: string;
    pageId: string | null;
}

export function facebookCreds(credentials: Record<string, unknown>,): FacebookCreds | null {
    const token = String(credentials.pageAccessToken || credentials.accessToken || envValue(config.social.facebook.accessToken,),).trim();
    if (!token) return null;
    const pageId = String(credentials.pageId || envValue(config.social.facebook.pageId,),).trim() || null;
    return { token, pageId, };
}

let accessProblem: string | null = null;
const INSIGHTS_DENIED = 'Facebook Page insights were refused. Reconnect with a Page token that has read_insights + '
    + 'pages_read_engagement, from a user who can ANALYZE the Page (Page settings → Page roles / access).';

function status(credentials: Record<string, unknown>, connected: boolean,): SocialCollectorStatus {
    const base = { platform: 'facebook' as const, label: 'Facebook', };
    const creds = facebookCreds(credentials,);
    if (!connected || !creds) return { ...base, state: 'off', message: SETUP, collects: [], };
    const basic = ['Page followers', 'Per-post reactions, comments, shares',];
    if (accessProblem) return { ...base, state: 'partial', message: accessProblem, collects: basic, };
    return {
        ...base,
        state: 'ready',
        message: creds.pageId ? null : 'No Page ID saved — using the first Page this token manages.',
        collects: [
            ...basic,
            'Daily views, unique viewers, engagements, page visits, follows / unfollows',
            'Daily video views + watch time',
            'Per-post views, unique viewers, clicks, video watch time',
        ],
    };
}

/** Resolve the Page id + a Page token (a user token is swapped for the Page's). */
async function resolvePage(creds: FacebookCreds,): Promise<{ id: string; token: string; }> {
    if (creds.pageId) {
        try {
            const p = await graphGet<{ access_token?: string; }>(FACEBOOK_GRAPH, creds.pageId, { fields: 'access_token', }, creds.token,);
            return { id: creds.pageId, token: p.access_token || creds.token, };
        } catch (e) {
            if (isTokenError(e,)) throw e;
            // A Page token cannot read its own access_token field — use it as is.
            return { id: creds.pageId, token: creds.token, };
        }
    }
    try {
        const pages = await graphGet<{ data?: Array<{ id: string; access_token?: string; }>; }>(FACEBOOK_GRAPH, 'me/accounts', { fields: 'id,access_token', }, creds.token,);
        const first = pages.data?.[0];
        if (first) return { id: first.id, token: first.access_token || creds.token, };
    } catch (e) {
        if (isTokenError(e,)) throw e;
    }
    const me = await graphGet<{ id: string; }>(FACEBOOK_GRAPH, 'me', { fields: 'id', }, creds.token,);
    return { id: me.id, token: creds.token, };
}

/** Post node fields (summaries) + lifetime insights → our post metric. */
export function mapFacebookPost(
    id: string,
    node: { reactions?: { summary?: { total_count?: number; }; }; comments?: { summary?: { total_count?: number; }; }; shares?: { count?: number; }; } | null,
    insights: Map<string, number>,
    objects: Record<string, unknown> = {},
): PostMetric {
    const g = (k: string,): number | null => insights.get(k,) ?? null;
    const viewMs = insights.get('post_video_view_time',);
    return {
        externalId: id,
        views: g('post_media_view',),
        reach: g('post_total_media_view_unique',),
        clicks: g('post_clicks',),
        likes: node?.reactions?.summary?.total_count ?? null,
        comments: node?.comments?.summary?.total_count ?? null,
        shares: node?.shares?.count ?? (node ? 0 : null),
        watchTimeS: viewMs === undefined ? null : viewMs / 1000,
        raw: {
            videoViews: g('post_video_views',),
            reactionsByType: objects.post_reactions_by_type_total ?? null,
        },
    };
}

class InsightsDenied extends Error {}

async function collect(ctx: CollectContext,): Promise<CollectResult> {
    const creds = facebookCreds(ctx.credentials,);
    if (!creds) throw new Error(SETUP,);
    accessProblem = null;
    const warnings = new WarningBag();
    const fatal = (e: unknown,): never => {
        if (isTokenError(e,)) throw new Error(`Facebook token rejected — reconnect Facebook in Social → Configuration (${(e as Error).message}).`,);
        if (isPermissionError(e,)) throw new InsightsDenied((e as Error).message,);
        throw e;
    };
    let page: { id: string; token: string; };
    try {
        page = await resolvePage(creds,);
    } catch (e) {
        return fatal(e,);
    }
    const result: CollectResult = { daily: [], posts: [], };

    // 1. Snapshot.
    try {
        const p = await graphGet<{ followers_count?: number; fan_count?: number; name?: string; }>(FACEBOOK_GRAPH, page.id, { fields: 'followers_count,fan_count,name', }, page.token,);
        const account: AccountSnapshot = { followers: p.followers_count ?? p.fan_count ?? null, raw: p, };
        result.account = account;
    } catch (e) {
        if (isTokenError(e,)) fatal(e,);
        ctx.warn(`Facebook Page: ${(e as Error).message}`,);
    }

    // 2. Daily Page insights.
    let insightsOk = true;
    try {
        const resp = await fetchInsights(FACEBOOK_GRAPH, `${page.id}/insights`, Object.keys(FB_DAILY_METRICS,), {
            period: 'day',
            since: String(unixDay(addDays(ctx.today, -DAILY_WINDOW,),),),
            until: String(unixDay(ctx.today,),),
        }, page.token, new Set(), warnings, 'Facebook Page insights',);
        result.daily = timeSeriesPoints(resp, FB_DAILY_METRICS, FB_DAILY_SCALE,).filter((p: DailyPoint,) => p.date < ctx.today);
    } catch (e) {
        try {
            fatal(e,);
        } catch (inner) {
            if (!(inner instanceof InsightsDenied)) throw inner;
            insightsOk = false;
            accessProblem = INSIGHTS_DENIED;
        }
    }

    // 3. Posts: summaries in batches of 50, insights one post at a time.
    const nodes = new Map<string, any>();
    for (const batch of chunk(ctx.posts.map((p,) => p.externalId), 50,)) {
        try {
            const r = await graphGet<Record<string, any>>(FACEBOOK_GRAPH, '', {
                ids: batch.join(',',),
                fields: 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares',
            }, page.token,);
            for (const [id, node,] of Object.entries(r,)) nodes.set(id, node,);
        } catch (e) {
            if (isTokenError(e,)) fatal(e,);
            warnings.add(`Facebook post summaries failed — ${(e as Error).message}`,);
        }
    }
    const dead = new Set<string>();
    let denied = !insightsOk;
    const posts = await mapLimit(ctx.posts, CONCURRENCY, async (post,): Promise<PostMetric | null> => {
        const node = nodes.get(post.externalId,) ?? null;
        if (denied) return node ? mapFacebookPost(post.externalId, node, new Map(),) : null;
        try {
            const resp = await fetchInsights(FACEBOOK_GRAPH, `${post.externalId}/insights`, POST_INSIGHTS, { period: 'lifetime', }, page.token, dead, warnings, 'Facebook post insights',);
            return mapFacebookPost(post.externalId, node, insightNumbers(resp,), insightObjects(resp,),);
        } catch (e) {
            if (isTokenError(e,)) fatal(e,);
            if (isPermissionError(e,)) {
                denied = true;
                accessProblem = INSIGHTS_DENIED;
            } else warnings.add(`Facebook post insights failed — ${(e as Error).message}`,);
            return node ? mapFacebookPost(post.externalId, node, new Map(),) : null;
        }
    },);
    result.posts = posts.filter((p,): p is PostMetric => p !== null);

    if (accessProblem) ctx.warn(accessProblem,);
    warnings.flush(ctx.warn,);
    return result;
}

registerCollector({ platform: 'facebook', label: 'Facebook', connection: 'facebook', status, collect, },);
