/**
 * Resolve a stored social post to something renderable.
 *
 * Preferred: a native card (our `SocialEmbed` component renders the stored
 * fields directly — no X JavaScript). When a manual row wasn't hydrated at
 * capture time, we retry hydration here; if that also fails we fall back to
 * X's official oEmbed HTML (sanitized). Results cached in Redis.
 */
import type { SocialPost, } from '@sitesurge/types';
import { logger, } from '../../utils/logger';
import { sanitize, } from '../../utils/sanitize';
import { cache, } from '../cache';
import { upsertSocialPost, } from '../social';
import { fetchTweetById, } from './twitterHydrate';

const EMBED_CACHE_TTL = 3600; // 1 hour

export interface ResolvedEmbed {
    mode: 'card' | 'oembed';
    /** Present when mode === 'oembed'. Sanitized HTML. */
    html?: string;
    /** Present when mode === 'card'. The (possibly re-hydrated) post. */
    card?: SocialPost;
}

/** True when a post already carries enough to render a native card. */
function isHydrated(post: SocialPost,): boolean {
    return Boolean(post.content || post.thumbnailUrl,);
}

async function fetchOEmbed(url: string,): Promise<string | null> {
    try {
        const api = `https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(url,)}`;
        const res = await fetch(api,);
        if (!res.ok) return null;
        const json = await res.json() as { html?: string; };
        return json.html ? sanitize(json.html,) : null;
    } catch (error) {
        logger.warn('oEmbed fetch failed', { url, error, },);
        return null;
    }
}

export async function resolveEmbed(post: SocialPost,): Promise<ResolvedEmbed> {
    // Already renderable → card, no network.
    if (isHydrated(post,)) return { mode: 'card', card: post, };

    const cacheKey = cache.CACHE_KEYS.socialEmbed(post.id,);
    const cached = await cache.get<ResolvedEmbed>(cacheKey,);
    if (cached) return cached;

    let resolved: ResolvedEmbed;

    // Only X supports the tweet-result / oEmbed re-hydration path today.
    if (post.platform === 'twitter') {
        const hydrated = await fetchTweetById(post.externalId,);
        if (hydrated) {
            // Persist the hydration so future reads are cheap and the card
            // shows in the admin Posts list too.
            await upsertSocialPost('twitter', hydrated, { source: post.source ?? 'manual', postUrl: post.postUrl ?? null, },)
                .catch((error,) => logger.warn('re-hydration upsert failed', { id: post.id, error, },));
            resolved = {
                mode: 'card',
                card: {
                    ...post,
                    content: hydrated.content,
                    thumbnailUrl: hydrated.thumbnailUrl,
                    authorName: hydrated.authorName,
                    authorAvatar: hydrated.authorAvatar,
                    likes: hydrated.likes,
                    comments: hydrated.comments,
                },
            };
        } else {
            const url = post.postUrl || post.mediaUrl;
            const html = url ? await fetchOEmbed(url,) : null;
            resolved = html ? { mode: 'oembed', html, } : { mode: 'card', card: post, };
        }
    } else {
        resolved = { mode: 'card', card: post, };
    }

    await cache.set(cacheKey, resolved, EMBED_CACHE_TTL,);
    return resolved;
}
