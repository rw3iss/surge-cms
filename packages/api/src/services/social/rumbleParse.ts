/**
 * Rumble — PURE parsing + mapping (no I/O; unit-tested in rumble.test.ts).
 *
 * Rumble has NO official OAuth / developer / analytics API. Two sources:
 *
 *  1. PUBLIC channel pages `https://rumble.com/c/<name>/videos?page=N` (also
 *     `/user/<name>/videos`). The HTML carries
 *     `<rum-videos-grid><script type="application/json">{"items":[…]}</script>`
 *     with 25 videos per page. The format is UNOFFICIAL and can change, so the
 *     parser is defensive: a missing grid / bad JSON returns a clear problem
 *     string, never a throw. robots.txt allows these pages (it disallows only
 *     /l/ and /api/ — we never call either, oEmbed included).
 *  2. The OWNER Live Stream API: a private URL with a key the creator makes at
 *     rumble.com/account/livestream-api. The whole URL is a SECRET (the key is
 *     in it); each livestream also carries its `stream_key`, which is DROPPED
 *     here and never stored.
 */

export const RUMBLE_HOSTS = new Set(['rumble.com', 'www.rumble.com',],);
export const RUMBLE_LIVE_API_HELP_URL = 'https://rumble.com/account/livestream-api';

/** One item of the channel page's `rum-videos-grid` JSON (only what we read). */
export interface RumbleVideoItem {
    object_type?: string;
    id?: number | string;
    eid?: string;
    permalink_id?: string;
    url?: string;
    relative_url?: string;
    title?: string;
    thumb?: string;
    upload_date?: string;
    duration?: number;
    is_short?: boolean;
    live?: boolean;
    live_datetime?: string | null;
    live_streamed_on?: string | null;
    livestream_status?: string | number | null;
    watching_now?: number | null;
    views?: number;
    comments?: { count?: number; };
    rumble_votes?: { num_votes_up?: number; num_votes_down?: number; score?: number; };
    reposts_count?: number;
    video_stats?: { rumble_plays?: number; youtube_views?: number; revenue?: number; revenue_units?: string; };
    visibility?: string;
    is_monetized?: boolean;
    tags?: unknown[];
    video_width?: number;
    video_height?: number;
    by?: RumbleChannelInfo;
}

export interface RumbleChannelInfo {
    type?: 'channel' | 'user' | string;
    url?: string;
    relative_url?: string;
    name?: string;
    title?: string;
    followers?: number;
    subscribers?: number;
    verified_badge?: boolean;
    thumb?: string;
    id?: string;
    eid?: string;
}

export interface ParsedVideosPage {
    items: RumbleVideoItem[];
    /** Highest `?page=N` linked from the page (0 = no pagination found). */
    lastPage: number;
    /** Why nothing could be read (format change, not a channel page…). */
    problem: string | null;
}

const GRID_RE = /<rum-videos-grid\b[^>]*>\s*<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i;

/** Read the videos grid JSON out of a channel videos page. Never throws. */
export function parseVideosPage(html: string,): ParsedVideosPage {
    const pages = [...String(html ?? '',).matchAll(/[?&]page=(\d{1,4})\b/g,),].map((m,) => Number(m[1],));
    const lastPage = pages.length ? Math.max(...pages,) : 0;
    const m = GRID_RE.exec(String(html ?? '',),);
    if (!m) {
        return { items: [], lastPage, problem: 'the channel page has no videos grid (Rumble may have changed its page format)', };
    }
    let data: unknown;
    try {
        data = JSON.parse(m[1]!,);
    } catch {
        return { items: [], lastPage, problem: 'the videos grid JSON could not be read (Rumble may have changed its page format)', };
    }
    const raw = (data as { items?: unknown; } | null)?.items;
    if (!Array.isArray(raw,)) {
        return { items: [], lastPage, problem: 'the videos grid has no items list (Rumble may have changed its page format)', };
    }
    const items = raw.filter((i,): i is RumbleVideoItem =>
        Boolean(i,) && typeof i === 'object'
        && ((i as RumbleVideoItem).object_type ?? 'video') === 'video'
        && (typeof (i as RumbleVideoItem).id === 'number' || typeof (i as RumbleVideoItem).id === 'string')
    );
    return { items, lastPage, problem: null, };
}

/** A finite, non-negative number, else null. */
export function count(v: unknown,): number | null {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v,) : v;
    return typeof n === 'number' && Number.isFinite(n,) && n >= 0 ? n : null;
}

/** The player id: `v` + base36 of the numeric video id (`449778068` → `v7fsaz8`). */
export function rumbleEmbedId(id: number | string,): string | null {
    const n = Number(id,);
    return Number.isSafeInteger(n,) && n > 0 ? `v${n.toString(36,)}` : null;
}

export function rumbleKind(item: RumbleVideoItem,): 'short' | 'live' | 'video' {
    if (item.is_short) return 'short';
    if (item.live || item.livestream_status != null || item.live_datetime || item.live_streamed_on) return 'live';
    return 'video';
}

function absoluteUrl(item: RumbleVideoItem,): string | null {
    if (item.url && /^https:\/\/(?:www\.)?rumble\.com\//i.test(item.url,)) return item.url;
    if (item.relative_url && item.relative_url.startsWith('/',)) return `https://rumble.com${item.relative_url}`;
    return null;
}

function isoOrNull(v: unknown,): string | null {
    const t = Date.parse(String(v ?? '',),);
    return Number.isFinite(t,) ? new Date(t,).toISOString() : null;
}

/** When a video went up (live streams: when they streamed/started). */
export function publishedAtOf(item: RumbleVideoItem,): string | null {
    return isoOrNull(item.upload_date,) ?? isoOrNull(item.live_streamed_on,) ?? isoOrNull(item.live_datetime,);
}

/** Rumble thumbnails live on *.rumble.cloud — stable, unsigned (not mirrored). */
function thumbOf(item: RumbleVideoItem,): string | undefined {
    return item.thumb && /^https:\/\//i.test(item.thumb,) ? item.thumb : undefined;
}

/** The row shape `upsertSocialPost` takes (FetchedPost), from one grid item. */
export function rumbleFetchedPost(item: RumbleVideoItem,): {
    id: string;
    content?: string;
    mediaUrl?: string;
    thumbnailUrl?: string;
    authorName?: string;
    authorAvatar?: string;
    likes?: number;
    comments?: number;
    shares?: number;
    publishedAt: Date;
    rawData: Record<string, unknown>;
} {
    const id = String(item.id,);
    const published = publishedAtOf(item,);
    const by = item.by ?? {};
    return {
        id,
        content: item.title || undefined,
        mediaUrl: absoluteUrl(item,) ?? undefined,
        thumbnailUrl: thumbOf(item,),
        authorName: by.title || by.name || undefined,
        authorAvatar: by.thumb && /^https:\/\//i.test(by.thumb,) ? by.thumb : undefined,
        likes: count(item.rumble_votes?.num_votes_up,) ?? undefined,
        comments: count(item.comments?.count,) ?? undefined,
        shares: count(item.reposts_count,) ?? undefined,
        publishedAt: published ? new Date(published,) : new Date(0,),
        // Trimmed: the item also lists every MP4 rendition and a tracking log URL.
        rawData: {
            mediaKind: rumbleKind(item,),
            durationSeconds: count(item.duration,),
            embedId: rumbleEmbedId(item.id!,),
            eid: item.eid ?? null,
            permalinkId: item.permalink_id ?? null,
            title: item.title ?? null,
            views: count(item.views,),
            votesUp: count(item.rumble_votes?.num_votes_up,),
            votesDown: count(item.rumble_votes?.num_votes_down,),
            votesScore: typeof item.rumble_votes?.score === 'number' ? item.rumble_votes.score : null,
            reposts: count(item.reposts_count,),
            rumblePlays: count(item.video_stats?.rumble_plays,),
            isShort: Boolean(item.is_short,),
            live: Boolean(item.live,),
            liveDatetime: item.live_datetime ?? null,
            liveStreamedOn: item.live_streamed_on ?? null,
            livestreamStatus: item.livestream_status ?? null,
            watchingNow: count(item.watching_now,),
            visibility: item.visibility ?? null,
            isMonetized: item.is_monetized ?? null,
            width: count(item.video_width,),
            height: count(item.video_height,),
            channel: by.url ?? null,
        },
    };
}

// ── Channel input ─────────────────────────────────────────────────────────

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

export interface ChannelRef {
    /** `c` = /c/<name>, `user` = /user/<name>, `any` = a bare name (try both). */
    kind: 'c' | 'user' | 'any';
    name: string;
}

/**
 * Read what the operator typed: a channel URL (`https://rumble.com/c/Name`,
 * `/user/Name`, with or without `/videos` or a query), `@Name`, or `Name`.
 * Anything else — another host, a video URL, odd characters — is null.
 */
export function parseChannelInput(input: string,): ChannelRef | null {
    const s = String(input ?? '',).trim();
    if (!s) return null;
    if (/^(?:https?:\/\/|\/\/|(?:www\.)?rumble\.com\/)/i.test(s,)) {
        let u: URL;
        try {
            u = new URL(/^https?:\/\//i.test(s,) ? s : `https://${s.replace(/^\/\//, '',)}`,);
        } catch {
            return null;
        }
        if (!RUMBLE_HOSTS.has(u.hostname.toLowerCase(),)) return null;
        const parts = u.pathname.split('/',).filter(Boolean,);
        if ((parts[0] === 'c' || parts[0] === 'user') && parts[1] && NAME_RE.test(parts[1],)) {
            return { kind: parts[0], name: parts[1], };
        }
        // rumble.com/<name> vanity links (not a video page: those start with v + id-).
        if (parts.length === 1 && NAME_RE.test(parts[0]!,) && !/^v[a-z0-9]+-/i.test(parts[0]!,)) return { kind: 'any', name: parts[0]!, };
        return null;
    }
    const name = s.replace(/^@/, '',);
    return NAME_RE.test(name,) ? { kind: 'any', name, } : null;
}

/** Page URLs to try for a ref, in order. */
export function channelCandidates(ref: ChannelRef,): string[] {
    const enc = encodeURIComponent(ref.name,);
    if (ref.kind === 'c') return [`https://rumble.com/c/${enc}`,];
    if (ref.kind === 'user') return [`https://rumble.com/user/${enc}`,];
    return [`https://rumble.com/c/${enc}`, `https://rumble.com/user/${enc}`,];
}

/** `https://rumble.com/c/name` from any channel page URL (drops /videos, query, hash). */
export function canonicalChannelUrl(url: string,): string | null {
    try {
        const u = new URL(url,);
        if (!RUMBLE_HOSTS.has(u.hostname.toLowerCase(),)) return null;
        const parts = u.pathname.split('/',).filter(Boolean,);
        if ((parts[0] === 'c' || parts[0] === 'user') && parts[1] && NAME_RE.test(decodeURIComponent(parts[1],),)) {
            return `https://rumble.com/${parts[0]}/${parts[1]}`;
        }
    } catch {
        // fall through
    }
    return null;
}

export function videosPageUrl(channelUrl: string, page: number,): string {
    return page > 1 ? `${channelUrl}/videos?page=${page}` : `${channelUrl}/videos`;
}

/** The channel's own info from a page of its videos (the first item it authored). */
export function channelInfoFrom(items: RumbleVideoItem[], channelUrl: string,): RumbleChannelInfo | null {
    const want = channelUrl.toLowerCase();
    const own = items.find((i,) => i.by?.url && i.by.url.toLowerCase() === want,);
    return own?.by ?? items[0]?.by ?? null;
}

// ── Owner Live Stream API ─────────────────────────────────────────────────

/**
 * SSRF guard: the Live Stream API URL must be https on rumble.com with a
 * /-livestream-api/ path (as Rumble issues it). Returns the normalized URL.
 */
export function validateLiveApiUrl(input: string,): { ok: true; url: string; } | { ok: false; error: string; } {
    let u: URL;
    try {
        u = new URL(String(input ?? '',).trim(),);
    } catch {
        return { ok: false, error: 'Paste the full Live Stream API URL from rumble.com/account/livestream-api.', };
    }
    if (u.protocol !== 'https:' || !RUMBLE_HOSTS.has(u.hostname.toLowerCase(),) || u.port || u.username || u.password) {
        return { ok: false, error: 'The Live Stream API URL must be an https://rumble.com address.', };
    }
    if (!u.pathname.startsWith('/-livestream-api/',)) {
        return { ok: false, error: 'The Live Stream API URL must start with https://rumble.com/-livestream-api/ (copy it from rumble.com/account/livestream-api).', };
    }
    u.hash = '';
    return { ok: true, url: u.toString(), };
}

/** Remove a secret Live Stream API URL (and its key) from a message. */
export function redactLiveApiUrl(message: string, url?: string | null,): string {
    let out = String(message ?? '',);
    if (url) {
        out = out.split(url,).join('[live-api-url]',);
        try {
            const key = new URL(url,).searchParams.get('key',);
            if (key && key.length >= 6) out = out.split(key,).join('[key]',);
        } catch {
            // ignore
        }
    }
    return out.replace(/https?:\/\/(?:www\.)?rumble\.com\/-livestream-api\/[^\s"']*/gi, '[live-api-url]',);
}

export interface RumbleLiveRant {
    username: string | null;
    text: string | null;
    createdOn: string | null;
    amountCents: number;
}

export interface RumbleLiveMessage {
    username: string | null;
    text: string | null;
    createdOn: string | null;
}

export interface RumbleLivestream {
    id: string;
    title: string | null;
    createdOn: string | null;
    isLive: boolean;
    categories: { primary: string | null; secondary: string | null; };
    likes: number | null;
    dislikes: number | null;
    watchingNow: number | null;
    recentMessages: RumbleLiveMessage[];
    recentRants: RumbleLiveRant[];
}

export interface RumbleLiveDatedUser {
    username: string | null;
    on: string | null;
}

/** The Live Stream API answer, normalized — never carries a stream key. */
export interface RumbleLiveData {
    now: string | null;
    type: string | null;
    userId: string | null;
    channelId: string | null;
    username: string | null;
    channelName: string | null;
    followers: number | null;
    followersTotal: number | null;
    recentFollowers: RumbleLiveDatedUser[];
    subscribers: number | null;
    recentSubscribers: Array<RumbleLiveDatedUser & { amountCents: number | null; }>;
    giftedSubs: number | null;
    recentGiftedSubs: number;
    livestreams: RumbleLivestream[];
}

const str = (v: unknown,): string | null => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v,) : null);
const arr = (v: unknown,): Array<Record<string, unknown>> => (Array.isArray(v,) ? v.filter((x,) => x && typeof x === 'object',) as Array<Record<string, unknown>> : []);

function cents(o: Record<string, unknown>,): number | null {
    const c = count(o.amount_cents,);
    if (c !== null) return Math.round(c,);
    const d = count(o.amount_dollars,);
    return d !== null ? Math.round(d * 100,) : null;
}

/** Map the raw JSON; null when it is not a Live Stream API answer. The stream key is dropped. */
export function mapLiveApi(json: unknown,): RumbleLiveData | null {
    if (!json || typeof json !== 'object' || Array.isArray(json,)) return null;
    const j = json as Record<string, any>;
    if (!('followers' in j) && !('livestreams' in j) && !('username' in j)) return null;
    const followers = (j.followers ?? {}) as Record<string, unknown>;
    const subs = (j.subscribers ?? {}) as Record<string, unknown>;
    const gifted = (j.gifted_subs ?? {}) as Record<string, unknown>;
    return {
        now: str(j.now,),
        type: str(j.type,),
        userId: str(j.user_id,),
        channelId: str(j.channel_id,),
        username: str(j.username,),
        channelName: str(j.channel_name,),
        followers: count(followers.num_followers,),
        followersTotal: count(followers.num_followers_total,),
        recentFollowers: arr(followers.recent_followers,).map((f,) => ({ username: str(f.username,), on: str(f.followed_on,), }),),
        subscribers: count(subs.num_subscribers,),
        recentSubscribers: arr(subs.recent_subscribers,).map((s,) => ({ username: str(s.username,), on: str(s.subscribed_on,), amountCents: cents(s,), }),),
        giftedSubs: count(gifted.num_gifted_subs,),
        recentGiftedSubs: arr(gifted.recent_gifted_subs,).length,
        livestreams: arr(j.livestreams,).map((l,): RumbleLivestream => {
            const chat = (l.chat ?? {}) as Record<string, unknown>;
            const cat = (l.categories ?? {}) as Record<string, any>;
            return {
                id: str(l.id,) ?? '',
                title: str(l.title,),
                createdOn: str(l.created_on,),
                isLive: l.is_live === true,
                categories: { primary: str(cat.primary?.title ?? cat.primary,), secondary: str(cat.secondary?.title ?? cat.secondary,), },
                likes: count(l.likes,),
                dislikes: count(l.dislikes,),
                watchingNow: count(l.watching_now,),
                recentMessages: arr(chat.recent_messages,).map((m,) => ({ username: str(m.username,), text: str(m.text,), createdOn: str(m.created_on,), }),),
                recentRants: arr(chat.recent_rants,).map((r,) => ({ username: str(r.username,), text: str(r.text,), createdOn: str(r.created_on,), amountCents: cents(r,) ?? 0, }),),
            };
        },).filter((l,) => l.id,),
    };
}
