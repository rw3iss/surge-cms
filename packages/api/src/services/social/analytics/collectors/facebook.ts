/**
 * Facebook Page analytics collector (plan §3.3) — two tiers, every family on
 * its own (a refused family leaves the others collecting):
 *
 * BASIC (a Page token with pages_read_engagement / pages_show_list):
 *  1. Page node: followers_count, fan_count, name, link, category, verification (snapshot).
 *  2. Post discovery: /published_posts (else /posts) + /video_reels, 90 days and
 *     at least 25 items, upserted into social_posts (kinds post/photo/album/
 *     video/reel/live/link/event, thumbnails mirrored) — facebookMedia.ts.
 *  3. Per post: reactions / comments / shares summaries.
 *
 * INSIGHTS (read_insights + the ANALYZE task on the Page):
 *  4. Page daily, last 3 days rewritten (Meta revises ~48 h): follows, new /
 *     lost followers, media views, media viewers, post engagements, page
 *     views, video views (+ paid/organic, autoplay/click splits), 30-s views,
 *     repeat views, view time, reactions by type.
 *  5. page_media_view split by is_from_followers (follow:) and is_from_ads (paid:).
 *  6. Audience: followers by country / city (page_follows_country / _city).
 *  7. Post insights: media views, viewers, clicks (+ by type), reactions by
 *     type; video posts + views split, complete views, view time, average,
 *     length, retention; reels (video_insights) plays, replays, follows, view time.
 *
 * Metric names + removals: see facebookMapping.ts. What worked is saved as
 * `credentials.analyticsCapabilities`; status() turns it into ready / partial.
 * Credentials (social_connections 'facebook', else FACEBOOK_* env): a Page
 * token, or a user token with a role on the Page (swapped for the Page's
 * token), + `pageId` (else the first Page of /me/accounts, else /me).
 */
import type { SocialCollectorStatus, } from '@sitesurge/types';
import { config, } from '../../../../config';
import { query, } from '../../../../db';
import { logger, } from '../../../../utils/logger';
import { registerCollector, } from '../registry';
import type { AccountSnapshot, CollectContext, CollectResult, DailyPoint, PostMetric, } from '../types';
import {
    audiencePoints,
    FB_AUDIENCE_METRICS,
    FB_BREAKDOWNS,
    FB_DAILY_METRICS,
    FB_VIDEO_SPLITS,
    type FbCapabilities,
    fbCapabilityNotes,
    type FbPostNode,
    isBasicTier,
    isVideoKind,
    mapFacebookPost,
    pageBreakdownPoints,
    pageDailyPoints,
    POST_METRICS,
    POST_VIDEO_METRICS,
    REEL_METRICS,
} from './facebookMapping';
import { type FbItem, type FbPage, type FbReel, listPosts, listReels, mergeItems, POST_DAYS, upsertFacebookPosts, } from './facebookMedia';
import {
    addDays,
    chunk,
    envValue,
    FACEBOOK_GRAPH,
    fetchInsights,
    graphGet,
    type InsightResponse,
    insightNumbers,
    insightObjects,
    isMetricError,
    dueForMetrics,
    isPermissionError,
    isRateLimitError,
    isTokenError,
    mapLimit,
    tokenErrorHint,
    unixDay,
    WarningBag,
} from './metaGraph';

export { FB_DAILY_METRICS, fbPostKind, mapFacebookPost, } from './facebookMapping';

const DAILY_WINDOW = 3;
const CONCURRENCY = 4;
const INSIGHTS_SCOPE = 'read_insights';

const SETUP = 'Facebook is not connected. In Social → Configuration → Facebook, add a Page access token and the Page ID. '
    + 'pages_read_engagement + pages_show_list collect followers and every post with reactions, comments and shares; '
    + 'add read_insights (from a user with the ANALYZE task on the Page) for views, reach, video and audience.';
const UPGRADE = 'Basic Facebook connection — followers and posts only. To add daily views, reach, follows / unfollows, '
    + 'video watch time, per-post views and clicks, and followers by country / city: grant read_insights '
    + '(with pages_read_engagement), make sure the connecting user has the ANALYZE task on the Page '
    + '(Page settings → Page access), then reconnect Facebook in Social → Configuration.';

interface FacebookCreds {
    token: string;
    /** The connection's user token when `token` is a saved Page token — tried when the Page token is rejected. */
    fallbackToken: string | null;
    pageId: string | null;
}

export function facebookCreds(credentials: Record<string, unknown>,): FacebookCreds | null {
    const pageToken = String(credentials.pageAccessToken ?? '',).trim();
    const userToken = String(credentials.accessToken || envValue(config.social.facebook.accessToken,),).trim();
    const token = pageToken || userToken;
    if (!token) return null;
    const pageId = String(credentials.pageId || envValue(config.social.facebook.pageId,),).trim() || null;
    return { token, fallbackToken: pageToken && userToken && userToken !== pageToken ? userToken : null, pageId, };
}

/** Facebook's token error, with the reason and the fix (never the token). */
function tokenRejected(e: unknown,): Error {
    return new Error(`Facebook token rejected — ${tokenErrorHint(e,)}. Reconnect Facebook in Social → Configuration and pick the Page again (${(e as Error).message}).`,);
}

function grantedScopes(credentials: Record<string, unknown>,): string[] | null {
    const s = credentials.grantedScopes ?? credentials.scope;
    if (Array.isArray(s,)) return s.map(String,);
    if (typeof s === 'string' && s.trim()) return s.split(/[\s,]+/,);
    return null;
}

function capabilitiesOf(credentials: Record<string, unknown>,): FbCapabilities | null {
    const c = credentials.analyticsCapabilities;
    return c && typeof c === 'object' ? c as FbCapabilities : null;
}

const BASIC_COLLECTS = ['Page followers and likes', 'Every post and reel with reactions, comments, shares',];

function status(credentials: Record<string, unknown>, connected: boolean,): SocialCollectorStatus {
    const base = { platform: 'facebook' as const, label: 'Facebook', };
    const creds = facebookCreds(credentials,);
    if (!connected || !creds) return { ...base, state: 'off', message: SETUP, collects: [], };
    const expires = Date.parse(String(credentials.tokenExpiresAt ?? '',),);
    if (Number.isFinite(expires,) && expires < Date.now()) {
        return { ...base, state: 'off', message: 'The Facebook token has expired — reconnect Facebook in Social → Configuration.', collects: [], };
    }
    const scopes = grantedScopes(credentials,);
    const caps = capabilitiesOf(credentials,);
    if ((scopes && !scopes.includes(INSIGHTS_SCOPE,)) || isBasicTier(caps,)) {
        return { ...base, state: 'partial', message: UPGRADE, collects: BASIC_COLLECTS, };
    }
    const collects = [
        ...BASIC_COLLECTS,
        ...(caps?.accountInsights ?? true ? ['Daily views, viewers, engagements, page visits, reactions by type',] : []),
        ...(caps?.newFollowers ?? true ? ['Follows / unfollows per day',] : []),
        ...(caps?.breakdowns ?? true ? ['Views from followers vs non-followers, paid vs organic',] : []),
        ...(caps?.accountInsights ?? true ? ['Daily video views (paid / organic, autoplay / click), watch time',] : []),
        ...(caps?.mediaInsights ?? true ? ['Per-post views, viewers, clicks by type, reactions by type',] : []),
        ...(caps?.videoInsights ?? true ? ['Per-video and reel plays, watch time, average watched, retention',] : []),
        ...(caps?.demographics ?? true ? ['Followers by country and city',] : []),
    ];
    const missing = fbCapabilityNotes(caps,);
    if (missing.length) {
        return {
            ...base,
            state: 'partial',
            message: `Facebook does not give this Page: ${missing.join('; ',)}. Grant read_insights and the ANALYZE task on the Page, then reconnect.`,
            collects,
        };
    }
    return { ...base, state: 'ready', message: creds.pageId ? null : 'No Page ID saved — using the first Page this token manages.', collects, };
}

/** Thrown when a family of calls is refused — that family is skipped, the rest goes on. */
class Refused extends Error {}

function classify(e: unknown,): never {
    if (isTokenError(e,)) throw tokenRejected(e,);
    if (isPermissionError(e,)) throw new Refused((e as Error).message,);
    throw e;
}

/** Run one family on its own: a token error fails the run; a refusal or other error leaves it empty. */
async function attempt<T,>(fn: () => Promise<T>, fallback: T, warnings: WarningBag, label: string,): Promise<{ ok: boolean; value: T; }> {
    try {
        return { ok: true, value: await fn(), };
    } catch (e) {
        if (isTokenError(e,)) classify(e,);
        if (!(e instanceof Refused) && !isPermissionError(e,)) warnings.add(`${label}: ${(e as Error).message}`,);
        return { ok: false, value: fallback, };
    }
}

/**
 * Resolve the Page with the saved token; when a saved Page token is rejected
 * (revoked by a password change, a reconnect…) retry with the user token,
 * which is swapped for a fresh Page token.
 */
async function resolvePageWithFallback(creds: FacebookCreds, warn: (m: string,) => void,): Promise<FbPage> {
    try {
        return await resolvePage(creds,);
    } catch (e) {
        if (!isTokenError(e,) || !creds.fallbackToken) throw e;
        const page = await resolvePage({ ...creds, token: creds.fallbackToken, fallbackToken: null, },);
        warn('The saved Facebook Page token was rejected; collected with the account token instead. Pick the Page again in Social → Configuration → Facebook to save a fresh Page token.',);
        return page;
    }
}

/** Resolve the Page id + a Page token (a user token is swapped for the Page's). */
async function resolvePage(creds: FacebookCreds,): Promise<FbPage> {
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

const PAGE_FIELDS = 'followers_count,fan_count,name,link,category,verification_status';

async function pageSnapshot(page: FbPage,): Promise<AccountSnapshot> {
    let p: Record<string, unknown>;
    try {
        p = await graphGet<Record<string, unknown>>(FACEBOOK_GRAPH, page.id, { fields: PAGE_FIELDS, }, page.token,);
    } catch (e) {
        if (!isMetricError(e,)) throw e;
        p = await graphGet<Record<string, unknown>>(FACEBOOK_GRAPH, page.id, { fields: 'followers_count,fan_count,name', }, page.token,);
    }
    const n = (v: unknown,): number | null => (typeof v === 'number' ? v : null);
    return { followers: n(p.followers_count,) ?? n(p.fan_count,), raw: p, };
}

/** Page daily totals + video splits + reactions, one time-series call. */
async function pageDaily(page: FbPage, today: string, warnings: WarningBag,): Promise<DailyPoint[]> {
    const resp = await fetchInsights(FACEBOOK_GRAPH, `${page.id}/insights`, [...Object.keys(FB_DAILY_METRICS,), ...Object.keys(FB_VIDEO_SPLITS,),], {
        period: 'day',
        since: String(unixDay(addDays(today, -DAILY_WINDOW,),),),
        until: String(unixDay(today,),),
    }, page.token, new Set(), warnings, 'Facebook Page insights',);
    return pageDailyPoints(resp,).filter((p,) => p.date < today);
}

async function pageBreakdowns(page: FbPage, today: string, warnings: WarningBag,): Promise<DailyPoint[]> {
    const points: DailyPoint[] = [];
    for (const group of FB_BREAKDOWNS) {
        const dead = new Set<string>();
        for (let i = DAILY_WINDOW; i >= 1; i--) {
            const date = addDays(today, -i,);
            const resp = await fetchInsights(FACEBOOK_GRAPH, `${page.id}/insights`, group.metrics, {
                period: 'day', breakdown: group.breakdown, since: String(unixDay(date,),), until: String(unixDay(addDays(date, 1,),),),
            }, page.token, dead, warnings, `Facebook ${group.breakdown} split`,);
            points.push(...pageBreakdownPoints(resp, group.breakdown, date,),);
        }
    }
    return points.filter((p,) => p.date < today);
}

/** Followers by country / city: period lifetime, else day (Meta lists both forms for the old page_fans_*). */
async function audience(page: FbPage, today: string, warnings: WarningBag,): Promise<DailyPoint[]> {
    const points: DailyPoint[] = [];
    let lastError: unknown = null;
    let anyOk = false;
    for (const metric of Object.keys(FB_AUDIENCE_METRICS,)) {
        for (const period of ['lifetime', 'day',]) {
            try {
                const resp = await graphGet<InsightResponse>(FACEBOOK_GRAPH, `${page.id}/insights`, { metric, period, }, page.token,);
                points.push(...audiencePoints(resp, today,),);
                anyOk = true;
                break;
            } catch (e) {
                if (isTokenError(e,)) classify(e,);
                lastError = e;
                if (!isMetricError(e,)) break;
            }
        }
    }
    if (!anyOk && lastError) {
        if (isPermissionError(lastError,)) throw new Refused((lastError as Error).message,);
        warnings.add(`Facebook followers by country / city: ${(lastError as Error).message}`,);
    }
    return points;
}

/** Metrics found dead this run: post insights (incl. video extras) and reel video_insights. */
interface PostDeadSets {
    post: Set<string>;
    reel: Set<string>;
}

/** Lifetime insights for one item (post + video / reel extras). */
async function itemInsights(page: FbPage, item: FbItem, node: FbPostNode | null, dead: PostDeadSets, warnings: WarningBag,): Promise<{ metric: PostMetric; video: boolean; }> {
    const resp = await fetchInsights(FACEBOOK_GRAPH, `${item.externalId}/insights`, [
        ...POST_METRICS,
        // Video extras are asked of video posts only — a photo post refuses them.
        ...(isVideoKind(item.kind,) && item.kind !== 'reel' ? POST_VIDEO_METRICS : []),
    ], { period: 'lifetime', }, page.token, dead.post, warnings, 'Facebook post insights',);
    let reel = new Map<string, number>();
    let reelObjects: Record<string, unknown> = {};
    if (item.kind === 'reel' && item.videoId) {
        const r = await fetchInsights(FACEBOOK_GRAPH, `${item.videoId}/video_insights`, REEL_METRICS, {}, page.token, dead.reel, warnings, 'Facebook reel insights',);
        reel = insightNumbers(r,);
        reelObjects = insightObjects(r,);
    }
    const nums = insightNumbers(resp,);
    const objects = { ...reelObjects, ...insightObjects(resp,), };
    const video = reel.size > 0 || [...nums.keys(),].some((k,) => k.startsWith('post_video_',),);
    return { metric: mapFacebookPost(item.externalId, node ?? item.node, nums, objects, reel,), video, };
}

const SUMMARY_FIELDS = 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares';

async function postMetrics(page: FbPage, items: FbItem[], warnings: WarningBag,): Promise<{ ok: boolean; video: boolean; posts: PostMetric[]; }> {
    // Summaries for items the list did not carry (older due posts): 50 per request.
    const missing = items.filter((i,) => !i.node.reactions && !i.node.comments,);
    const nodes = new Map<string, FbPostNode>();
    for (const batch of chunk(missing.map((i,) => i.externalId), 50,)) {
        try {
            const r = await graphGet<Record<string, FbPostNode>>(FACEBOOK_GRAPH, '', { ids: batch.join(',',), fields: SUMMARY_FIELDS, }, page.token,);
            for (const [id, node,] of Object.entries(r,)) nodes.set(id, node,);
        } catch (e) {
            if (isTokenError(e,)) classify(e,);
            if (!isMetricError(e,)) {
                warnings.add(`Facebook post summaries failed — ${(e as Error).message}`,);
                continue;
            }
            // One deleted / unreachable post fails the whole ?ids= batch — ask the batch one by one.
            await mapLimit(batch, CONCURRENCY, async (id,) => {
                try {
                    nodes.set(id, await graphGet<FbPostNode>(FACEBOOK_GRAPH, id, { fields: SUMMARY_FIELDS, }, page.token,),);
                } catch (err) {
                    if (isTokenError(err,)) classify(err,);
                    // Same text each time so the bag reports it once with a count (Meta's message names the id).
                    warnings.add('Facebook post summaries: a post is no longer readable (deleted, hidden or not this Page\'s)',);
                }
            },);
        }
    }
    const nodeOf = (i: FbItem,) => (i.node.reactions || i.node.comments ? i.node : nodes.get(i.externalId,) ?? null);
    const dead: PostDeadSets = { post: new Set(), reel: new Set(), };
    let refused = false;
    let limited = false;
    let video = false;
    const posts = await mapLimit(items, CONCURRENCY, async (item,): Promise<PostMetric | null> => {
        const node = nodeOf(item,);
        const basic = () => (node ? mapFacebookPost(item.externalId, node, new Map(),) : null);
        if (refused || limited) return basic();
        try {
            const r = await itemInsights(page, item, node, dead, warnings,);
            if (r.video) video = true;
            return r.metric;
        } catch (e) {
            if (isTokenError(e,)) classify(e,);
            if (isPermissionError(e,)) refused = true;
            else if (isRateLimitError(e,)) {
                limited = true;
                warnings.add(`Facebook rate limit reached — the remaining posts keep only reactions / comments / shares this run (${(e as Error).message})`,);
            } else warnings.add(`Facebook post insights failed — ${(e as Error).message}`,);
            return basic();
        }
    },);
    return { ok: !refused, video, posts: posts.filter((p,): p is PostMetric => p !== null), };
}

async function saveCapabilities(caps: FbCapabilities,): Promise<void> {
    try {
        await query(
            `UPDATE social_connections SET credentials = COALESCE(credentials, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE provider = 'facebook'`,
            [JSON.stringify({ analyticsCapabilities: caps, },),],
        );
    } catch (e) {
        logger.warn('facebook: could not save capabilities', { error: (e as Error).message, },);
    }
}

/**
 * Benchmark Pages (Analytics → Settings → Benchmarks): public followers of
 * other Pages, by username or id. Reading another Page needs the app's Page
 * Public Metadata Access (or Page Public Content Access) feature; refused →
 * a warning per Page and benchmarks:false.
 */
async function benchmarkPages(page: FbPage, today: string, warnings: WarningBag,): Promise<{ ok: boolean; points: DailyPoint[]; }> {
    const { getSettings, } = await import('../settings.js');
    const refs = await getSettings().then((s,) => s.benchmarks.facebook ?? [],).catch(() => [] as string[],);
    const points: DailyPoint[] = [];
    let ok = false;
    for (const ref of refs) {
        // A Page username or numeric id only — never a path (`me/accounts`) or a query.
        if (!/^[A-Za-z0-9.\-]{1,100}$/.test(ref,)) {
            warnings.add(`Facebook benchmark "${ref}": not a Page username or id`,);
            continue;
        }
        try {
            const p = await graphGet<{ followers_count?: number; fan_count?: number; }>(FACEBOOK_GRAPH, ref, { fields: 'followers_count,fan_count,name', }, page.token,);
            const followers = typeof p.followers_count === 'number' ? p.followers_count : p.fan_count;
            if (typeof followers === 'number') {
                points.push({ date: today, metric: 'peerFollowers', value: followers, dimension: `peer:${ref.toLowerCase()}`, },);
                ok = true;
            }
        } catch (e) {
            if (isTokenError(e,)) classify(e,);
            warnings.add(`Facebook benchmark ${ref}: ${(e as Error).message}`,);
        }
    }
    return { ok, points, };
}

async function collect(ctx: CollectContext,): Promise<CollectResult> {
    const creds = facebookCreds(ctx.credentials,);
    if (!creds) throw new Error(SETUP,);
    const warnings = new WarningBag();
    let page: FbPage;
    try {
        page = await resolvePageWithFallback(creds, ctx.warn,);
    } catch (e) {
        if (isTokenError(e,)) classify(e,);
        throw e;
    }
    const result: CollectResult = { daily: [], posts: [], };

    // BASIC — 1. Page node.
    const snap = await attempt(() => pageSnapshot(page,), null as AccountSnapshot | null, warnings, 'Facebook Page',);
    if (snap.value) result.account = snap.value;

    // BASIC — 2. Posts + reels → social_posts, plus the due posts the list no longer reaches.
    const listed = await attempt(() => listPosts(page,), [] as FbPostNode[], warnings, 'Facebook posts list',);
    const reels = await attempt(() => listReels(page,), [] as FbReel[], warnings, 'Facebook reels list',);
    const items = mergeItems(page.id, listed.value, reels.value,);
    if (items.length) {
        try {
            await upsertFacebookPosts(items,);
        } catch (e) {
            warnings.add(`Facebook posts: ${(e as Error).message}`,);
        }
    }
    // Metrics for the due posts + newly listed recent ones (not the old tail of the last listed page).
    const due = new Set(ctx.posts.map((p,) => p.externalId),);
    const measured = items.filter((i,) => dueForMetrics(i.externalId, i.node.created_time, due, ctx.today, POST_DAYS,),);
    const known = new Set(items.map((i,) => i.externalId),);
    for (const p of ctx.posts) {
        if (known.has(p.externalId,)) continue;
        measured.push({ externalId: p.externalId, kind: p.kind ?? 'post', videoId: null, node: { id: p.externalId, }, },);
    }

    // BASIC + INSIGHTS — 3 / 7. Per post.
    const media = await postMetrics(page, measured, warnings,);
    result.posts = media.posts;

    // INSIGHTS — 4–6.
    const daily = await attempt(() => pageDaily(page, ctx.today, warnings,), [] as DailyPoint[], warnings, 'Facebook Page insights',);
    const splits = await attempt(() => pageBreakdowns(page, ctx.today, warnings,), [] as DailyPoint[], warnings, 'Facebook splits',);
    const demo = await attempt(() => audience(page, ctx.today, warnings,), [] as DailyPoint[], warnings, 'Facebook audience',);
    const peers = await benchmarkPages(page, ctx.today, warnings,);
    result.daily = [...daily.value, ...splits.value, ...demo.value, ...peers.points,];

    const caps: FbCapabilities = {
        pageNode: snap.ok,
        postsList: listed.ok,
        reels: reels.ok,
        accountInsights: daily.ok && daily.value.some((p,) => !p.dimension && p.metric !== 'followersGained' && p.metric !== 'followersLost'),
        breakdowns: splits.ok && splits.value.length > 0,
        newFollowers: daily.ok && daily.value.some((p,) => p.metric === 'followersGained' || p.metric === 'followersLost'),
        demographics: demo.ok && demo.value.length > 0,
        onlineFollowers: false,
        mediaInsights: media.ok,
        videoInsights: media.video,
        benchmarks: peers.ok,
        checkedAt: new Date().toISOString(),
    };
    await saveCapabilities(caps,);
    if (isBasicTier(caps,)) ctx.warn(UPGRADE,);
    else {
        const missing = fbCapabilityNotes(caps,);
        if (missing.length) ctx.warn(`Facebook did not provide: ${missing.join('; ',)} — grant read_insights + the ANALYZE task on the Page and reconnect.`,);
    }
    warnings.flush(ctx.warn,);
    return result;
}

registerCollector({ platform: 'facebook', label: 'Facebook', connection: 'facebook', status, collect, },);
