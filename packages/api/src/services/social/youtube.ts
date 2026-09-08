/**
 * YouTube Data API v3 reader.
 *
 * Reading a channel's public uploads needs only an API KEY — no OAuth — which
 * is why the connection is considered usable with a key alone.
 *
 * Credentials come from the `social_connections` row FIRST and fall back to the
 * env vars. The admin form is where an operator expects to set this; reading
 * only from env (the previous behaviour) meant a key saved in the UI was
 * accepted, displayed, and then ignored by every sync.
 *
 * Classification: `search.list` returns snippets only, so a second
 * `videos.list` call fetches `contentDetails` + `liveStreamingDetails` for the
 * batch (one request per 50 ids). That is what makes shorts/live/full
 * distinguishable at all.
 */
import { config, } from '../../config';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import type { FetchedPost, } from './types';

/** What kind of thing a YouTube item is, from the operator's point of view. */
export type YouTubeMediaKind = 'short' | 'live' | 'video';

export interface YouTubeCredentials {
    apiKey: string;
    channelId: string;
}

/** Options an operator can set per sync (stored on the connection settings). */
export interface YouTubeFetchOptions {
    maxResults?: number;
    /** Free-text search within the channel. */
    search?: string;
    /** Restrict to one kind. Omit for everything. */
    kind?: YouTubeMediaKind;
}

const API = 'https://www.googleapis.com/youtube/v3';

/**
 * A Short is not a distinct resource in the API, so this is a duration
 * heuristic — and the threshold has to track YouTube's product, not folklore.
 *
 * YouTube raised the Shorts ceiling from 60s to **3 minutes** in late 2024. A
 * 60s cut-off therefore reports a channel of 1–2 minute Shorts as ordinary
 * videos, which is exactly what it did for the first real channel this ran
 * against (every clip 1m01s–1m38s classified as `video`, Shorts filter empty).
 *
 * The trade is explicit: a genuine long-form video under 3 minutes will be
 * called a Short. That is the less damaging error — a short clip filed as a
 * video is invisible to the Shorts filter, whereas the reverse merely puts an
 * extra item in a list the operator is already curating.
 */
const SHORT_MAX_SECONDS = 180;

/** ISO-8601 duration (`PT1M5S`) → seconds. Returns null when unparseable. */
export function parseIsoDuration(iso: string | null | undefined,): number | null {
    if (!iso) return null;
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso,);
    if (!m) return null;
    const [, d, h, min, sec,] = m;
    const total = (Number(d ?? 0,) * 86400) + (Number(h ?? 0,) * 3600)
        + (Number(min ?? 0,) * 60) + Number(sec ?? 0,);
    return Number.isFinite(total,) ? total : null;
}

/** Classify one `videos.list` item. */
export function classifyVideo(video: {
    contentDetails?: { duration?: string; };
    liveStreamingDetails?: unknown;
    snippet?: { liveBroadcastContent?: string; };
},): YouTubeMediaKind {
    const broadcast = video.snippet?.liveBroadcastContent;
    // 'live'/'upcoming' means it is a broadcast right now; a finished stream
    // keeps liveStreamingDetails, which is how past streams stay identifiable.
    if (broadcast === 'live' || broadcast === 'upcoming') return 'live';
    if (video.liveStreamingDetails) return 'live';

    const seconds = parseIsoDuration(video.contentDetails?.duration,);
    if (seconds !== null && seconds > 0 && seconds <= SHORT_MAX_SECONDS) return 'short';
    return 'video';
}

/** A real channel id: `UC` + 22 chars. Anything else is a handle or username. */
export function isChannelId(value: string,): boolean {
    return /^UC[\w-]{22}$/.test(value.trim(),);
}

/** A channel, as the API knows it. */
export interface YouTubeChannelInfo {
    /** The canonical `UC…` id. */
    channelId: string;
    /** Channel title, e.g. "Frank Scales". */
    title: string;
    /** The `@handle`, when the channel has one. */
    handle: string | null;
}

/**
 * Look up a channel from whatever an operator actually pastes.
 *
 * People copy the handle from the channel page (`frank.scales`, `@frank.scales`,
 * or the full `youtube.com/@frank.scales` URL) because that is what YouTube
 * shows them — the `UC…` id is not visible anywhere in the normal UI. Feeding a
 * handle to `search.list?channelId=` silently returns nothing, so it has to be
 * resolved first.
 *
 * Returns the TITLE as well as the id, in the same request, because the two are
 * always wanted together: the id to sync with, the title to show the operator
 * so they can see which channel they actually connected.
 *
 * Null when the channel doesn't exist or the API can't be reached, so a caller
 * can say so instead of syncing an empty channel forever.
 */
export async function describeChannel(
    raw: string,
    apiKey: string,
): Promise<YouTubeChannelInfo | null> {
    const value = raw.trim()
        .replace(/^https?:\/\/(www\.)?youtube\.com\//i, '',)
        .replace(/^channel\//i, '',)
        .replace(/\/.*$/, '',);
    if (!value || !apiKey) return null;

    // An id is looked up by id; anything else is treated as a handle. `forHandle`
    // is the modern lookup; `forUsername` still resolves the old /user/<name>
    // vanity URLs that predate handles.
    const params = isChannelId(value,)
        ? [`id=${encodeURIComponent(value,)}`,]
        : [
            `forHandle=${encodeURIComponent(value.startsWith('@',) ? value : `@${value}`,)}`,
            `forUsername=${encodeURIComponent(value.replace(/^@/, '',),)}`,
        ];

    try {
        for (const param of params) {
            const res = await fetch(`${API}/channels?part=snippet&${param}&key=${apiKey}`,);
            if (!res.ok) continue;
            const data = await res.json() as {
                items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string; }; }>;
            };
            const item = data.items?.[0];
            if (item?.id) {
                return {
                    channelId: item.id,
                    title: item.snippet?.title ?? '',
                    handle: item.snippet?.customUrl ?? null,
                };
            }
        }
    } catch (e) {
        logger.warn('youtube: channel lookup failed', { error: (e as Error).message, },);
        return null;
    }
    logger.warn('youtube: no channel found', { value, },);
    return null;
}

/** Just the id — `describeChannel` with the rest discarded. */
export async function resolveChannelId(
    raw: string,
    apiKey: string,
): Promise<string | null> {
    return (await describeChannel(raw, apiKey,))?.channelId ?? null;
}

/**
 * Credentials for the YouTube connection: the saved row wins, env is fallback.
 * Returns null when neither supplies both parts.
 */
export async function resolveCredentials(): Promise<YouTubeCredentials | null> {
    let saved: Record<string, unknown> = {};
    try {
        const res = await query<{ credentials: Record<string, unknown> | null; }>(
            `SELECT credentials FROM social_connections WHERE provider = 'youtube'`,
        );
        saved = res.rows[0]?.credentials ?? {};
    } catch (e) {
        logger.warn('youtube: could not read saved credentials', { error: (e as Error).message, },);
    }

    const apiKey = String(saved.apiKey || config.social.youtube.apiKey || '',).trim();
    const configured = String(saved.channelId || config.social.youtube.channelId || '',).trim();
    if (!apiKey || !configured) return null;

    // Accept a handle here rather than forcing the operator to hunt for the
    // UC id: resolve once per fetch and let the caller work in ids.
    const channelId = await resolveChannelId(configured, apiKey,);
    if (!channelId) return null;
    return { apiKey, channelId, };
}

/** Fetch `contentDetails`/`liveStreamingDetails` for up to 50 ids. */
async function fetchVideoDetails(
    ids: string[],
    apiKey: string,
): Promise<Map<string, YouTubeMediaKind>> {
    const out = new Map<string, YouTubeMediaKind>();
    if (ids.length === 0) return out;

    const url = `${API}/videos?key=${apiKey}`
        + `&part=contentDetails,liveStreamingDetails,snippet&id=${ids.join(',',)}`;
    const res = await fetch(url,);
    if (!res.ok) {
        // Classification is an enhancement; without it everything is a plain
        // video rather than the whole sync failing.
        logger.warn('youtube: videos.list failed; kinds default to "video"', {
            status: res.status,
        },);
        return out;
    }
    const data = await res.json() as { items?: Array<Record<string, any>>; };
    for (const v of data.items ?? []) {
        out.set(v.id as string, classifyVideo(v,),);
    }
    return out;
}

/**
 * Fetch a channel's recent videos, classified by kind.
 *
 * Each returned post carries `rawData.mediaKind` so the sync can persist it and
 * the block picker can filter on it.
 */
export async function fetchYouTubeVideos(
    maxResultsOrOpts: number | YouTubeFetchOptions = 10,
): Promise<FetchedPost[]> {
    const opts: YouTubeFetchOptions = typeof maxResultsOrOpts === 'number'
        ? { maxResults: maxResultsOrOpts, }
        : maxResultsOrOpts;
    const maxResults = Math.min(50, Math.max(1, opts.maxResults ?? 10,),);

    const creds = await resolveCredentials();
    if (!creds) {
        logger.warn('YouTube configuration not set — need an API key and channel id',);
        return [];
    }

    try {
        const params = new URLSearchParams({
            key: creds.apiKey,
            channelId: creds.channelId,
            part: 'snippet',
            order: 'date',
            maxResults: String(maxResults,),
            type: 'video',
        },);
        if (opts.search) params.set('q', opts.search,);
        // Narrow server-side where the API can: it has no "shorts" filter, but
        // it can restrict to live broadcasts, which saves pulling and
        // discarding the rest.
        if (opts.kind === 'live') params.set('eventType', 'live',);

        const response = await fetch(`${API}/search?${params.toString()}`,);
        if (!response.ok) {
            throw new Error(`YouTube API error: ${response.status} ${response.statusText}`,);
        }

        const data = await response.json() as { items?: Array<Record<string, any>>; };
        const items = data.items ?? [];
        const ids = items
            .map((i,) => i.id?.videoId as string | undefined)
            .filter((v,): v is string => Boolean(v,));

        const kinds = await fetchVideoDetails(ids, creds.apiKey,);

        const posts = items.map((item,) => {
            const snippet = item.snippet as Record<string, any>;
            const id = item.id?.videoId as string;
            const kind = kinds.get(id,) ?? 'video';
            return {
                id,
                content: snippet?.title as string,
                mediaUrl: kind === 'short'
                    ? `https://www.youtube.com/shorts/${id}`
                    : `https://www.youtube.com/watch?v=${id}`,
                thumbnailUrl: snippet?.thumbnails?.high?.url as string | undefined,
                authorName: snippet?.channelTitle as string,
                publishedAt: new Date(snippet?.publishedAt as string,),
                rawData: { ...item, mediaKind: kind, },
            } as FetchedPost;
        },);

        // The API can't filter shorts, so that narrowing happens here.
        return opts.kind ? posts.filter((p,) => (p.rawData as any).mediaKind === opts.kind) : posts;
    } catch (error) {
        logger.error('Error fetching YouTube videos', { error, },);
        return [];
    }
}
