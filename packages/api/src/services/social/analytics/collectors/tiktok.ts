/**
 * TikTok analytics collector (plan §3.5).
 *
 *  1. Display API v2 (open.tiktokapis.com, the connection's user token):
 *     profile followers / following / likes / video count (`user.info.stats`)
 *     and every video's views, likes, comments, shares (`video.list`).
 *     TikTok has no feed fetcher, so the listed videos are also UPSERTED into
 *     social_posts (`upsertTikTokVideos`) — otherwise the runner could not map
 *     their metrics and the dashboard's post table would stay empty.
 *  2. Business API v1.3 (business-api.tiktok.com) — only when the credentials
 *     carry `businessAccessToken` + `businessId` (a TikTok Business Account and
 *     an approved "Accounts insights" app): per-video total / average watch
 *     time, full-watch rate, reach; daily profile views, video views, net
 *     followers. 24–48 h latency, so the daily window is rewritten each run.
 *
 * Tokens: a user access token lasts ~2 h and a refresh token ~180 days; each
 * refresh ROTATES the refresh token, so the new pair is saved back to
 * social_connections.credentials before anything else happens.
 */
import type { SocialCollectorStatus, } from '@sitesurge/types';
import { config, } from '../../../../config';
import { query, } from '../../../../db';
import { registerCollector, } from '../registry';
import type { AccountSnapshot, CollectContext, CollectResult, DailyPoint, PostMetric, } from '../types';

const DISPLAY_API = 'https://open.tiktokapis.com/v2';
const BUSINESS_API = 'https://business-api.tiktok.com/open_api/v1.3';
const USER_FIELDS = 'open_id,display_name,username,avatar_url,follower_count,following_count,likes_count,video_count';
const VIDEO_FIELDS = 'id,create_time,cover_image_url,share_url,video_description,title,duration,like_count,comment_count,share_count,view_count';
const BUSINESS_VIDEO_FIELDS = ['item_id', 'video_views', 'likes', 'comments', 'shares', 'reach', 'total_time_watched', 'average_time_watched', 'full_video_watched_rate',];
const BUSINESS_DAILY_FIELDS = ['followers_count', 'profile_views', 'video_views', 'likes', 'comments', 'shares',];
/** 20 videos per page (TikTok's max) × 25 = the 500 newest videos. */
const MAX_PAGES = 25;
const PAGE_SIZE = 20;
const DAILY_WINDOW = 7;
/** Refresh this long before the access token expires. */
const SKEW_MS = 5 * 60_000;

export interface TikTokVideo {
    id: string;
    create_time?: number;
    cover_image_url?: string;
    share_url?: string;
    video_description?: string;
    title?: string;
    duration?: number;
    like_count?: number;
    comment_count?: number;
    share_count?: number;
    view_count?: number;
}

export interface TikTokUser {
    open_id?: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
    follower_count?: number;
    following_count?: number;
    likes_count?: number;
    video_count?: number;
}

const n = (v: unknown,): number | null => {
    const x = Number(v,);
    return v === undefined || v === null || v === '' || !Number.isFinite(x,) ? null : x;
};

function addDays(day: string, k: number,): string {
    const d = new Date(`${day}T00:00:00Z`,);
    d.setUTCDate(d.getUTCDate() + k,);
    return d.toISOString().slice(0, 10,);
}

// ── Pure mappers (unit-tested) ───────────────────────────────────────────

export function tiktokAccount(u: TikTokUser,): AccountSnapshot {
    return {
        followers: n(u.follower_count,),
        following: n(u.following_count,),
        postsCount: n(u.video_count,),
        totalLikes: n(u.likes_count,),
        raw: { ...u, },
    };
}

export function tiktokPostMetric(v: TikTokVideo,): PostMetric {
    return {
        externalId: v.id,
        views: n(v.view_count,),
        likes: n(v.like_count,),
        comments: n(v.comment_count,),
        shares: n(v.share_count,),
        raw: { duration: n(v.duration,), },
    };
}

/** Business API per-video row → the extra numbers it adds (merged over the Display metric). */
export function tiktokBusinessMetric(row: Record<string, unknown>,): PostMetric | null {
    const id = String(row.item_id ?? '',);
    if (!id) return null;
    const rate = n(row.full_video_watched_rate,);
    return {
        externalId: id,
        reach: n(row.reach,),
        watchTimeS: n(row.total_time_watched,),
        avgWatchS: n(row.average_time_watched,),
        // TikTok reports a fraction (0.0237); tolerate a percentage too.
        completionRate: rate === null ? null : rate > 1 ? rate / 100 : rate,
    };
}

/** Business API daily account rows → our daily series. */
export function tiktokBusinessDaily(rows: Array<Record<string, unknown>>,): DailyPoint[] {
    const map: Record<string, string> = {
        followers_count: 'followersNet',
        profile_views: 'profileViews',
        video_views: 'views',
        likes: 'likes',
        comments: 'comments',
        shares: 'shares',
    };
    const out: DailyPoint[] = [];
    for (const row of rows) {
        const date = String(row.date ?? '',).slice(0, 10,);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date,)) continue;
        for (const [field, metric,] of Object.entries(map,)) {
            const v = n(row[field],);
            if (v !== null) out.push({ date, metric, value: v, },);
        }
    }
    return out;
}

/** A listed video → the social_posts row it becomes. */
export function tiktokPostRow(v: TikTokVideo,): {
    externalId: string;
    content: string | null;
    postUrl: string | null;
    thumbnailUrl: string | null;
    publishedAt: string | null;
    durationSeconds: number | null;
    likes: number;
    comments: number;
    shares: number;
} {
    const text = (v.title || v.video_description || '').trim();
    const created = n(v.create_time,);
    return {
        externalId: v.id,
        content: text || null,
        postUrl: v.share_url || null,
        thumbnailUrl: v.cover_image_url || null,
        publishedAt: created ? new Date(created * 1000,).toISOString() : null,
        durationSeconds: n(v.duration,),
        likes: n(v.like_count,) ?? 0,
        comments: n(v.comment_count,) ?? 0,
        shares: n(v.share_count,) ?? 0,
    };
}

export function grantedScopes(credentials: Record<string, unknown>,): string[] | null {
    const s = String(credentials.scope ?? credentials.grantedScopes ?? '',).trim();
    return s ? s.split(/[\s,]+/,).filter(Boolean,) : null;
}

// ── Storage helpers ──────────────────────────────────────────────────────

/** Insert / refresh TikTok videos in social_posts so the runner can map their metrics. */
export async function upsertTikTokVideos(videos: TikTokVideo[], authorName: string | null = null,): Promise<number> {
    let count = 0;
    for (const v of videos) {
        if (!v.id) continue;
        const r = tiktokPostRow(v,);
        await query(
            `INSERT INTO social_posts (platform, external_id, content, media_url, thumbnail_url, author_name, likes, comments, shares,
                    published_at, fetched_at, raw_data, source, post_url, media_kind, duration_seconds)
             VALUES ('tiktok', $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, 'sync', $3, 'video', $11)
             ON CONFLICT (platform, external_id) DO UPDATE SET
               content = COALESCE(EXCLUDED.content, social_posts.content),
               media_url = COALESCE(EXCLUDED.media_url, social_posts.media_url),
               post_url = COALESCE(EXCLUDED.post_url, social_posts.post_url),
               thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, social_posts.thumbnail_url),
               author_name = COALESCE(EXCLUDED.author_name, social_posts.author_name),
               likes = EXCLUDED.likes, comments = EXCLUDED.comments, shares = EXCLUDED.shares,
               published_at = COALESCE(social_posts.published_at, EXCLUDED.published_at),
               duration_seconds = COALESCE(EXCLUDED.duration_seconds, social_posts.duration_seconds),
               media_kind = COALESCE(social_posts.media_kind, EXCLUDED.media_kind),
               raw_data = EXCLUDED.raw_data, fetched_at = NOW()`,
            [r.externalId, r.content, r.postUrl, r.thumbnailUrl, authorName, r.likes, r.comments, r.shares, r.publishedAt,
                JSON.stringify({ ...v, mediaKind: 'video', },), r.durationSeconds,],
        );
        count++;
    }
    return count;
}

async function saveCreds(patch: Record<string, unknown>,): Promise<void> {
    await query(
        `UPDATE social_connections SET credentials = COALESCE(credentials, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE provider = 'tiktok'`,
        [JSON.stringify(patch,),],
    );
}

// ── HTTP ─────────────────────────────────────────────────────────────────

class TikTokError extends Error {
    constructor(message: string, public status: number, public code: string,) {
        super(message,);
    }
}

async function displayCall(token: string, path: string, init: RequestInit = {},): Promise<any> {
    const res = await fetch(`${DISPLAY_API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined), },
    },);
    const body = await res.json().catch(() => ({}));
    const err = (body as { error?: { code?: string; message?: string; }; }).error;
    if (!res.ok || (err?.code && err.code !== 'ok')) {
        throw new TikTokError(err?.message || `HTTP ${res.status}`, res.status, err?.code || '',);
    }
    return (body as { data?: unknown; }).data ?? {};
}

const isAuthError = (e: unknown,): boolean =>
    e instanceof TikTokError && (e.status === 401 || /access_token|token/i.test(e.code,));

function appCredentials(creds: Record<string, unknown>,): { key: string; secret: string; } | null {
    const key = String(creds.clientKey || creds.appId || config.social.tiktok.clientKey || '',);
    const secret = String(creds.clientSecret || creds.appSecret || config.social.tiktok.clientSecret || '',);
    return key && secret ? { key, secret, } : null;
}

/** Exchange the refresh token for a new pair and save both (TikTok rotates refresh tokens). */
export async function refreshTikTokToken(creds: Record<string, unknown>,): Promise<string> {
    const app = appCredentials(creds,);
    const refresh = String(creds.refreshToken ?? '',);
    if (!app || !refresh) throw new Error('TikTok token expired and no refresh token + client key/secret are saved — reconnect TikTok.',);
    const res = await fetch(`${DISPLAY_API}/oauth/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', },
        body: new URLSearchParams({ client_key: app.key, client_secret: app.secret, grant_type: 'refresh_token', refresh_token: refresh, },),
    },);
    const data = await res.json().catch(() => ({})) as Record<string, any>;
    if (!res.ok || !data.access_token) {
        const msg = data.error_description || data.error?.message || data.error || `HTTP ${res.status}`;
        await saveCreds({ oauthError: String(msg,), },).catch(() => {});
        throw new Error(`TikTok token refresh failed: ${String(msg,)}`,);
    }
    const now = Date.now();
    const patch: Record<string, unknown> = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refresh,
        tokenExpiresAt: new Date(now + (Number(data.expires_in,) || 7200) * 1000,).toISOString(),
        oauthError: null,
    };
    if (data.refresh_expires_in) patch.refreshTokenExpiresAt = new Date(now + Number(data.refresh_expires_in,) * 1000,).toISOString();
    if (data.scope) patch.scope = data.scope;
    if (data.open_id) patch.openId = data.open_id;
    await saveCreds(patch,);
    Object.assign(creds, patch,);
    return String(data.access_token,);
}

function tokenExpired(creds: Record<string, unknown>,): boolean {
    const at = Date.parse(String(creds.tokenExpiresAt ?? '',),);
    return Number.isFinite(at,) && at - SKEW_MS <= Date.now();
}

async function businessCall(token: string, path: string, params: Record<string, string>,): Promise<any> {
    const res = await fetch(`${BUSINESS_API}${path}?${new URLSearchParams(params,)}`, { headers: { 'Access-Token': token, }, },);
    const body = await res.json().catch(() => ({})) as { code?: number; message?: string; data?: unknown; };
    if (!res.ok || (body.code !== undefined && body.code !== 0)) throw new Error(body.message || `HTTP ${res.status}`,);
    return body.data ?? {};
}

// ── Collector ────────────────────────────────────────────────────────────

function hasBusiness(creds: Record<string, unknown>,): boolean {
    return Boolean(creds.businessAccessToken && creds.businessId,);
}

function status(credentials: Record<string, unknown>, connected: boolean,): SocialCollectorStatus {
    const base = { platform: 'tiktok' as const, label: 'TikTok', };
    if (!connected || !credentials.accessToken) {
        return { ...base, state: 'off', message: 'Connect TikTok in Social → Configuration.', collects: [], };
    }
    const scopes = grantedScopes(credentials,);
    const collects: string[] = [];
    const missing: string[] = [];
    for (const [scope, what,] of [['user.info.stats', 'Followers, following, likes, video count',], ['video.list', 'Per-video views, likes, comments, shares',],] as const) {
        if (!scopes || scopes.includes(scope,)) collects.push(what,);
        else missing.push(scope,);
    }
    if (missing.length) {
        return { ...base, state: 'partial', message: `Reconnect TikTok and allow the ${missing.join(' + ',)} scope(s).`, collects, };
    }
    if (tokenExpired(credentials,) && (!credentials.refreshToken || !appCredentials(credentials,))) {
        return { ...base, state: 'partial', message: 'The TikTok token has expired and cannot be renewed (no refresh token or client key/secret) — reconnect TikTok.', collects, };
    }
    if (credentials.oauthError) {
        return { ...base, state: 'partial', message: `TikTok sign-in needs renewing: ${String(credentials.oauthError,)}`, collects, };
    }
    if (!hasBusiness(credentials,)) {
        return {
            ...base,
            state: 'partial',
            message: 'Watch time, completion rate, reach and profile views need a TikTok Business Account + Business API token (businessAccessToken, businessId).',
            collects,
        };
    }
    return {
        ...base,
        state: 'ready',
        message: null,
        collects: [...collects, 'Per-video watch time, avg watch time, full-watch rate, reach (Business API)', 'Daily profile views, video views, net followers (Business API)',],
    };
}

async function listVideos(token: string,): Promise<TikTokVideo[]> {
    const videos: TikTokVideo[] = [];
    let cursor: number | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
        const data = await displayCall(token, `/video/list/?fields=${VIDEO_FIELDS}`, {
            method: 'POST',
            body: JSON.stringify(cursor ? { max_count: PAGE_SIZE, cursor, } : { max_count: PAGE_SIZE, },),
        },);
        videos.push(...((data.videos ?? []) as TikTokVideo[]),);
        if (!data.has_more || !data.cursor) break;
        cursor = Number(data.cursor,);
    }
    return videos;
}

async function businessVideos(creds: Record<string, unknown>,): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
        const params: Record<string, string> = {
            business_id: String(creds.businessId,),
            fields: JSON.stringify(BUSINESS_VIDEO_FIELDS,),
            max_count: String(PAGE_SIZE,),
        };
        if (cursor) params.cursor = cursor;
        const data = await businessCall(String(creds.businessAccessToken,), '/business/video/list/', params,);
        out.push(...((data.videos ?? []) as Array<Record<string, unknown>>),);
        if (!data.has_more || data.cursor === undefined || data.cursor === null) break;
        cursor = String(data.cursor,);
    }
    return out;
}

async function businessDaily(creds: Record<string, unknown>, today: string,): Promise<DailyPoint[]> {
    const data = await businessCall(String(creds.businessAccessToken,), '/business/get/', {
        business_id: String(creds.businessId,),
        start_date: addDays(today, -DAILY_WINDOW,),
        end_date: addDays(today, -1,),
        fields: JSON.stringify(BUSINESS_DAILY_FIELDS,),
    },);
    return tiktokBusinessDaily((data.metrics ?? []) as Array<Record<string, unknown>>,);
}

async function collect(ctx: CollectContext,): Promise<CollectResult> {
    const creds = { ...ctx.credentials, };
    let token = String(creds.accessToken ?? '',);
    if (!token) throw new Error('TikTok is not connected (no access token).',);
    if (tokenExpired(creds,)) token = await refreshTikTokToken(creds,);

    // One retry after a refresh when TikTok says the token is dead.
    const withToken = async <T,>(fn: (t: string,) => Promise<T>,): Promise<T> => {
        try {
            return await fn(token,);
        } catch (e) {
            if (!isAuthError(e,) || !creds.refreshToken) throw e;
            token = await refreshTikTokToken(creds,);
            return fn(token,);
        }
    };

    const result: CollectResult = { daily: [], posts: [], };
    let authorName: string | null = null;
    try {
        const data = await withToken((t,) => displayCall(t, `/user/info/?fields=${USER_FIELDS}`,));
        const user = (data.user ?? {}) as TikTokUser;
        result.account = tiktokAccount(user,);
        authorName = user.display_name || user.username || null;
    } catch (e) {
        if (isAuthError(e,)) throw e;
        ctx.warn(`TikTok profile stats: ${(e as Error).message} (needs the user.info.stats scope).`,);
    }

    const posts = new Map<string, PostMetric>();
    try {
        const videos = await withToken(listVideos,);
        await upsertTikTokVideos(videos, authorName,);
        for (const v of videos) posts.set(v.id, tiktokPostMetric(v,),);
    } catch (e) {
        if (isAuthError(e,)) throw e;
        ctx.warn(`TikTok video list: ${(e as Error).message} (needs the video.list scope).`,);
    }

    if (hasBusiness(creds,)) {
        try {
            for (const row of await businessVideos(creds,)) {
                const extra = tiktokBusinessMetric(row,);
                if (!extra) continue;
                const p = posts.get(extra.externalId,) ?? { externalId: extra.externalId, };
                posts.set(extra.externalId, { ...p, ...Object.fromEntries(Object.entries(extra,).filter(([, v,]) => v !== null),), },);
            }
        } catch (e) {
            ctx.warn(`TikTok Business API (videos): ${(e as Error).message}`,);
        }
        try {
            result.daily!.push(...await businessDaily(creds, ctx.today,),);
        } catch (e) {
            ctx.warn(`TikTok Business API (daily): ${(e as Error).message}`,);
        }
    }
    // Without a Business token the status message says what is missing; not a run warning.

    result.posts = [...posts.values(),];
    return result;
}

registerCollector({ platform: 'tiktok', label: 'TikTok', connection: 'tiktok', status, collect, },);
