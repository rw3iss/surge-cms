/**
 * Instagram analytics collector — everything the Graph API gives a
 * Business / Creator account (plan §3.2). Each part runs on its own, so an
 * account that is refused one family (e.g. account-level insights before it
 * is a Business account) still collects the rest:
 *
 *  1. Account node: followers, following, media count (snapshot).
 *  2. Media discovery: the account's media list (newest first, 90 days and at
 *     least 25 items, ≤ 300) is upserted into social_posts — so every post,
 *     reel and carousel is tracked, not only the ones the feed sync captured.
 *  3. Media insights per item by product type (views, reach, likes, comments,
 *     shares, saves, interactions, profile visits/activity, follows; Reels +
 *     watch time, avg watch time, skip rate). Refused → the like/comment
 *     counters from the media list are still stored.
 *  4. Account insights, last 3 days (Meta revises ~48 h): views, reach,
 *     likes, comments, shares, saves, replies, interactions, accounts engaged,
 *     profile link taps; follows/unfollows; splits by content type and by
 *     followers vs non-followers; the daily new-followers series.
 *  5. Audience (daily snapshot): follower / engaged / reached demographics by
 *     age, gender, country, city, and followers online per hour.
 *  6. Stories: listed + measured every 3 hours while live (they expire after
 *     24 h) — stored as hidden social_posts (kind 'story') with per-story
 *     metrics and navigation (taps forward/back, exits), plus daily totals.
 *  7. Benchmarks: public Business/Creator accounts from Analytics settings via
 *     business_discovery (Facebook-Login connections only).
 *
 * What worked is recorded as `credentials.analyticsCapabilities`, read by
 * status() and the Audience panel. Host: Facebook-Login token (EAA…) →
 * graph.facebook.com; Instagram-Login token (IG…) → graph.instagram.com.
 */
import type { SocialCollectorStatus, } from '@sitesurge/types';
import { config, } from '../../../../config';
import { query, } from '../../../../db';
import { logger, } from '../../../../utils/logger';
import { registerCollector, } from '../registry';
import type { AccountSnapshot, CollectContext, CollectResult, DailyPoint, KnownPost, PostMetric, } from '../types';
import { listMedia, listStories, type IgMedia, upsertInstagramMedia, } from './instagramMedia';
import {
    AUDIENCE_BREAKDOWNS,
    AUDIENCE_METRICS,
    benchmarkPoints,
    breakdownPoints,
    capabilityNotes,
    demographicPoints,
    type DiscoveredAccount,
    followPoints,
    IG_BREAKDOWNS,
    IG_DAILY_METRICS,
    type IgCapabilities,
    mapInstagramMedia,
    MEDIA_METRICS,
    mediaKind,
    type MediaKind,
    navigationBreakdown,
    onlineFollowerPoints,
    STORY_METRICS,
    storyPoints,
    totalValuePoints,
} from './instagramMapping';
import {
    addDays,
    envValue,
    FACEBOOK_GRAPH,
    fetchInsights,
    graphGet,
    INSTAGRAM_GRAPH,
    type InsightResponse,
    insightNumbers,
    isPermissionError,
    isTokenError,
    mapLimit,
    timeSeriesPoints,
    unixDay,
    WarningBag,
} from './metaGraph';

export {
    breakdownPoints, demographicPoints, followPoints, igPostKind, mapInstagramMedia, mediaKind, navigationBreakdown,
    onlineFollowerPoints, storyPoints, totalValuePoints, benchmarkPoints,
} from './instagramMapping';

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

const INSIGHTS_DENIED = 'Instagram insights are not allowed for this token. Reconnect Instagram (Social → Configuration) and grant '
    + '"instagram_manage_insights" (Facebook Login) or "instagram_business_manage_insights" (Instagram Login). '
    + 'The account must be a Business or Creator account — personal accounts have no insights.';
const PERSONAL_ACCOUNT = 'This Instagram account is a personal account — switch it to Business or Creator in the Instagram app, '
    + 'then reconnect, to collect insights.';

function capabilitiesOf(credentials: Record<string, unknown>,): IgCapabilities | null {
    const c = credentials.analyticsCapabilities;
    return c && typeof c === 'object' ? c as IgCapabilities : null;
}

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
    const basic = ['Followers, following, post count', 'Every post, reel and carousel with likes and comments',];
    const scopes = grantedScopes(credentials,);
    if (scopes && !scopes.some((s,) => INSIGHTS_SCOPES.includes(s,))) {
        return { ...base, state: 'partial', message: INSIGHTS_DENIED, collects: basic, };
    }
    const caps = capabilitiesOf(credentials,);
    const collects = [
        ...basic,
        ...(caps?.mediaInsights ?? true ? ['Per-post views, reach, shares, saves, profile visits; Reels watch time + skip rate',] : []),
        ...(caps?.accountInsights ?? true ? ['Daily views, reach, interactions, profile link taps; content-type and follower splits',] : []),
        ...(caps?.newFollowers ?? true ? ['New followers per day',] : []),
        ...(caps?.demographics ?? true ? ['Audience by age, gender, country, city',] : []),
        ...(caps?.onlineFollowers ?? true ? ['When followers are online (best time to post)',] : []),
        'Stories every 3 hours while live',
        ...(caps?.benchmarks ? ['Benchmark accounts (Analytics → Settings)',] : []),
    ];
    if (credentials.accountType === 'PERSONAL') return { ...base, state: 'partial', message: PERSONAL_ACCOUNT, collects: basic, };
    const missing = capabilityNotes(caps,);
    if (missing.length) {
        return {
            ...base,
            state: 'partial',
            message: `Instagram does not give this account: ${missing.join('; ',)}. Switch the account to a Business account `
                + '(Instagram app → Settings → Account type and tools) and reconnect; demographics also need 100+ followers.',
            collects,
        };
    }
    return { ...base, state: 'ready', message: null, collects, };
}

/** Thrown when a family of calls is refused — that family is skipped, the rest goes on. */
class Refused extends Error {}

function classify(e: unknown,): never {
    if (isTokenError(e,)) throw new Error(`Instagram token rejected — reconnect Instagram in Social → Configuration (${(e as Error).message}).`,);
    if (isPermissionError(e,)) throw new Refused((e as Error).message,);
    throw e;
}

/**
 * Run one family on its own: a token error fails the run (nothing works), a
 * permission refusal or any other error leaves this family empty (the latter
 * also as a warning) so the other families still collect.
 */
async function attempt<T,>(fn: () => Promise<T>, fallback: T, warnings?: WarningBag, label?: string,): Promise<{ ok: boolean; value: T; }> {
    try {
        return { ok: true, value: await fn(), };
    } catch (e) {
        if (isTokenError(e,)) classify(e,);
        if (!(e instanceof Refused) && !isPermissionError(e,) && warnings && label) warnings.add(`${label}: ${(e as Error).message}`,);
        return { ok: false, value: fallback, };
    }
}

async function accountSnapshot(auth: InstagramAuth,): Promise<AccountSnapshot> {
    const fields = ['followers_count', 'follows_count', 'media_count', 'username',];
    if (auth.instagramLogin) fields.push('account_type',);
    const a = await graphGet<Record<string, unknown>>(auth.base, auth.userId, { fields: fields.join(',',), }, auth.token,);
    const n = (v: unknown,): number | null => (typeof v === 'number' ? v : null);
    return { followers: n(a.followers_count,), following: n(a.follows_count,), postsCount: n(a.media_count,), raw: a, };
}

/** Days the daily account insights cover (yesterday back DAILY_WINDOW days). */
function dailyWindow(today: string,): Array<{ date: string; params: Record<string, string>; }> {
    const out: Array<{ date: string; params: Record<string, string>; }> = [];
    for (let i = DAILY_WINDOW; i >= 1; i--) {
        const date = addDays(today, -i,);
        out.push({ date, params: { period: 'day', since: String(unixDay(date,),), until: String(unixDay(addDays(date, 1,),),), metric_type: 'total_value', }, },);
    }
    return out;
}

async function accountTotals(auth: InstagramAuth, today: string, warnings: WarningBag,): Promise<DailyPoint[]> {
    const dead = new Set<string>();
    const path = `${auth.userId}/insights`;
    const points: DailyPoint[] = [];
    for (const day of dailyWindow(today,)) {
        const totals = await fetchInsights(auth.base, path, Object.keys(IG_DAILY_METRICS,), day.params, auth.token, dead, warnings, 'Instagram daily',);
        points.push(...totalValuePoints(totals, day.date,),);
        const follows = await fetchInsights(auth.base, path, ['follows_and_unfollows',], { ...day.params, breakdown: 'follow_type', }, auth.token, dead, warnings, 'Instagram follows',);
        points.push(...followPoints(follows, day.date,),);
    }
    return points;
}

async function accountBreakdowns(auth: InstagramAuth, today: string, warnings: WarningBag,): Promise<DailyPoint[]> {
    const path = `${auth.userId}/insights`;
    const points: DailyPoint[] = [];
    for (const group of IG_BREAKDOWNS) {
        // A metric that cannot be split one way may still be split another — one dead set per breakdown.
        const dead = new Set<string>();
        for (const day of dailyWindow(today,)) {
            const resp = await fetchInsights(auth.base, path, group.metrics, { ...day.params, breakdown: group.breakdown, }, auth.token, dead, warnings, `Instagram ${group.breakdown} split`,);
            points.push(...breakdownPoints(resp, day.date,),);
        }
    }
    return points;
}

async function newFollowers(auth: InstagramAuth, today: string, warnings: WarningBag,): Promise<DailyPoint[]> {
    const series = await fetchInsights(auth.base, `${auth.userId}/insights`, ['follower_count',], {
        period: 'day', since: String(unixDay(addDays(today, -DAILY_WINDOW,),),), until: String(unixDay(today,),),
    }, auth.token, new Set(), warnings, 'Instagram follower_count',);
    return timeSeriesPoints(series, { follower_count: 'newFollowers', },);
}

async function audience(auth: InstagramAuth, today: string, warnings: WarningBag,): Promise<DailyPoint[]> {
    const path = `${auth.userId}/insights`;
    const points: DailyPoint[] = [];
    let anyOk = false;
    let lastError: unknown = null;
    for (const metric of Object.keys(AUDIENCE_METRICS,)) {
        for (const breakdown of AUDIENCE_BREAKDOWNS) {
            const params: Record<string, string> = { period: 'lifetime', metric_type: 'total_value', breakdown, metric, };
            // Engaged / reached audiences are per timeframe; followers are as of now.
            if (metric !== 'follower_demographics') params.timeframe = 'this_month';
            try {
                const resp = await graphGet<InsightResponse>(auth.base, path, params, auth.token,);
                points.push(...demographicPoints(resp, today,),);
                anyOk = true;
            } catch (e) {
                if (isTokenError(e,)) classify(e,);
                lastError = e;
            }
        }
    }
    if (!anyOk && lastError) {
        if (isPermissionError(lastError,)) throw new Refused((lastError as Error).message,);
        warnings.add(`Instagram demographics: ${(lastError as Error).message}`,);
    }
    return points;
}

async function onlineFollowers(auth: InstagramAuth, today: string,): Promise<DailyPoint[]> {
    const resp = await graphGet<InsightResponse>(auth.base, `${auth.userId}/insights`, {
        metric: 'online_followers', period: 'lifetime',
        since: String(unixDay(addDays(today, -DAILY_WINDOW - 1,),),), until: String(unixDay(today,),),
    }, auth.token,);
    return onlineFollowerPoints(resp,);
}

/** Insights for one media item; `dead` is per product type. */
async function itemInsights(auth: InstagramAuth, item: IgMedia, dead: Record<MediaKind, Set<string>>, warnings: WarningBag,): Promise<PostMetric> {
    const kind = mediaKind(item,);
    const resp = await fetchInsights(auth.base, `${item.id}/insights`, MEDIA_METRICS[kind], {}, auth.token, dead[kind], warnings, `Instagram ${kind.toLowerCase()} insights`,);
    let extra: Record<string, unknown> = {};
    if (kind === 'STORY') {
        try {
            const nav = await graphGet<InsightResponse>(auth.base, `${item.id}/insights`, { metric: 'navigation', breakdown: 'story_navigation_action_type', }, auth.token,);
            const n = navigationBreakdown(nav,);
            if (n) extra = { navigation: n, };
        } catch {
            // Navigation is optional (fewer than 5 viewers, older Graph versions).
        }
    }
    return mapInstagramMedia(item.id, item, insightNumbers(resp,), extra,);
}

/** Media insights for every item; the first permission refusal stops asking (counters stay). */
async function mediaMetrics(auth: InstagramAuth, items: IgMedia[], warnings: WarningBag,): Promise<{ ok: boolean; posts: PostMetric[]; }> {
    const dead: Record<MediaKind, Set<string>> = { FEED: new Set(), REELS: new Set(), STORY: new Set(), };
    let refused = false;
    const posts = await mapLimit(items, CONCURRENCY, async (item,): Promise<PostMetric> => {
        if (refused) return mapInstagramMedia(item.id, item, new Map(),);
        try {
            return await itemInsights(auth, item, dead, warnings,);
        } catch (e) {
            if (isTokenError(e,)) classify(e,);
            if (isPermissionError(e,)) refused = true;
            else warnings.add(`Instagram media insights failed — ${(e as Error).message}`,);
            return mapInstagramMedia(item.id, item, new Map(),);
        }
    },);
    return { ok: !refused, posts, };
}

async function benchmarks(auth: InstagramAuth, today: string, warnings: WarningBag,): Promise<{ ok: boolean; points: DailyPoint[]; }> {
    const { getSettings, } = await import('../settings.js');
    const usernames = await getSettings().then((s,) => s.benchmarks.instagram,).catch(() => [] as string[],);
    if (!usernames.length) return { ok: false, points: [], };
    if (auth.instagramLogin) {
        warnings.add('Benchmarks need a Facebook-Login Instagram connection (business_discovery is not available with Instagram Login).',);
        return { ok: false, points: [], };
    }
    const points: DailyPoint[] = [];
    let ok = false;
    for (const u of usernames) {
        try {
            const r = await graphGet<{ business_discovery?: DiscoveredAccount; }>(auth.base, auth.userId, {
                fields: `business_discovery.username(${u}){username,followers_count,media_count,media.limit(12){like_count,comments_count,timestamp}}`,
            }, auth.token,);
            if (r.business_discovery) {
                points.push(...benchmarkPoints(u, r.business_discovery, today,),);
                ok = true;
            }
        } catch (e) {
            if (isTokenError(e,)) classify(e,);
            warnings.add(`Instagram benchmark @${u}: ${(e as Error).message}`,);
        }
    }
    return { ok, points, };
}

async function saveCapabilities(caps: IgCapabilities, accountType: unknown,): Promise<void> {
    await query(
        `UPDATE social_connections SET credentials = COALESCE(credentials, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE provider = 'instagram'`,
        [JSON.stringify({ analyticsCapabilities: caps, ...(typeof accountType === 'string' ? { accountType, } : {}), },),],
    ).catch((e,) => logger.warn('instagram: could not save capabilities', { error: (e as Error).message, },),);
}

async function collect(ctx: CollectContext,): Promise<CollectResult> {
    const auth = resolveInstagramAuth(ctx.credentials,);
    if (!auth) throw new Error('Instagram is not connected (no access token or account id).',);
    const warnings = new WarningBag();
    const result: CollectResult = { daily: [], posts: [], };

    const snap = await attempt(() => accountSnapshot(auth,), null, warnings, 'Instagram account',);
    if (snap.value) result.account = snap.value;
    const accountType = snap.value?.raw?.account_type;
    if (accountType === 'PERSONAL') ctx.warn(PERSONAL_ACCOUNT,);

    // 2. Every media item (+ the due posts the list no longer reaches, weekly).
    const listed = await attempt(() => listMedia(auth,), [] as IgMedia[], warnings, 'Instagram media list',);
    const items = [...listed.value,];
    if (items.length) await upsertInstagramMedia(items,).catch((e,) => warnings.add(`Instagram posts: ${(e as Error).message}`,),);
    const known = new Set(items.map((i,) => i.id),);
    const older = ctx.posts.filter((p: KnownPost,) => !known.has(p.externalId,));
    if (older.length) {
        const extra = await mapLimit(older, CONCURRENCY, async (p,) => graphGet<IgMedia>(auth.base, p.externalId, {
            fields: 'id,media_type,media_product_type,like_count,comments_count,timestamp',
        }, auth.token,).catch(() => null),);
        for (const m of extra) if (m) items.push(m,);
    }

    // 3. Media insights.
    const media = await mediaMetrics(auth, items, warnings,);
    result.posts = media.posts;

    // 4–5. Account insights, splits, new followers, audience — each on its own.
    const totals = await attempt(() => accountTotals(auth, ctx.today, warnings,), [] as DailyPoint[], warnings, 'Instagram daily',);
    const splits = await attempt(() => accountBreakdowns(auth, ctx.today, warnings,), [] as DailyPoint[], warnings, 'Instagram splits',);
    const gains = await attempt(() => newFollowers(auth, ctx.today, warnings,), [] as DailyPoint[], warnings, 'Instagram new followers',);
    const demo = await attempt(() => audience(auth, ctx.today, warnings,), [] as DailyPoint[], warnings, 'Instagram demographics',);
    const online = await attempt(() => onlineFollowers(auth, ctx.today,), [] as DailyPoint[], warnings, 'Instagram online followers',);
    const stories = await attempt(() => collectStoriesWith(auth, warnings,), 0, warnings, 'Instagram stories',);
    const peers = await benchmarks(auth, ctx.today, warnings,);
    result.daily = [...totals.value, ...splits.value, ...gains.value, ...demo.value, ...online.value, ...peers.points,];

    const caps: IgCapabilities = {
        accountInsights: totals.ok && totals.value.length > 0,
        breakdowns: splits.ok && splits.value.length > 0,
        newFollowers: gains.ok,
        demographics: demo.ok && demo.value.length > 0,
        onlineFollowers: online.ok && online.value.length > 0,
        mediaInsights: media.ok && items.length > 0,
        stories: stories.ok,
        benchmarks: peers.ok,
        checkedAt: new Date().toISOString(),
    };
    await saveCapabilities(caps, accountType,);
    const missing = capabilityNotes(caps,);
    if (missing.length) ctx.warn(`Instagram did not provide: ${missing.join('; ',)} — switch to a Business account and reconnect (demographics also need 100+ followers).`,);
    if (!media.ok && !totals.ok) ctx.warn(INSIGHTS_DENIED,);
    warnings.flush(ctx.warn,);
    return result;
}

// ─── Stories ────────────────────────────────────────────────────────────────

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

/** List live stories, store them as hidden posts with their metrics + the daily story totals. Returns how many. */
async function collectStoriesWith(auth: InstagramAuth, warnings: WarningBag,): Promise<number> {
    const stories = await listStories(auth,);
    if (!stories.length) return 0;
    await upsertInstagramMedia(stories,);
    const dead: Record<MediaKind, Set<string>> = { FEED: new Set(), REELS: new Set(), STORY: new Set(), };
    const metrics: PostMetric[] = [];
    const points: DailyPoint[] = [];
    for (const s of stories) {
        try {
            const m = await itemInsights(auth, s, dead, warnings,);
            metrics.push(m,);
            if (s.timestamp) {
                const ins = new Map<string, number>();
                for (const k of Object.keys(STORY_METRICS,)) {
                    const v = k === 'views' ? m.views : k === 'reach' ? m.reach : k === 'replies' ? m.comments : k === 'shares' ? m.shares : (m.raw?.totalInteractions as number | null);
                    if (typeof v === 'number') ins.set(k, v,);
                }
                points.push(...storyPoints(s.id, s.timestamp, ins,),);
            }
        } catch (e) {
            if (isTokenError(e,) || isPermissionError(e,)) throw e;
            // "(#10) Not enough viewers" (< 5) → nothing to store yet.
        }
    }
    const { storeResult, utcDay, } = await import('../runner.js');
    const today = utcDay();
    await storeResult('instagram', today, { daily: points, posts: metrics, }, [],);
    const dates = [...new Set(points.map((p,) => p.date),),];
    if (dates.length) await storeResult('instagram', today, { daily: await storyTotals(dates,), }, [],);
    return stories.length;
}

/** Cron: capture live stories before they expire (24 h). */
export async function collectStories(): Promise<void> {
    const { loadConnection, } = await import('../runner.js');
    const conn = await loadConnection('instagram',);
    if (!conn?.is_connected || !conn.is_enabled) return;
    const auth = resolveInstagramAuth(conn.credentials ?? {},);
    if (!auth) return;
    const warnings = new WarningBag();
    try {
        await collectStoriesWith(auth, warnings,);
    } catch (e) {
        logger.warn('social-analytics: Instagram stories sweep failed', { error: (e as Error).message, },);
    }
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
        description: 'Captures live Instagram Stories (views, reach, replies, shares, navigation) before the 24-hour expiry.',
        handler: collectStories,
    },],
},);
