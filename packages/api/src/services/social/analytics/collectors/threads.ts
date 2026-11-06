/**
 * Threads analytics collector (plan §3.4) — Threads Graph API v1.0 with the
 * Threads connection's long-lived token (threads_basic + threads_manage_insights).
 *
 *  1. Account: followers (`followers_count` user insight).
 *  2. Daily: `views` as a time series (last 7 days, one call) and
 *     likes / replies / reposts / quotes / clicks per day (total-value
 *     metrics — one call per day for the last 3 days; Meta revises recent days).
 *  3. Posts: the account's own recent threads (GET /me/threads, last 90 days)
 *     are upserted into social_posts (hidden — analytics only, see
 *     social/threads.ts), then each gets lifetime insights: views, likes,
 *     replies → comments, reposts + quotes → shares (raw keeps every metric).
 *
 * The token lasts 60 days; the `threads-token-refresh` cron renews it weekly.
 */
import type { SocialCollectorStatus, } from '@sitesurge/types';
import { query, } from '../../../../db';
import { logger, } from '../../../../utils/logger';
import { refreshLongLived, THREADS_API, } from '../../../oauth/threads';
import { upsertThreadsPosts, } from '../../threads';
import { GRAPH_TIMEOUT_MS, redactSecrets, } from './metaGraph';
import { registerCollector, } from '../registry';
import type { CollectContext, CollectResult, DailyPoint, PostMetric, } from '../types';
import {
    addDays,
    dayStartUnix,
    dayTotals,
    insightValue,
    isOwnThread,
    mediaMetric,
    parseThreadsTime,
    THREADS_INSIGHTS_EPOCH,
    type ThreadsInsight,
    type ThreadsMedia,
    viewsSeries,
} from './threadsMapping';

const VIEWS_WINDOW = 7;
const TOTALS_WINDOW = 3;
const LIST_DAYS = 90;
const LIST_PAGE = 50;
const LIST_MAX = 300;
const MEDIA_FIELDS = 'id,media_type,media_product_type,text,permalink,timestamp,thumbnail_url,media_url,username,is_quote_post';
const DAY_METRICS = 'likes,replies,reposts,quotes,clicks';
const MEDIA_METRICS = 'views,likes,replies,reposts,quotes,shares';

const LIST_MAX_PAGES = 10;

type ThreadsError = Error & { status?: number; code?: number; };

/** GET a Threads URL (it carries the token): 30 s timeout, and no error text ever repeats the token. */
async function getJson(url: string,): Promise<any> {
    const token = new URL(url,).searchParams.get('access_token',);
    let res: Response;
    try {
        res = await fetch(url, { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS,), },);
    } catch (e) {
        const timedOut = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
        const err = new Error(`Threads request failed: ${timedOut ? `no answer within ${GRAPH_TIMEOUT_MS / 1000} s` : redactSecrets((e as Error)?.message || 'network error', token,)}`,) as ThreadsError;
        err.status = 0;
        throw err;
    }
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
        const e = data?.error ?? {};
        const err = new Error(redactSecrets(e.message || data?.error_message || `HTTP ${res.status}`, token,),) as ThreadsError;
        err.status = res.status;
        err.code = e.code;
        throw err;
    }
    return data;
}

/** The token is expired / revoked — every further call would fail the same way. */
export function isThreadsTokenError(e: unknown,): boolean {
    const err = e as ThreadsError;
    return err?.code === 190 || err?.code === 102 || err?.status === 401;
}

const RECONNECT = 'the Threads token is invalid or expired; reconnect in Social → Configuration → Threads.';

function api(path: string, token: string, params: Record<string, string | number> = {},): string {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params,).map(([k, v,]) => [k, String(v,),]),), access_token: token, },);
    return `${THREADS_API}${path}?${q}`;
}

/** Permission errors (code 10 / 200 / 190) need the operator, not a retry. */
function guidance(e: unknown,): string {
    const err = e as ThreadsError;
    if (isThreadsTokenError(err,)) return `${err.message} — ${RECONNECT}`;
    if (err.code === 10 || err.code === 200) return `${err.message} — reconnect Threads and allow insights (threads_manage_insights).`;
    return err.message;
}

function tokenExpired(credentials: Record<string, unknown>,): boolean {
    const at = Date.parse(String(credentials.tokenExpiresAt ?? '',),);
    return Number.isFinite(at,) && at < Date.now();
}

async function listThreads(userId: string, token: string, today: string,): Promise<ThreadsMedia[]> {
    const cutoff = Date.parse(`${addDays(today, -LIST_DAYS,)}T00:00:00Z`,);
    const out: ThreadsMedia[] = [];
    let url: string | null = api(`/${userId}/threads`, token, { fields: MEDIA_FIELDS, limit: LIST_PAGE, },);
    // Bounded by pages too: a page of items without timestamps never trips `older`.
    for (let n = 0; url && out.length < LIST_MAX && n < LIST_MAX_PAGES; n++) {
        const page: { data?: ThreadsMedia[]; paging?: { next?: string; }; } = await getJson(url,);
        const items = page.data ?? [];
        let older = false;
        for (const m of items) {
            const t = Date.parse(parseThreadsTime(m.timestamp,) ?? '',);
            if (Number.isFinite(t,) && t < cutoff) {
                older = true;
                continue;
            }
            out.push(m,);
        }
        url = older || !items.length ? null : page.paging?.next ?? null;
    }
    return out;
}

async function daily(userId: string, token: string, ctx: CollectContext,): Promise<DailyPoint[]> {
    const points: DailyPoint[] = [];
    const until = dayStartUnix(ctx.today,);
    try {
        const v = await getJson(api(`/${userId}/threads_insights`, token, {
            metric: 'views',
            since: Math.max(dayStartUnix(addDays(ctx.today, -VIEWS_WINDOW,),), THREADS_INSIGHTS_EPOCH,),
            until,
        },),);
        for (const i of (v.data ?? []) as ThreadsInsight[]) if (i.name === 'views') points.push(...viewsSeries(i,),);
    } catch (e) {
        ctx.warn(`Threads daily views: ${guidance(e,)}`,);
    }
    for (let d = TOTALS_WINDOW; d >= 1; d--) {
        const day = addDays(ctx.today, -d,);
        try {
            const r = await getJson(api(`/${userId}/threads_insights`, token, {
                metric: DAY_METRICS,
                since: Math.max(dayStartUnix(day,), THREADS_INSIGHTS_EPOCH,),
                until: dayStartUnix(addDays(day, 1,),),
            },),);
            points.push(...dayTotals(day, (r.data ?? []) as ThreadsInsight[],),);
        } catch (e) {
            ctx.warn(`Threads daily totals (${day}): ${guidance(e,)}`,);
        }
    }
    return points;
}

async function mediaInsights(id: string, token: string,): Promise<PostMetric> {
    try {
        const r = await getJson(api(`/${id}/insights`, token, { metric: MEDIA_METRICS, },),);
        return mediaMetric(id, (r.data ?? []) as ThreadsInsight[],);
    } catch (e) {
        // `shares` is marked "in development" — retry without it before giving up.
        if ((e as ThreadsError).status !== 400 || isThreadsTokenError(e,)) throw e;
        const r = await getJson(api(`/${id}/insights`, token, { metric: MEDIA_METRICS.replace(',shares', '',), },),);
        return mediaMetric(id, (r.data ?? []) as ThreadsInsight[],);
    }
}

function status(credentials: Record<string, unknown>, connected: boolean,): SocialCollectorStatus {
    const base = { platform: 'threads' as const, label: 'Threads', };
    if (!connected || !credentials.accessToken) {
        return {
            ...base,
            state: 'off',
            message: 'Connect Threads in Social → Configuration (Threads app ID + secret, then Authorize).',
            collects: [],
        };
    }
    if (tokenExpired(credentials,)) {
        return { ...base, state: 'off', message: 'The Threads token expired — reconnect in Social → Configuration → Threads.', collects: [], };
    }
    if (!credentials.threadsUserId) {
        return { ...base, state: 'off', message: 'Threads authorization did not finish — click Reconnect in Social → Configuration → Threads.', collects: [], };
    }
    const collects = [
        'Followers',
        'Daily views, likes, replies, reposts, quotes, link clicks',
        'Per-thread views, likes, replies, reposts + quotes',
    ];
    if (credentials.oauthError) {
        return { ...base, state: 'partial', message: `Threads token refresh failed: ${String(credentials.oauthError,)}. Reconnect before it expires.`, collects, };
    }
    return { ...base, state: 'ready', message: null, collects, };
}

async function collect(ctx: CollectContext,): Promise<CollectResult> {
    const token = String(ctx.credentials.accessToken ?? '',);
    const userId = String(ctx.credentials.threadsUserId ?? '',);
    if (!token || !userId) throw new Error('Threads is not connected.',);
    const result: CollectResult = { daily: [], posts: [], };

    // 1. Followers (no since/until — the current total).
    try {
        const f = await getJson(api(`/${userId}/threads_insights`, token, { metric: 'followers_count', },),);
        const i = ((f.data ?? []) as ThreadsInsight[]).find((x,) => x.name === 'followers_count');
        result.account = { followers: i ? insightValue(i,) : null, raw: { followers_count: i ? insightValue(i,) : null, }, };
    } catch (e) {
        // An expired / revoked token fails every call — stop here with the fix, not 300 warnings.
        if (isThreadsTokenError(e,)) throw new Error(`Threads: ${guidance(e,)}`,);
        ctx.warn(`Threads followers: ${guidance(e,)}`,);
    }

    // 2. Daily account series.
    result.daily = await daily(userId, token, ctx,);

    // 3. Recent threads → social_posts, then per-thread insights.
    const ids = new Set<string>();
    try {
        const threads = await listThreads(userId, token, ctx.today,);
        await upsertThreadsPosts(threads,);
        for (const m of threads) if (isOwnThread(m,)) ids.add(m.id,);
    } catch (e) {
        ctx.warn(`Threads post list: ${guidance(e,)}`,);
    }
    for (const p of ctx.posts) ids.add(p.externalId,);

    let failures = 0;
    for (const id of ids) {
        try {
            result.posts!.push(await mediaInsights(id, token,),);
        } catch (e) {
            if (isThreadsTokenError(e,)) throw new Error(`Threads: ${guidance(e,)}`,);
            failures++;
            if (failures <= 3) ctx.warn(`Threads insights for ${id}: ${guidance(e,)}`,);
        }
    }
    if (failures > 3) ctx.warn(`Threads insights failed for ${failures} threads in total.`,);
    return result;
}

/** Renew the 60-day token (needs ≥ 24 h age; weekly keeps it well inside the window). */
async function refreshThreadsToken(): Promise<void> {
    const r = await query<{ credentials: Record<string, unknown> | null; }>(
        `SELECT credentials FROM social_connections WHERE provider::text = 'threads' AND is_connected = true`,
    ).catch(() => ({ rows: [] as Array<{ credentials: Record<string, unknown> | null; }>, }));
    const token = r.rows[0]?.credentials?.accessToken;
    if (!token) return;
    try {
        const data = await refreshLongLived(String(token,),);
        const tokenExpiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000,).toISOString() : null;
        await query(
            `UPDATE social_connections
                SET credentials = (credentials - 'oauthError') || $1::jsonb, updated_at = NOW()
              WHERE provider::text = 'threads'`,
            [JSON.stringify({ accessToken: data.access_token, tokenExpiresAt, },),],
        );
        logger.info('Threads token refreshed', { expiresIn: data.expires_in, },);
    } catch (e) {
        const message = redactSecrets((e as Error).message, String(token,),);
        logger.warn('Threads token refresh failed', { error: message, },);
        await query(
            `UPDATE social_connections SET credentials = credentials || $1::jsonb, updated_at = NOW() WHERE provider::text = 'threads'`,
            [JSON.stringify({ oauthError: message, },),],
        ).catch(() => {});
    }
}

registerCollector({
    platform: 'threads',
    label: 'Threads',
    connection: 'threads',
    status,
    collect,
    crons: [{
        name: 'threads-token-refresh',
        schedule: '0 4 */7 * *',
        description: 'Refreshes the Threads long-lived access token (expires every 60 days).',
        handler: refreshThreadsToken,
    },],
},);
