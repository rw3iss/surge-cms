/**
 * X (Twitter) analytics collector — two tiers, each family on its own.
 *
 * FREE (no X API, always on while we hold X posts):
 *  - Pasted posts are re-read from the public syndication endpoint
 *    (`cdn.syndication.twimg.com/tweet-result`, twitterPosts.freeReads): likes,
 *    replies, video views when X fills them. Daily for 30 days, then weekly
 *    (Mondays); one request at a time, spaced, ≤ 300 per run. No follower
 *    count — the payload's user object has none.
 *
 * PAID (opt-in + spend-capped; every X API read costs credits):
 *  enabled when `settings.analytics.enabled`, `twitterMode: 'api'` and the
 *  four OAuth 1.0a user-context credentials are set.
 *  1. `GET /2/users/me` → followers / following / post count (daily snapshot).
 *  2. Own timeline `GET /2/users/:id/tweets` for the last 29 days, retweets
 *     excluded, with public + non_public + organic metrics and media metrics
 *     (video quartiles) — upserted into social_posts so EVERY own post is
 *     tracked, and measured in the same call. Once, a 90-day backfill
 *     (public metrics) discovers the older posts.
 *  3. Due posts the timeline did not cover (pasted posts by other accounts,
 *     own posts older than 29 days — weekly) → `GET /2/tweets?ids=`
 *     public_metrics, ≤ 100 per call.
 *  Whatever the cap or a refusal leaves unread falls back to the free re-read.
 *
 * Spend is estimated per read (twitterMapping.X_READ_COST_USD) and kept
 * month-to-date in `settings.analyticsSpend = { month, spentUsd }` — a key of
 * its own because the admin save MERGES settings one level deep. What worked
 * is saved as `credentials.analyticsCapabilities` (read by status()).
 */
import type { SocialCollectorStatus, } from '@sitesurge/types';
import { query, } from '../../../../db';
import { logger, } from '../../../../utils/logger';
import type { TwitterUserCreds, } from '../../twitterOAuth';
import { registerCollector, } from '../registry';
import type { CollectContext, CollectResult, KnownPost, PostMetric, } from '../types';
import {
    accountFrom,
    analyticsSettings,
    Budget,
    capabilityNotes,
    chunk,
    currentSpend,
    dueToday,
    FREE_COLLECTS,
    FREE_UPGRADE,
    money,
    PAID_COLLECTS,
    planReads,
    PRIVATE_METRICS_DAYS,
    type SpendState,
    syndicationMetric,
    tweetMetric,
    type XCapabilities,
    X_READ_COST_USD,
} from './twitterMapping';
import {
    type Author,
    countXPosts,
    freeReads,
    signedGet,
    timelinePage,
    tweetsByIds,
    upsertTimelinePosts,
    XReadError,
} from './twitterPosts';

export {
    accountFrom, analyticsSettings, completionRate, currentSpend, DEFAULT_MONTHLY_CAP_USD, planReads, readCost, syndicationMetric,
    tweetKind, tweetMetric, X_READ_COST_USD,
} from './twitterMapping';
export { friendlyXReadError, } from './twitterPosts';

/** Timeline window that still carries private metrics (a day of margin under X's 30). */
const TIMELINE_DAYS = PRIVATE_METRICS_DAYS - 1;
const BACKFILL_DAYS = 90;
const MAX_TIMELINE_PAGES = 10;
const BATCH = 100;

export function userCreds(credentials: Record<string, unknown>,): TwitterUserCreds | null {
    const c = credentials as Record<string, string | undefined>;
    if (!c.apiKey || !c.apiSecret || !c.accessToken || !c.accessSecret) return null;
    return { apiKey: c.apiKey, apiSecret: c.apiSecret, accessToken: c.accessToken, accessSecret: c.accessSecret, };
}

interface XConnection {
    exists: boolean;
    /** is_connected AND is_enabled. */
    connected: boolean;
    settings: Record<string, unknown>;
    autoPublish: boolean;
}

async function loadConnection(): Promise<XConnection> {
    type Row = { settings: Record<string, unknown> | null; auto_publish: boolean | null; is_connected: boolean | null; is_enabled: boolean | null; };
    const r = await query<Row>(
        `SELECT settings, auto_publish, is_connected, is_enabled FROM social_connections WHERE provider::text = 'twitter'`,
    ).catch(() => ({ rows: [] as Row[], }));
    const row = r.rows[0];
    return {
        exists: Boolean(row,),
        connected: Boolean(row?.is_connected && row?.is_enabled,),
        settings: row?.settings ?? {},
        autoPublish: row?.auto_publish === true,
    };
}

async function saveSpend(spend: SpendState,): Promise<void> {
    await query(
        `UPDATE social_connections
            SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{analyticsSpend}', $1::jsonb, true)
          WHERE provider::text = 'twitter'`,
        [JSON.stringify({ month: spend.month, spentUsd: money(spend.spentUsd,), },),],
    );
}

async function saveTimelineState(state: Record<string, unknown>,): Promise<void> {
    await query(
        `UPDATE social_connections
            SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{analyticsTimeline}', $1::jsonb, true)
          WHERE provider::text = 'twitter'`,
        [JSON.stringify(state,),],
    ).catch((e,) => logger.warn('x analytics: could not save timeline state', { error: (e as Error).message, },),);
}

async function saveCapabilities(caps: XCapabilities,): Promise<void> {
    await query(
        `UPDATE social_connections SET credentials = COALESCE(credentials, '{}'::jsonb) || $1::jsonb WHERE provider::text = 'twitter'`,
        [JSON.stringify({ analyticsCapabilities: caps, },),],
    ).catch((e,) => logger.warn('x analytics: could not save capabilities', { error: (e as Error).message, },),);
}

/** Why the paid tier is not active (null = it is). */
export function paidBlocker(settings: Record<string, unknown>, credentials: Record<string, unknown>, connected: boolean,): string | null {
    if (!analyticsSettings(settings,).enabled) return 'off';
    if (!connected) return 'The X connection is not enabled — enable it in Social → Configuration → X.';
    if (settings.twitterMode !== 'api') return 'Paid X analytics needs Feed mode API in Social → Configuration → X.';
    if (!userCreds(credentials,)) return 'Paid X analytics needs the API Key/Secret + Access Token/Secret of the measured account in Social → Configuration → X.';
    return null;
}

async function status(credentials: Record<string, unknown>, connected: boolean,): Promise<SocialCollectorStatus> {
    const base = { platform: 'twitter' as const, label: 'X', };
    const conn = await loadConnection();
    const posts = await countXPosts();
    const blocker = paidBlocker(conn.settings, credentials, connected,);
    if (blocker !== null) {
        if (!conn.exists && posts === 0) {
            return { ...base, state: 'off', message: `Paste X post URLs on Social → Posts to track their likes and replies for free. ${FREE_UPGRADE}`, collects: [], };
        }
        const why = blocker === 'off' ? '' : `${blocker} `;
        return {
            ...base,
            state: 'partial',
            message: posts === 0
                ? `${why}Paste X post URLs on Social → Posts to track them for free. ${FREE_UPGRADE}`
                : `${why}${FREE_UPGRADE}`,
            collects: FREE_COLLECTS,
        };
    }
    const a = analyticsSettings(conn.settings,);
    const spend = currentSpend(conn.settings, new Date().toISOString().slice(0, 10,),);
    if (!planReads(spend.spentUsd, a.monthlyCapUsd, 0,).account) {
        return {
            ...base,
            state: 'partial',
            message: `Monthly cap reached (≈$${spend.spentUsd.toFixed(2,)} of $${a.monthlyCapUsd.toFixed(2,)}). Paid reads resume next month or when the cap is raised; pasted posts keep the free re-read.`,
            collects: FREE_COLLECTS,
        };
    }
    const caps = (credentials.analyticsCapabilities && typeof credentials.analyticsCapabilities === 'object')
        ? credentials.analyticsCapabilities as XCapabilities
        : null;
    const missing = capabilityNotes(caps,);
    if (missing.length) {
        return {
            ...base,
            state: 'partial',
            message: `X did not give: ${missing.join('; ',)}. Check the X API plan has credits and read access, and that the Access Token belongs to the measured account.`,
            collects: [...PAID_COLLECTS, ...FREE_COLLECTS.slice(0, 1,),],
        };
    }
    return { ...base, state: 'ready', message: null, collects: PAID_COLLECTS, };
}

/** Is this error one that means "paid reads do not work at all" (stop asking)? */
const fatalPaid = (e: unknown,): boolean => e instanceof XReadError && [401, 402, 403,].includes(e.status,);

/** Free re-read of the given posts → metrics (+ warnings). */
async function freeTier(posts: KnownPost[], ctx: CollectContext,): Promise<{ ok: boolean; metrics: PostMetric[]; }> {
    if (!posts.length) return { ok: true, metrics: [], };
    const r = await freeReads(posts.map((p,) => p.externalId),);
    const metrics = r.payloads.map(syndicationMetric,).filter((m,): m is PostMetric => m !== null);
    if (r.failed) ctx.warn(`X free re-read: ${r.failed} of ${r.attempted} post(s) could not be read (deleted, protected or the endpoint refused).`,);
    if (r.stopped && r.attempted < posts.length) ctx.warn(`X free re-read stopped after ${r.attempted} of ${posts.length} posts; the rest are read on the next run.`,);
    return { ok: metrics.length > 0 || r.failed === 0, metrics, };
}

interface PaidOutcome {
    metrics: Map<string, PostMetric>;
    /** Due posts left for the free re-read. */
    leftover: KnownPost[];
    caps: XCapabilities;
    account: CollectResult['account'];
}

async function paidTier(ctx: CollectContext, creds: TwitterUserCreds, posts: KnownPost[], conn: XConnection,): Promise<PaidOutcome> {
    const a = analyticsSettings(conn.settings,);
    const spend = currentSpend(conn.settings, ctx.today,);
    const budget = new Budget(a.monthlyCapUsd, spend.spentUsd,);
    const timelineRate = a.ownedApp ? X_READ_COST_USD.owned : X_READ_COST_USD.post;
    const metrics = new Map<string, PostMetric>();
    const caps: XCapabilities = { checkedAt: new Date().toISOString(), };
    const out: PaidOutcome = { metrics, leftover: posts, caps, account: null, };

    if (budget.afford(1, X_READ_COST_USD.user,) < 1) {
        ctx.warn(`X paid reads skipped: the monthly cap of $${a.monthlyCapUsd.toFixed(2,)} is reached (≈$${spend.spentUsd.toFixed(2,)} spent). Pasted posts use the free re-read.`,);
        return out;
    }
    try {
        // 1. Account.
        let me: Record<string, any> | undefined;
        try {
            budget.charge(1, X_READ_COST_USD.user,);
            me = (await signedGet('/users/me', { 'user.fields': 'public_metrics,profile_image_url,username,name', }, creds,)).data;
            caps.paidReads = true;
        } catch (e) {
            caps.paidReads = false;
            ctx.warn((e as Error).message,);
            return out;
        }
        out.account = accountFrom(me,);
        caps.accountInsights = Boolean(out.account,);
        if (!out.account) ctx.warn('X returned no account metrics for /users/me.',);
        const userId = me?.id ? String(me.id,) : '';
        const author: Author = { username: me?.username, name: me?.name, avatar: me?.profile_image_url, };

        // 2. Own timeline (discovery + measurement in one read).
        if (userId) {
            const state = (conn.settings.analyticsTimeline ?? {}) as Record<string, unknown>;
            const now = Date.now();
            const recentStart = new Date(now - TIMELINE_DAYS * 86400_000,).toISOString();
            const windows: Array<{ startTime: string; endTime?: string; privateMetrics: boolean; }> = [
                { startTime: recentStart, privateMetrics: true, },
            ];
            if (!state.backfilledAt) {
                windows.push({ startTime: new Date(now - BACKFILL_DAYS * 86400_000,).toISOString(), endTime: recentStart, privateMetrics: false, },);
            }
            let discovered = 0;
            let newest: string | null = null;
            let complete = true;
            let privateOk: boolean | undefined;
            for (const w of windows) {
                let token: string | undefined;
                let privateMetrics = w.privateMetrics;
                for (let page = 0; page < MAX_TIMELINE_PAGES; page++) {
                    const room = budget.afford(BATCH, timelineRate,);
                    if (room < 5) {
                        complete = false;
                        ctx.warn(`X monthly cap: the timeline was cut short (≈$${budget.spentUsd.toFixed(2,)} of $${a.monthlyCapUsd.toFixed(2,)}).`,);
                        break;
                    }
                    let res;
                    try {
                        res = await timelinePage(creds, userId, { ...w, privateMetrics, maxResults: room, paginationToken: token, },);
                    } catch (e) {
                        // Private metrics refused (plan / token) → retry this page with public metrics only.
                        if (privateMetrics && e instanceof XReadError && e.status === 403) {
                            privateMetrics = false;
                            privateOk = false;
                            page--;
                            continue;
                        }
                        throw e;
                    }
                    budget.charge(Math.max(res.tweets.length, 1,), timelineRate,);
                    if (w.privateMetrics && privateMetrics && res.tweets.length) privateOk = privateOk ?? true;
                    newest = newest ?? res.newestId;
                    discovered += await upsertTimelinePosts(res.tweets, res.media, author, conn.autoPublish,)
                        .catch((e,) => {
                            ctx.warn(`X posts: ${(e as Error).message}`,);
                            return 0;
                        },);
                    for (const t of res.tweets) metrics.set(String(t.id,), tweetMetric(t, res.media,),);
                    if (res.errors.length) ctx.warn(`X timeline: ${res.errors.length} item(s) not readable — ${res.errors[0]?.detail ?? 'unknown error'}`,);
                    token = res.nextToken ?? undefined;
                    if (!token) break;
                }
                if (!complete) break;
            }
            caps.discovery = true;
            if (privateOk !== undefined) caps.mediaInsights = privateOk;
            // Informational, not a warning: a warning marks the run "partial".
            if (discovered) logger.info(`social-analytics: X — ${discovered} new post(s) found on the timeline and tracked.`,);
            await saveTimelineState({
                newestId: newest ?? state.newestId ?? null,
                backfilledAt: state.backfilledAt ?? (complete ? new Date().toISOString() : null),
                lastRunAt: new Date().toISOString(),
            },);
        }

        // 3. Due posts the timeline did not cover → public metrics by id.
        const rest = posts.filter((p,) => !metrics.has(p.externalId,));
        const affordable = budget.afford(rest.length, X_READ_COST_USD.post,);
        if (affordable < rest.length) {
            ctx.warn(`X monthly cap: ${rest.length - affordable} post(s) use the free re-read instead (≈$${budget.spentUsd.toFixed(2,)} of $${a.monthlyCapUsd.toFixed(2,)} spent).`,);
        }
        const paidIds = rest.slice(0, affordable,).map((p,) => p.externalId);
        for (const batch of chunk(paidIds, BATCH,)) {
            budget.charge(batch.length, X_READ_COST_USD.post,);
            const res = await tweetsByIds(creds, batch,);
            for (const t of res.tweets) metrics.set(String(t.id,), tweetMetric(t, res.media,),);
            if (res.errors.length) ctx.warn(`X could not read ${res.errors.length} post(s): ${res.errors[0]?.detail ?? 'unknown error'}`,);
        }
    } catch (e) {
        if (e instanceof XReadError && e.status === 429) ctx.warn(e.message,);
        else if (fatalPaid(e,)) {
            ctx.warn((e as Error).message,);
            if (caps.discovery === undefined) caps.discovery = false;
        } else ctx.warn(`X paid reads: ${(e as Error).message}`,);
    } finally {
        // Count every read we attempted, success or not.
        await saveSpend({ month: spend.month, spentUsd: budget.spentUsd, },)
            .catch((e,) => ctx.warn(`Could not record X analytics spend: ${(e as Error).message}`,));
    }
    out.leftover = posts.filter((p,) => !metrics.has(p.externalId,));
    return out;
}

async function collect(ctx: CollectContext,): Promise<CollectResult> {
    const conn = await loadConnection();
    const settings = { ...ctx.settings, ...conn.settings, };
    const posts = dueToday(ctx.posts, ctx.today,);
    const result: CollectResult = { posts: [], };
    const creds = userCreds(ctx.credentials,);
    const paid = creds !== null && paidBlocker(settings, ctx.credentials, conn.connected,) === null;

    let leftover = posts;
    let caps: XCapabilities = { checkedAt: new Date().toISOString(), };
    if (paid) {
        const p = await paidTier(ctx, creds!, posts, { ...conn, settings, },);
        result.account = p.account;
        result.posts!.push(...p.metrics.values(),);
        leftover = p.leftover;
        caps = p.caps;
    }

    // Free tier for whatever the paid tier did not read (all due posts when unpaid).
    const free = await freeTier(leftover, ctx,);
    result.posts!.push(...free.metrics,);
    if (leftover.length) caps.freeHydration = free.ok;
    else if (!paid) caps.freeHydration = true;

    await saveCapabilities(caps,);
    return result;
}

registerCollector({ platform: 'twitter', label: 'X', connection: 'twitter', status, collect, },);
