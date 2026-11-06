/**
 * X (Twitter) analytics I/O: the signed X API reads (paid tier), the own
 * timeline discovery that keeps social_posts in step with every own post, and
 * the free syndication re-read of pasted posts.
 *
 * Discovery rules (same spirit as instagramMedia.ts):
 *  - New posts are inserted with source 'sync'. Replies are inserted HIDDEN
 *    (they are not feed content); other posts are hidden unless the X
 *    connection's "Sync posts automatically" is on — so turning analytics on
 *    never changes a curated public feed.
 *  - An existing row (pasted / composed / synced) keeps its provenance,
 *    curation and raw_data (the pasted card renders from it); only counters,
 *    kind, thumbnail and a missing publish date are filled in.
 *  - Thumbnails come from pbs.twimg.com (stable) — no mirroring needed.
 */
import { query, } from '../../../../db';
import { logger, } from '../../../../utils/logger';
import { buildAuthHeader, type TwitterUserCreds, } from '../../twitterOAuth';
import { deriveTweetToken, } from '../../twitterHydrate';
import { tweetKind, tweetThumbnail, } from './twitterMapping';

const API = 'https://api.twitter.com/2';
const SYNDICATION = 'https://cdn.syndication.twimg.com/tweet-result';

/** Free endpoint: one request at a time, spaced, at most this many per run. */
export const FREE_MAX_PER_RUN = 300;
const FREE_SPACING_MS = 400;
/** Stop the free pass after this many failures in a row (blocked / rate limited). */
const FREE_MAX_FAILURES = 5;
/** Per-request timeouts: a hung X / syndication socket must not stall the whole run. */
export const X_API_TIMEOUT_MS = 30_000;
const FREE_TIMEOUT_MS = 15_000;

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

export class XReadError extends Error {
    constructor(public status: number, message: string,) {
        super(message,);
    }
}

export async function signedGet(path: string, params: Record<string, string>, creds: TwitterUserCreds,): Promise<any> {
    const url = `${API}${path}`;
    const qs = new URLSearchParams(params,).toString();
    const res = await fetch(qs ? `${url}?${qs}` : url, {
        headers: { Authorization: buildAuthHeader('GET', url, params, creds,), },
        signal: AbortSignal.timeout(X_API_TIMEOUT_MS,),
    },).catch((e: unknown,) => {
        // Network / timeout: a plain message (never the request URL or headers).
        const timedOut = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
        throw new XReadError(0, timedOut ? `X API did not answer within ${X_API_TIMEOUT_MS / 1000} s.` : `X API unreachable: ${(e as Error)?.message ?? 'network error'}`,);
    },);
    const body = await res.text();
    if (!res.ok) throw new XReadError(res.status, friendlyXReadError(res.status, body,),);
    try {
        return JSON.parse(body,);
    } catch {
        return {};
    }
}

export const PRIVATE_FIELDS = 'public_metrics,non_public_metrics,organic_metrics';
export const MEDIA_FIELDS_BASE = 'type,url,preview_image_url,duration_ms';
export const TWEET_FIELDS_BASE = 'created_at,attachments,referenced_tweets,text';

export interface TimelinePage {
    tweets: Array<Record<string, any>>;
    media: Map<string, Record<string, any>>;
    nextToken: string | null;
    newestId: string | null;
    errors: Array<{ detail?: string; }>;
}

/** One page of the own timeline (newest first; retweets excluded, replies kept). */
export async function timelinePage(
    creds: TwitterUserCreds,
    userId: string,
    opts: { startTime: string; endTime?: string; maxResults: number; privateMetrics: boolean; paginationToken?: string; },
): Promise<TimelinePage> {
    const metrics = opts.privateMetrics ? PRIVATE_FIELDS : 'public_metrics';
    const params: Record<string, string> = {
        max_results: String(Math.max(5, Math.min(100, opts.maxResults,),),),
        start_time: opts.startTime,
        exclude: 'retweets',
        'tweet.fields': `${TWEET_FIELDS_BASE},${metrics}`,
        expansions: 'attachments.media_keys',
        'media.fields': `${MEDIA_FIELDS_BASE},${metrics}`,
    };
    if (opts.endTime) params.end_time = opts.endTime;
    if (opts.paginationToken) params.pagination_token = opts.paginationToken;
    const res = await signedGet(`/users/${encodeURIComponent(userId,)}/tweets`, params, creds,);
    return {
        tweets: (res.data ?? []) as Array<Record<string, any>>,
        media: mediaMap(res,),
        nextToken: res.meta?.next_token ?? null,
        newestId: res.meta?.newest_id ?? null,
        errors: (res.errors ?? []) as Array<{ detail?: string; }>,
    };
}

/** Public metrics for up to 100 posts by id (any author). */
export async function tweetsByIds(creds: TwitterUserCreds, ids: string[],): Promise<{ tweets: Array<Record<string, any>>; media: Map<string, Record<string, any>>; errors: Array<{ detail?: string; }>; }> {
    const res = await signedGet('/tweets', {
        ids: ids.join(',',),
        'tweet.fields': `${TWEET_FIELDS_BASE},public_metrics`,
        expansions: 'attachments.media_keys',
        'media.fields': `${MEDIA_FIELDS_BASE},public_metrics`,
    }, creds,);
    return { tweets: (res.data ?? []) as Array<Record<string, any>>, media: mediaMap(res,), errors: (res.errors ?? []) as Array<{ detail?: string; }>, };
}

function mediaMap(res: any,): Map<string, Record<string, any>> {
    return new Map(((res?.includes?.media ?? []) as Array<Record<string, any>>).map((m,) => [String(m.media_key,), m,]),);
}

export interface Author {
    username?: string;
    name?: string;
    avatar?: string;
}

/** Upsert own timeline posts into social_posts (rules in the file header). Returns how many were new. */
export async function upsertTimelinePosts(
    tweets: Array<Record<string, any>>,
    media: Map<string, Record<string, any>>,
    author: Author,
    feedVisible: boolean,
): Promise<number> {
    if (!tweets.length) return 0;
    const ids = tweets.map((t,) => String(t.id,));
    const existing = await query<{ external_id: string; }>(
        `SELECT external_id FROM social_posts WHERE platform = 'twitter' AND external_id = ANY($1::text[])`,
        [ids,],
    );
    const known = new Set(existing.rows.map((r,) => r.external_id),);
    let added = 0;
    for (const t of tweets) {
        const id = String(t.id,);
        const kind = tweetKind(t, media,);
        const pub = t.public_metrics ?? {};
        const url = author.username ? `https://x.com/${author.username}/status/${id}` : `https://x.com/i/status/${id}`;
        const hidden = kind === 'reply' || !feedVisible;
        const shares = (typeof pub.retweet_count === 'number' ? pub.retweet_count : 0) + (typeof pub.quote_count === 'number' ? pub.quote_count : 0);
        await query(
            `INSERT INTO social_posts (platform, external_id, content, media_url, thumbnail_url, author_name, author_avatar,
                    likes, comments, shares, published_at, fetched_at, raw_data, source, post_url, media_kind, is_hidden)
             VALUES ('twitter', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, 'sync', $3, $12, $13)
             ON CONFLICT (platform, external_id) DO UPDATE SET
               content = COALESCE(social_posts.content, EXCLUDED.content),
               thumbnail_url = COALESCE(social_posts.thumbnail_url, EXCLUDED.thumbnail_url),
               likes = COALESCE(EXCLUDED.likes, social_posts.likes),
               comments = COALESCE(EXCLUDED.comments, social_posts.comments),
               shares = COALESCE(EXCLUDED.shares, social_posts.shares),
               published_at = CASE WHEN social_posts.published_at IS NULL OR social_posts.published_at < '1971-01-01'
                                   THEN EXCLUDED.published_at ELSE social_posts.published_at END,
               media_kind = COALESCE(social_posts.media_kind, EXCLUDED.media_kind),
               fetched_at = NOW()`,
            [id, t.text ?? null, url, tweetThumbnail(t, media,), author.name ?? author.username ?? null, author.avatar ?? null,
                pub.like_count ?? null, pub.reply_count ?? null, shares, t.created_at ? new Date(t.created_at,) : null,
                JSON.stringify({ ...t, mediaKind: kind, },), kind, hidden,],
        );
        if (!known.has(id,)) added++;
    }
    return added;
}

/** Fresh counters from the free re-read onto the post row (and a missing publish date). */
async function refreshRow(json: Record<string, any>,): Promise<void> {
    const id = String(json.id_str ?? json.id ?? '',);
    if (!id) return;
    const created = json.created_at ? new Date(json.created_at,) : null;
    await query(
        `UPDATE social_posts SET
            likes = COALESCE($2, likes),
            comments = COALESCE($3, comments),
            published_at = CASE WHEN (published_at IS NULL OR published_at < '1971-01-01') AND $4::timestamptz IS NOT NULL
                                THEN $4::timestamptz ELSE published_at END
          WHERE platform = 'twitter' AND external_id = $1`,
        [id, typeof json.favorite_count === 'number' ? json.favorite_count : null,
            typeof json.conversation_count === 'number' ? json.conversation_count : null,
            created && Number.isFinite(created.getTime(),) ? created.toISOString() : null,],
    ).catch((e,) => logger.warn('x analytics: could not refresh post row', { id, error: (e as Error).message, },),);
}

export interface FreeReadResult {
    payloads: Array<Record<string, any>>;
    attempted: number;
    failed: number;
    /** True when the pass stopped early (blocked, rate limited, run cap). */
    stopped: boolean;
}

const sleep = (ms: number,) => new Promise((r,) => setTimeout(r, ms,));

/**
 * Re-read posts from the public syndication endpoint, one at a time with a
 * gap, at most FREE_MAX_PER_RUN; a 429 or FREE_MAX_FAILURES failures in a row
 * stop the pass (the rest are due again tomorrow). A deleted / protected post
 * answers 404 — counted, not retried.
 */
export async function freeReads(ids: string[], opts: { spacingMs?: number; } = {},): Promise<FreeReadResult> {
    const out: FreeReadResult = { payloads: [], attempted: 0, failed: 0, stopped: false, };
    const spacing = opts.spacingMs ?? FREE_SPACING_MS;
    let streak = 0;
    for (const id of ids.slice(0, FREE_MAX_PER_RUN,)) {
        if (out.attempted > 0 && spacing > 0) await sleep(spacing,);
        out.attempted++;
        try {
            const url = `${SYNDICATION}?id=${encodeURIComponent(id,)}&token=${encodeURIComponent(deriveTweetToken(id,),)}&lang=en`;
            const res = await fetch(url, { signal: AbortSignal.timeout(FREE_TIMEOUT_MS,), },);
            if (res.status === 429) {
                out.failed++;
                out.stopped = true;
                break;
            }
            const text = res.ok ? await res.text() : '';
            let json: Record<string, any> | null = null;
            try {
                json = text ? JSON.parse(text,) : null;
            } catch {
                json = null;
            }
            if (!json || (!json.id_str && !json.id)) {
                out.failed++;
                if (++streak >= FREE_MAX_FAILURES) {
                    out.stopped = true;
                    break;
                }
                continue;
            }
            streak = 0;
            out.payloads.push(json,);
            await refreshRow(json,);
        } catch {
            out.failed++;
            if (++streak >= FREE_MAX_FAILURES) {
                out.stopped = true;
                break;
            }
        }
    }
    if (ids.length > FREE_MAX_PER_RUN) out.stopped = true;
    return out;
}

/** How many X posts we hold (pasted, composed or synced). */
export async function countXPosts(): Promise<number> {
    const r = await query<{ n: string; }>(`SELECT COUNT(*)::text AS n FROM social_posts WHERE platform = 'twitter'`,)
        .catch(() => ({ rows: [{ n: '0', },], }));
    return Number(r.rows[0]?.n ?? 0,);
}
