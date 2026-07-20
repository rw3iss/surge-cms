/**
 * Compose & cross-post (POSSE). Publishes text to a provider's write API and
 * captures the created post back into `social_posts` (source='posse') so it
 * renders in the feed immediately.
 *
 * X/Twitter uses the FREE write tier (`POST /2/tweets`) with user-context
 * OAuth 1.0a. Other providers are stubbed until their publish flow lands.
 * Media upload is a follow-up (X v1.1 chunked upload).
 */
import type { SocialPlatform, } from '@sitesurge/types';
import { query, } from '../../db';
import { cache, } from '../cache';
import { logger, } from '../../utils/logger';
import { upsertSocialPost, } from '../social';
import { fetchTweetById, } from './twitterHydrate';
import { buildAuthHeader, type TwitterUserCreds, } from './twitterOAuth';
import { fetchMediaBytes, mediaCategory, uploadMedia, } from './twitterMedia';

export interface PublishInput {
    providers: SocialPlatform[];
    text: string;
    /** Media asset URLs (from the CMS media library) to attach. X-only today. */
    mediaUrls?: string[];
}

export interface PublishResult {
    provider: SocialPlatform;
    ok: boolean;
    id?: string;
    error?: string;
}

/** Load X user-context write credentials from the stored connection. */
async function getTwitterCreds(): Promise<TwitterUserCreds | null> {
    const res = await query(
        `SELECT credentials FROM social_connections WHERE provider = 'twitter'`,
    );
    const c = res.rows[0]?.credentials;
    if (!c?.apiKey || !c?.apiSecret || !c?.accessToken || !c?.accessSecret) return null;
    return {
        apiKey: c.apiKey,
        apiSecret: c.apiSecret,
        accessToken: c.accessToken,
        accessSecret: c.accessSecret,
    };
}

/**
 * Upload the requested media to X and return their media ids, enforcing X's
 * per-tweet rules: up to 4 photos, OR exactly 1 video, OR 1 GIF.
 */
async function uploadTweetMedia(mediaUrls: string[], creds: TwitterUserCreds,): Promise<string[]> {
    if (mediaUrls.length > 4) throw new Error('X allows at most 4 media per post.',);

    const assets = await Promise.all(mediaUrls.map((u,) => fetchMediaBytes(u,)),);
    const hasVideoOrGif = assets.some((a,) => mediaCategory(a.mime,) !== 'tweet_image',);
    if (hasVideoOrGif && assets.length > 1) {
        throw new Error('A video or GIF must be the only media on the post.',);
    }

    const ids: string[] = [];
    for (const a of assets) {
        ids.push(await uploadMedia(a.bytes, a.mime, creds,),);
    }
    return ids;
}

/** Turn an X API error into an operator-actionable message. */
function friendlyXError(status: number, body: string,): string {
    if (status === 402 || /credits[- ]depleted|payment required/i.test(body,)) {
        return 'X declined the post (402 — out of API credits). Posting to X now consumes credits on your X API plan, and this app has none left. '
            + 'Check Usage & billing in the X developer portal (developer.x.com): the free tier\'s posting allowance is limited and, once used, X requires a paid plan to keep posting.';
    }
    if (status === 401) {
        return 'X rejected the credentials (401). Re-check the API Key/Secret + Access Token/Secret, and that the token was generated with Write access.';
    }
    if (status === 403) {
        return 'X refused the post (403). Set the app to Read and Write in the developer portal, then REGENERATE the Access Token & Secret (a token made before enabling write is read-only).';
    }
    if (status === 429) {
        return 'X rate limit reached (429). Wait a bit and try again.';
    }
    return `X API ${status}: ${body.slice(0, 200,)}`;
}

async function publishToTwitter(text: string, mediaUrls: string[], userId?: string | null,): Promise<PublishResult> {
    if (!text.trim() && mediaUrls.length === 0) {
        return { provider: 'twitter', ok: false, error: 'Write something or attach media.', };
    }

    const creds = await getTwitterCreds();
    if (!creds) {
        return {
            provider: 'twitter',
            ok: false,
            error: 'X write credentials missing. Add API key/secret + access token/secret in Configuration.',
        };
    }

    const url = 'https://api.twitter.com/2/tweets';
    try {
        let mediaIds: string[] = [];
        if (mediaUrls.length > 0) {
            mediaIds = await uploadTweetMedia(mediaUrls, creds,);
        }

        // JSON body → no body params participate in the OAuth signature.
        const authHeader = buildAuthHeader('POST', url, {}, creds,);
        const payload: Record<string, unknown> = { text, };
        if (mediaIds.length > 0) payload.media = { media_ids: mediaIds, };
        const res = await fetch(url, {
            method: 'POST',
            headers: { Authorization: authHeader, 'Content-Type': 'application/json', },
            body: JSON.stringify(payload,),
        },);

        if (!res.ok) {
            const body = await res.text().catch(() => '',);
            logger.warn('X publish failed', { status: res.status, body: body.slice(0, 300,), },);
            return { provider: 'twitter', ok: false, error: friendlyXError(res.status, body,), };
        }

        const json = await res.json() as { data?: { id?: string; }; };
        const id = json.data?.id;
        if (!id) return { provider: 'twitter', ok: false, error: 'X API returned no tweet id.', };

        // Capture the new tweet into the feed as a POSSE post. Hydrate for a rich
        // card; fall back to a minimal row if the syndication read isn't ready.
        const hydrated = await fetchTweetById(id,);
        const postUrl = `https://x.com/i/status/${id}`;
        await upsertSocialPost('twitter', hydrated ?? {
            id,
            content: text,
            mediaUrl: postUrl,
            publishedAt: new Date(0,),
            rawData: { posse: true, },
        }, { source: 'posse', postUrl, createdBy: userId ?? null, },).catch((error,) =>
            logger.warn('POSSE capture upsert failed', { id, error, },));

        await cache.invalidateSocialCache();
        return { provider: 'twitter', ok: true, id, };
    } catch (error) {
        logger.error('X publish error', { error, },);
        return { provider: 'twitter', ok: false, error: error instanceof Error ? error.message : 'Publish failed', };
    }
}

/** Publish `text` to each requested provider. Partial success is normal. */
export async function publishPost(
    input: PublishInput,
    ctx?: { userId?: string | null; },
): Promise<PublishResult[]> {
    const results: PublishResult[] = [];
    for (const provider of input.providers) {
        if (provider === 'twitter') {
            results.push(await publishToTwitter(input.text, input.mediaUrls ?? [], ctx?.userId,),);
        } else {
            results.push({
                provider,
                ok: false,
                error: `Publishing to ${provider} isn't supported yet.`,
            },);
        }
    }
    return results;
}
