/**
 * X (Twitter) analytics — pure helpers: settings, the spend model, payload →
 * metric mapping for both tiers, post kinds and status wording. No I/O, so
 * every rule here is unit-tested (twitter.test.ts, twitterMapping.test.ts).
 *
 * Verified against docs.x.com (2026-11-06):
 *  - Pricing (https://docs.x.com/x-api/getting-started/pricing): Posts $0.005,
 *    Users $0.010, Owned Reads $0.001 ("your own data, e.g. your posts" — only
 *    when the `{id}` in the request is the authenticated user AND that user
 *    owns the developer app). Each resource is billed once per 24-hour UTC day.
 *  - Metrics (https://docs.x.com/x-api/fundamentals/metrics): post
 *    public_metrics (retweet/reply/like/quote/bookmark/impression_count),
 *    non_public_metrics (impression_count, url_link_clicks,
 *    user_profile_clicks, engagements), organic_metrics; video media
 *    public_metrics.view_count + non_public_metrics.playback_{0,25,50,75,100}_count.
 *    Non-public / organic only for posts created in the last 30 days, user
 *    context only.
 *  - Timeline (https://docs.x.com/x-api/users/get-posts): max_results 5–100,
 *    since_id / until_id / start_time / end_time / pagination_token,
 *    exclude=replies,retweets, meta.newest_id / next_token.
 * Free tier: `cdn.syndication.twimg.com/tweet-result` (unofficial, the source
 * react-tweet uses) — checked live: favorite_count, conversation_count,
 * video.viewCount (often 0), video.durationMs; NO repost/quote count and NO
 * follower count on the user object.
 */
import type { AccountSnapshot, PostMetric, } from '../types';

/** X serves non-public / organic metrics only for posts this young. */
export const PRIVATE_METRICS_DAYS = 30;
/** Older posts are re-read once a week (Mondays) on both tiers. */
export const DAILY_DAYS = 30;
/** Cap used when the operator enabled collection without setting one. */
export const DEFAULT_MONTHLY_CAP_USD = 10;

/**
 * Cost per resource (USD), docs.x.com pricing. `owned` applies to the own
 * timeline only when the measured account owns the developer app (the
 * operator says so with `analytics.ownedApp`); otherwise the standard post
 * rate is used. `/users/me` and `/tweets?ids=` are always estimated at the
 * standard rates (the page does not say they bill as owned) — the counter
 * over-estimates rather than under, which keeps the cap safe. Same-day
 * re-reads are billed once by X; we count every read we make.
 */
export const X_READ_COST_USD = {
    post: 0.005,
    user: 0.010,
    owned: 0.001,
} as const;

export interface TwitterAnalyticsSettings {
    enabled: boolean;
    monthlyCapUsd: number;
    /** The measured account owns the X developer app → own-timeline reads bill as owned reads. */
    ownedApp: boolean;
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
        ownedApp: a.ownedApp === true,
    };
}

/** Month-to-date spend; a new month starts at 0. */
export function currentSpend(settings: Record<string, unknown>, today: string,): SpendState {
    const month = today.slice(0, 7,);
    const s = (settings.analyticsSpend ?? {}) as Record<string, unknown>;
    const spent = Number(s.spentUsd,);
    return { month, spentUsd: s.month === month && Number.isFinite(spent,) && spent > 0 ? spent : 0, };
}

/** Round to a hundredth of a cent so float drift never trips the cap. */
export const money = (v: number,): number => Math.round(v * 10000,) / 10000;

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

export function readCost(userReads: number, postReads: number, ownedReads = 0,): number {
    return money(userReads * X_READ_COST_USD.user + postReads * X_READ_COST_USD.post + ownedReads * X_READ_COST_USD.owned,);
}

/**
 * The run's money, spent as reads happen. `afford(n, rate)` says how many of
 * n reads at that rate still fit; `charge` records reads actually made.
 */
export class Budget {
    spentUsd: number;
    constructor(public readonly capUsd: number, startUsd: number,) {
        this.spentUsd = startUsd;
    }
    get leftUsd(): number {
        return money(this.capUsd - this.spentUsd,);
    }
    afford(n: number, rate: number,): number {
        if (n <= 0 || rate <= 0) return Math.max(n, 0,);
        return Math.max(0, Math.min(n, Math.floor(money(this.leftUsd / rate,),),),);
    }
    charge(n: number, rate: number,): void {
        if (n > 0) this.spentUsd = money(this.spentUsd + n * rate,);
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
        // user public_metrics.like_count = likes the account GAVE, not received — kept in raw only.
        raw: { ...m, id: user?.id, username: user?.username, },
    };
}

/** Share of video starts that reached the end (playback_100 ÷ playback_0), 0–1. */
export function completionRate(npm: Record<string, unknown> | undefined,): number | null {
    const start = n(npm?.playback_0_count,);
    const end = n(npm?.playback_100_count,);
    if (start === null || end === null || start <= 0) return null;
    return Math.min(1, end / start,);
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
    const video = media.find((m,) => m.type === 'video' || m.type === 'animated_gif');
    const durationS = n(video?.duration_ms,) === null ? null : (video!.duration_ms as number) / 1000;
    return {
        externalId: String(tweet.id,),
        views,
        impressions: views,
        likes: n(pub.like_count,),
        comments: n(pub.reply_count,),
        shares: sum(n(pub.retweet_count,), n(pub.quote_count,),),
        saves: n(pub.bookmark_count,),
        clicks: sum(linkClicks, profileClicks,),
        completionRate: completionRate(video?.non_public_metrics,),
        raw: {
            tier: 'paid',
            public_metrics: pub,
            ...(tweet.non_public_metrics ? { non_public_metrics: priv, } : {}),
            ...(tweet.organic_metrics ? { organic_metrics: org, } : {}),
            ...(linkClicks !== null ? { linkClicks, } : {}),
            ...(profileClicks !== null ? { profileClicks, } : {}),
            ...(n(priv.engagements,) !== null ? { engagements: priv.engagements, } : {}),
            ...(n(video?.public_metrics?.view_count,) !== null ? { videoViews: video!.public_metrics.view_count, } : {}),
            ...(durationS !== null ? { durationS, } : {}),
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

/**
 * Free tier: a syndication `tweet-result` payload → our post metric. Only
 * what the payload really carries — likes, replies and (when X fills it) the
 * video view count; reposts, quotes and impressions stay null.
 */
export function syndicationMetric(json: Record<string, any>,): PostMetric | null {
    const id = String(json?.id_str ?? json?.id ?? '',);
    if (!id) return null;
    const videoViews = n(json.video?.viewCount,);
    const durationMs = n(json.video?.durationMs,);
    return {
        externalId: id,
        // viewCount is 0 on most payloads (X does not fill it) — 0 is "unknown", not "no views".
        views: videoViews && videoViews > 0 ? videoViews : null,
        likes: n(json.favorite_count,),
        comments: n(json.conversation_count,),
        raw: {
            tier: 'free',
            favorite_count: json.favorite_count,
            conversation_count: json.conversation_count,
            ...(videoViews !== null ? { videoViews, } : {}),
            ...(durationMs !== null ? { durationS: durationMs / 1000, } : {}),
        },
    };
}

/** Our `social_posts.media_kind` for a tweet (VARCHAR(16)). */
export function tweetKind(tweet: Record<string, any>, mediaByKey: Map<string, Record<string, any>> = new Map(),): string {
    const refs = (tweet.referenced_tweets ?? []) as Array<{ type?: string; }>;
    if (refs.some((r,) => r.type === 'replied_to')) return 'reply';
    if (refs.some((r,) => r.type === 'quoted')) return 'quote';
    const types = ((tweet.attachments?.media_keys ?? []) as string[]).map((k,) => mediaByKey.get(k,)?.type);
    if (types.includes('video',) || types.includes('animated_gif',)) return 'video';
    if (types.includes('photo',)) return 'photo';
    return 'post';
}

/** First usable picture of a tweet's media (photo url or video preview). */
export function tweetThumbnail(tweet: Record<string, any>, mediaByKey: Map<string, Record<string, any>>,): string | null {
    for (const k of (tweet.attachments?.media_keys ?? []) as string[]) {
        const m = mediaByKey.get(k,);
        const url = m?.url || m?.preview_image_url;
        if (typeof url === 'string' && url) return url;
    }
    return null;
}

/** Is the post young enough for daily reads (and private metrics on the paid tier)? */
export function isRecent(publishedAt: string | null, today: string, days = DAILY_DAYS,): boolean {
    if (!publishedAt) return false;
    const age = Date.parse(`${today}T00:00:00Z`,) - Date.parse(publishedAt,);
    return Number.isFinite(age,) && age >= -86400_000 && age < days * 86400_000;
}

export function isMonday(today: string,): boolean {
    return new Date(`${today}T00:00:00Z`,).getUTCDay() === 1;
}

/**
 * The due posts worth reading today: posts younger than DAILY_DAYS every
 * day, older ones only on Mondays (the runner already sends > 90-day posts
 * weekly; this also thins 30–90 days to weekly, which saves credits and keeps
 * the free endpoint quiet).
 */
export function dueToday<T extends { publishedAt: string | null; },>(posts: T[], today: string,): T[] {
    const monday = isMonday(today,);
    return posts.filter((p,) => monday || isRecent(p.publishedAt, today,));
}

export function chunk<T,>(list: T[], size: number,): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size,),);
    return out;
}

/** What each tier gave on the last run, saved as `credentials.analyticsCapabilities`. */
export interface XCapabilities {
    /** Free syndication re-reads of pasted posts worked. */
    freeHydration?: boolean;
    /** Paid user-context reads worked at all (`/users/me`). */
    paidReads?: boolean;
    /** Followers / following / post count snapshot. */
    accountInsights?: boolean;
    /** Own timeline listing (every own post tracked). */
    discovery?: boolean;
    /** Impressions, link/profile clicks, engagements, video quartiles. */
    mediaInsights?: boolean;
    checkedAt?: string;
}

/** Plain words for every paid family that did NOT work (empty = all good / never tried). */
export function capabilityNotes(caps: XCapabilities | null,): string[] {
    if (!caps || caps.paidReads === undefined) return [];
    const out: string[] = [];
    if (caps.paidReads === false) return ['paid API reads (check the plan, credits and the four OAuth credentials)',];
    if (caps.accountInsights === false) out.push('the follower snapshot',);
    if (caps.discovery === false) out.push('your post timeline (automatic tracking of every post)',);
    if (caps.mediaInsights === false) out.push('private metrics (impressions, link/profile clicks, video quartiles)',);
    return out;
}

export const FREE_UPGRADE = 'Paid X API reads add: impressions, link/profile clicks, video quartiles, all your posts automatically, '
    + 'daily followers — turn on in Social → Configuration → X (Feed mode API + "Collect analytics (paid)" + API credits).';

export const FREE_COLLECTS = [
    'Pasted posts: likes and replies, re-read daily for 30 days then weekly (free, no X API)',
    'Video view count when X publishes it',
];

export const PAID_COLLECTS = [
    'Followers, following, post count (daily snapshot)',
    'Every own post from your timeline (posts, replies, quotes, videos) — tracked automatically',
    'Per-post impressions, likes, replies, reposts + quotes, bookmarks',
    'Link + profile clicks, engagements, video playback quartiles + completion (posts < 30 days old)',
    'Pasted posts by other accounts: impressions, reposts (public metrics)',
];
