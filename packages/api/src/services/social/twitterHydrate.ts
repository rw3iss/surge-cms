/**
 * X/Twitter hydration helpers for the capture-first feed.
 *
 * We never scrape profile timelines. Instead, given a KNOWN tweet id (from a
 * pasted URL or a POSSE publish), we hydrate its content server-side via the
 * public `cdn.syndication.twimg.com/tweet-result` JSON endpoint — the same
 * source `react-tweet` uses — into our `FetchedPost` shape. That renders as a
 * native `SocialEmbed` card (no X JavaScript). The oEmbed fallback lives in
 * `embed.ts`.
 */
import { logger, } from '../../utils/logger';
import type { FetchedPost, } from './types';

const TWEET_RESULT_BASE = 'https://cdn.syndication.twimg.com/tweet-result';

// Matches https://x.com/<handle>/status/<id> and twitter.com variants, with or
// without scheme/www/query. Captures the handle and the numeric status id.
const TWEET_URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/([^/?#]+)\/status\/(\d+)/i;

/**
 * Derive the `token` query param the syndication endpoint requires. This is
 * the exact algorithm `react-tweet` uses: a base-36 encoding of the id scaled
 * by π, with zeros and the decimal point stripped.
 */
export function deriveTweetToken(id: string,): string {
    return ((Number(id,) / 1e15) * Math.PI)
        .toString(6 ** 2) // base 36
        .replace(/(0+|\.)/g, '',);
}

/**
 * Parse a tweet URL into `{ id, handle, url }` (url normalized to the x.com
 * permalink). Returns null for anything that isn't a status URL.
 */
export function parseTweetUrl(url: string,): { id: string; handle: string; url: string; } | null {
    const m = TWEET_URL_RE.exec(url,);
    if (!m) return null;
    const handle = m[1];
    const id = m[2];
    return { id, handle, url: `https://x.com/${handle}/status/${id}`, };
}

/**
 * Map a `tweet-result` JSON payload into our `FetchedPost` shape. Defensive
 * about optional fields — the endpoint's schema shifts over time.
 */
export function mapTweetResultToFetchedPost(json: Record<string, any>,): FetchedPost {
    const id = String(json.id_str ?? json.id ?? '',);
    const user = (json.user ?? {}) as Record<string, any>;
    const media = Array.isArray(json.mediaDetails,) ? json.mediaDetails : [];
    const firstMedia = media.find((m: any,) => m?.media_url_https,);
    const handle = user.screen_name as string | undefined;

    return {
        id,
        content: (json.text ?? json.full_text ?? undefined) as string | undefined,
        // Permalink so a card can link back to the tweet.
        mediaUrl: handle && id ? `https://x.com/${handle}/status/${id}` : undefined,
        thumbnailUrl: firstMedia?.media_url_https as string | undefined,
        authorName: (user.name ?? handle) as string | undefined,
        authorAvatar: user.profile_image_url_https as string | undefined,
        likes: typeof json.favorite_count === 'number' ? json.favorite_count : undefined,
        comments: typeof json.conversation_count === 'number' ? json.conversation_count : undefined,
        shares: undefined, // syndication payload has no retweet count
        publishedAt: json.created_at ? new Date(json.created_at as string,) : new Date(0,),
        rawData: json,
    };
}

/**
 * Fetch + hydrate a single tweet by id. Returns null on any failure (network,
 * non-OK, protected/deleted tweet) — callers degrade gracefully rather than
 * throwing into the request path.
 */
export async function fetchTweetById(id: string,): Promise<FetchedPost | null> {
    try {
        const token = deriveTweetToken(id,);
        const url = `${TWEET_RESULT_BASE}?id=${encodeURIComponent(id,)}&token=${encodeURIComponent(token,)}&lang=en`;
        const res = await fetch(url,);
        if (!res.ok) {
            logger.warn('tweet-result fetch failed', { id, status: res.status, },);
            return null;
        }
        const json = await res.json() as Record<string, any>;
        if (!json || (!json.id_str && !json.id && !json.text)) return null;
        return mapTweetResultToFetchedPost(json,);
    } catch (error) {
        logger.warn('tweet-result fetch error', { id, error, },);
        return null;
    }
}
