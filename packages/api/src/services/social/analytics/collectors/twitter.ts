/**
 * X (Twitter) analytics collector — plan §3.6. OPT-IN and SPEND-CAPPED:
 * every X API read costs credits (pay-per-use since 2026-02-06), so it only
 * runs when the operator turns it on in Social → Configuration → X.
 *
 * Enabled when ALL hold:
 *  - connection settings `analytics: { enabled: true, monthlyCapUsd? }`,
 *  - `twitterMode: 'api'` (the paid read mode — free mode is paste-by-URL),
 *  - user-context OAuth 1.0a credentials (apiKey/apiSecret/accessToken/accessSecret).
 *
 * Reads:
 *  - `GET /2/users/me` (public_metrics) → the account snapshot.
 *  - `GET /2/tweets?ids=` (≤100 per call) for the due posts. Posts < 30 days
 *    old also ask for non_public_metrics + organic_metrics (X only serves
 *    those for recent posts, user context only); older posts public_metrics.
 *    Media metrics (video views, playback quartiles) come with the expansion.
 *
 * Spend: estimated from `X_READ_COST_USD` and kept month-to-date in
 * `settings.analyticsSpend = { month: 'YYYY-MM', spentUsd }` — a key of its
 * own (not inside `analytics`) because the admin save MERGES settings one
 * level deep, so saving the toggle would otherwise reset the counter.
 */
import type { SocialCollectorStatus, } from '@sitesurge/types';
import { query, } from '../../../../db';
import { buildAuthHeader, type TwitterUserCreds, } from '../../twitterOAuth';
import { registerCollector, } from '../registry';
import type { AccountSnapshot, CollectContext, CollectResult, PostMetric, } from '../types';

const API = 'https://api.twitter.com/2';
const BATCH = 100;
/** X serves non-public / organic metrics only for posts this young. */
const PRIVATE_METRICS_DAYS = 30;
/** Cap used when the operator enabled collection without setting one. */
export const DEFAULT_MONTHLY_CAP_USD = 10;

/**
 * Estimated cost per read (USD). ASSUMPTION: X's STANDARD pay-per-use rates
 * (post read $0.005, user read $0.010). Reading your own account with an app
 * owned by that account bills as an "owned read" ($0.001), so the real bill
 * is usually lower — the counter overestimates, which keeps the cap safe.
 * Same-day re-reads are billed once by X; we count every read we make.
 */
export const X_READ_COST_USD = {
    post: 0.005,
    user: 0.010,
} as const;

export interface TwitterAnalyticsSettings {
    enabled: boolean;
    monthlyCapUsd: number;
}

export interface SpendState {
    month: string;
    spentUsd: number;
}

export function analyticsSettings(settings: Record<string, unknown>,): TwitterAnalyticsSettings {
    const a = (settings.analytics ?? {}) as Record<string, unknown>;
    const cap = Number(a.monthlyCapUsd,);
    return {
        enabled: a.enabled === true,
        monthlyCapUsd: a.monthlyCapUsd !== undefined && a.monthlyCapUsd !== null && a.monthlyCapUsd !== '' && Number.isFinite(cap,) && cap >= 0
            ? cap
            : DEFAULT_MONTHLY_CAP_USD,
    };
}

/** Month-to-date spend; a new month starts at 0. */
export function currentSpend(settings: Record<string, unknown>, today: string,): SpendState {
    const month = today.slice(0, 7,);
    const s = (settings.analyticsSpend ?? {}) as Record<string, unknown>;
    const spent = Number(s.spentUsd,);
    return { month, spentUsd: s.month === month && Number.isFinite(spent,) && spent > 0 ? spent : 0, };
}

/** Round to a tenth of a cent so float drift never trips the cap. */
const money = (v: number,): number => Math.round(v * 10000,) / 10000;

/**
 * How many post reads fit under the cap after the account read.
 * Returns `account: false` when not even the account read fits.
 */
export function planReads(spentUsd: number, capUsd: number, wantedPosts: number,): { account: boolean; posts: number; } {
    const left = money(capUsd - spentUsd,);
    if (left < X_READ_COST_USD.user) return { account: false, posts: 0, };
    const forPosts = money(left - X_READ_COST_USD.user,);
    return { account: true, posts: Math.min(wantedPosts, Math.floor(money(forPosts / X_READ_COST_USD.post,),),), };
}

export function readCost(userReads: number, postReads: number,): number {
    return money(userReads * X_READ_COST_USD.user + postReads * X_READ_COST_USD.post,);
}

export function userCreds(credentials: Record<string, unknown>,): TwitterUserCreds | null {
    const c = credentials as Record<string, string | undefined>;
    if (!c.apiKey || !c.apiSecret || !c.accessToken || !c.accessSecret) return null;
    return { apiKey: c.apiKey, apiSecret: c.apiSecret, accessToken: c.accessToken, accessSecret: c.accessSecret, };
}

/** Same wording family as publish.ts's friendlyXError, for reads. */
export function friendlyXReadError(status: number, body: string,): string {
    if (status === 402 || /credits[- ]depleted|payment required/i.test(body,)) {
        return 'X declined the read (402 — out of API credits). Analytics reads consume credits on your X API plan; add credits in Usage & billing at developer.x.com, or turn off "Collect analytics" in Social → Configuration → X.';
    }
    if (status === 401) return 'X rejected the credentials (401). Re-check the API Key/Secret + Access Token/Secret in Social → Configuration → X.';
    if (status === 403) return 'X refused the read (403). The app needs a paid X API plan with read access, and the Access Token must belong to the account being measured.';
    if (status === 429) return 'X rate limit reached (429). The remaining posts are collected on the next run.';
    return `X API ${status}: ${body.slice(0, 200,)}`;
}

class XReadError extends Error {
    constructor(public status: number, message: string,) {
        super(message,);
    }
}

async function signedGet(path: string, params: Record<string, string>, creds: TwitterUserCreds,): Promise<any> {
    const url = `${API}${path}`;
    const qs = new URLSearchParams(params,).toString();
    const res = await fetch(qs ? `${url}?${qs}` : url, {
        headers: { Authorization: buildAuthHeader('GET', url, params, creds,), },
    },);
    const body = await res.text();
    if (!res.ok) throw new XReadError(res.status, friendlyXReadError(res.status, body,),);
    try {
        return JSON.parse(body,);
    } catch {
        return {};
    }
}

const n = (v: unknown,): number | null => (typeof v === 'number' && Number.isFinite(v,) ? v : null);
const sum = (...vals: Array<number | null>): number | null => {
    const known = vals.filter((v,): v is number => v !== null);
    return known.length ? known.reduce((a, b,) => a + b, 0,) : null;
};

export function accountFrom(user: Record<string, any> | undefined,): AccountSnapshot | null {
    const m = user?.public_metrics;
    if (!m) return null;
    return {
        followers: n(m.followers_count,),
        following: n(m.following_count,),
        postsCount: n(m.tweet_count,),
        raw: { ...m, id: user?.id, username: user?.username, },
    };
}

/** One tweet (+ its media from `includes.media`) → our post metric. */
export function tweetMetric(tweet: Record<string, any>, mediaByKey: Map<string, Record<string, any>> = new Map(),): PostMetric {
    const pub = tweet.public_metrics ?? {};
    const priv = tweet.non_public_metrics ?? {};
    const org = tweet.organic_metrics ?? {};
    const media = ((tweet.attachments?.media_keys ?? []) as string[])
        .map((k,) => mediaByKey.get(k,))
        .filter((m,): m is Record<string, any> => Boolean(m,));
    const views = n(pub.impression_count,) ?? n(priv.impression_count,) ?? n(org.impression_count,);
    const linkClicks = n(priv.url_link_clicks,) ?? n(org.url_link_clicks,);
    const profileClicks = n(priv.user_profile_clicks,) ?? n(org.user_profile_clicks,);
    return {
        externalId: String(tweet.id,),
        views,
        impressions: views,
        likes: n(pub.like_count,),
        comments: n(pub.reply_count,),
        shares: sum(n(pub.retweet_count,), n(pub.quote_count,),),
        saves: n(pub.bookmark_count,),
        clicks: sum(linkClicks, profileClicks,),
        raw: {
            public_metrics: pub,
            ...(tweet.non_public_metrics ? { non_public_metrics: priv, } : {}),
            ...(tweet.organic_metrics ? { organic_metrics: org, } : {}),
            ...(media.length
                ? {
                    media: media.map((m,) => ({
                        media_key: m.media_key,
                        type: m.type,
                        public_metrics: m.public_metrics,
                        non_public_metrics: m.non_public_metrics,
                        organic_metrics: m.organic_metrics,
                    })),
                }
                : {}),
        },
    };
}

function isRecent(publishedAt: string | null, today: string,): boolean {
    if (!publishedAt) return false;
    const age = Date.parse(`${today}T00:00:00Z`,) - Date.parse(publishedAt,);
    return Number.isFinite(age,) && age < PRIVATE_METRICS_DAYS * 86400_000;
}

function chunk<T,>(list: T[], size: number,): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size,),);
    return out;
}

async function loadSettings(): Promise<Record<string, unknown>> {
    const r = await query<{ settings: Record<string, unknown> | null; }>(
        `SELECT settings FROM social_connections WHERE provider::text = 'twitter'`,
    ).catch(() => ({ rows: [] as Array<{ settings: Record<string, unknown> | null; }>, }));
    return r.rows[0]?.settings ?? {};
}

async function saveSpend(spend: SpendState,): Promise<void> {
    await query(
        `UPDATE social_connections
            SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{analyticsSpend}', $1::jsonb, true)
          WHERE provider::text = 'twitter'`,
        [JSON.stringify({ month: spend.month, spentUsd: money(spend.spentUsd,), },),],
    );
}

const COLLECTS = [
    'Followers, following, post count (account snapshot)',
    'Per-post impressions, likes, replies, reposts + quotes, bookmarks',
    'Link + profile clicks and video playback quartiles (posts < 30 days old)',
];

async function status(credentials: Record<string, unknown>, connected: boolean,): Promise<SocialCollectorStatus> {
    const base = { platform: 'twitter' as const, label: 'X', };
    const settings = await loadSettings();
    const a = analyticsSettings(settings,);
    if (!a.enabled) {
        return {
            ...base,
            state: 'off',
            message: 'X analytics reads are paid (API credits). To collect them, switch X to API mode and turn on "Collect analytics (paid)" in Social → Configuration → X.',
            collects: [],
        };
    }
    if (!connected || settings.twitterMode !== 'api' || !userCreds(credentials,)) {
        return {
            ...base,
            state: 'off',
            message: 'X analytics needs API mode and the API Key/Secret + Access Token/Secret of the measured account (paid X API plan) in Social → Configuration → X.',
            collects: [],
        };
    }
    const spend = currentSpend(settings, new Date().toISOString().slice(0, 10,),);
    if (planReads(spend.spentUsd, a.monthlyCapUsd, 0,).account === false) {
        return {
            ...base,
            state: 'partial',
            message: `Monthly cap reached (≈$${spend.spentUsd.toFixed(2,)} of $${a.monthlyCapUsd.toFixed(2,)}). Collection resumes next month or when the cap is raised.`,
            collects: COLLECTS,
        };
    }
    return { ...base, state: 'ready', message: null, collects: COLLECTS, };
}

async function collect(ctx: CollectContext,): Promise<CollectResult> {
    const creds = userCreds(ctx.credentials,);
    if (!creds) throw new Error('X user-context credentials are missing (API Key/Secret + Access Token/Secret).',);
    const a = analyticsSettings(ctx.settings,);
    if (!a.enabled) throw new Error('X analytics collection is turned off.',);

    // Re-read: the counter may have moved since the runner loaded settings.
    const spend = currentSpend(await loadSettings(), ctx.today,);
    const plan = planReads(spend.spentUsd, a.monthlyCapUsd, ctx.posts.length,);
    const result: CollectResult = { posts: [], };
    if (!plan.account) {
        ctx.warn(`X analytics skipped: the monthly cap of $${a.monthlyCapUsd.toFixed(2,)} is reached (≈$${spend.spentUsd.toFixed(2,)} spent).`,);
        return result;
    }
    if (plan.posts < ctx.posts.length) {
        ctx.warn(`X monthly cap: collecting ${plan.posts} of ${ctx.posts.length} due posts (≈$${spend.spentUsd.toFixed(2,)} of $${a.monthlyCapUsd.toFixed(2,)} spent).`,);
    }

    let userReads = 0;
    let postReads = 0;
    try {
        // 1. Account.
        userReads++;
        const me = await signedGet('/users/me', { 'user.fields': 'public_metrics', }, creds,);
        result.account = accountFrom(me.data,);
        if (!result.account) ctx.warn('X returned no account metrics for /users/me.',);

        // 2. Posts — newest first (the due list is ordered), split by age.
        const due = ctx.posts.slice(0, plan.posts,);
        const recent = due.filter((p,) => isRecent(p.publishedAt, ctx.today,)).map((p,) => p.externalId);
        const older = due.filter((p,) => !isRecent(p.publishedAt, ctx.today,)).map((p,) => p.externalId);
        const groups: Array<{ ids: string[]; fields: string; }> = [
            { ids: recent, fields: 'public_metrics,non_public_metrics,organic_metrics', },
            { ids: older, fields: 'public_metrics', },
        ];
        for (const g of groups) {
            for (const batch of chunk(g.ids, BATCH,)) {
                postReads += batch.length;
                let res: any;
                try {
                    res = await signedGet('/tweets', {
                        ids: batch.join(',',),
                        'tweet.fields': `${g.fields},attachments`,
                        expansions: 'attachments.media_keys',
                        'media.fields': g.fields,
                    }, creds,);
                } catch (e) {
                    // Rate limit: keep what we have; the rest are due again tomorrow.
                    if (e instanceof XReadError && e.status === 429) {
                        ctx.warn(e.message,);
                        return result;
                    }
                    throw e;
                }
                const media = new Map<string, Record<string, any>>(
                    ((res.includes?.media ?? []) as Array<Record<string, any>>).map((m,) => [String(m.media_key,), m,]),
                );
                for (const t of (res.data ?? []) as Array<Record<string, any>>) result.posts!.push(tweetMetric(t, media,),);
                const errs = (res.errors ?? []) as Array<{ detail?: string; }>;
                if (errs.length) ctx.warn(`X could not read ${errs.length} post(s): ${errs[0]?.detail ?? 'unknown error'}`,);
            }
        }
        return result;
    } finally {
        // Count every read we attempted, success or not.
        await saveSpend({ month: spend.month, spentUsd: spend.spentUsd + readCost(userReads, postReads,), },)
            .catch((e,) => ctx.warn(`Could not record X analytics spend: ${(e as Error).message}`,));
    }
}

registerCollector({ platform: 'twitter', label: 'X', connection: 'twitter', status, collect, },);
