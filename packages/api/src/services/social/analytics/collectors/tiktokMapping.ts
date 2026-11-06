/**
 * TikTok analytics — PURE mapping from Display API + Business (Accounts) API
 * answers to our points and post metrics (no I/O; unit-tested with fixtures).
 *
 * Sources:
 *   Display API   https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info ,
 *                 https://developers.tiktok.com/doc/tiktok-api-v2-video-list (fields as used since the
 *                 first collector; not re-checked 2026-11-06)
 *   Business API field names + shapes verified 2026-11-06 against:
 *   /business/get/          https://business-api.tiktok.com/portal/docs/get-profile-data-of-a-tiktok-account/v1.3
 *   /business/video/list/   https://business-api.tiktok.com/portal/docs/get-post-data-of-a-tiktok-account/v1.3
 *
 * Dimension conventions (same as instagramMapping.ts, read by audience.ts):
 *   ''               account total
 *   age:<band> · gender:<F|M|U> · country:<ISO2> · city:<name>
 *                    audienceFollowers (follower demographics, /business/get/; value = percent)
 *                    audienceReached   (viewers of the listed videos, view-weighted; value = est. views)
 *   hour:<0-23>      onlineFollowers (audience_activity, UTC hours, per date)
 *   source:<name>    trafficSources (where viewers found the videos, view-weighted; value = est. views)
 *   viewer:<TYPE>    viewerTypes (NEW_VIEWER / RETURN_VIEWER / FOLLOWER_PERCENT / NON_FOLLOWER_PERCENT)
 * The last three are SNAPSHOTS of lifetime per-video splits written on the
 * collection day — never sum them across days.
 */
import type { AccountSnapshot, DailyPoint, PostMetric, } from '../types';

// ─── Shapes ────────────────────────────────────────────────────────────────

/** Display API /video/list/ item. */
export interface TikTokVideo {
    id: string;
    create_time?: number;
    cover_image_url?: string;
    share_url?: string;
    embed_link?: string;
    video_description?: string;
    title?: string;
    duration?: number;
    like_count?: number;
    comment_count?: number;
    share_count?: number;
    view_count?: number;
}

/** Display API /user/info/ user. */
export interface TikTokUser {
    open_id?: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
    bio_description?: string;
    profile_deep_link?: string;
    is_verified?: boolean;
    follower_count?: number;
    following_count?: number;
    likes_count?: number;
    video_count?: number;
}

/** A /business/video/list/ item (any subset of the requested fields). */
export type BusinessVideo = Record<string, unknown> & { item_id?: string; };
/** /business/get/ data. */
export type BusinessProfile = Record<string, unknown> & { metrics?: Array<Record<string, unknown>>; };

/** What worked on the last run (credentials.analyticsCapabilities). */
export interface TikTokCapabilities {
    /** Display API user.info.stats (followers, likes, video count). */
    profile: boolean;
    /** Display API video.list (or the Business video list). */
    videoList: boolean;
    /** A Business (Accounts API) token answered at all. */
    businessAccount: boolean;
    /** Daily views / profile views / likes / comments / shares (user.insights). */
    accountInsights: boolean;
    /** Daily new / lost / net followers, reach, engaged audience (Advanced Access or Verified Business). */
    newFollowers: boolean;
    /** Follower age / gender / country / city (100+ followers). */
    demographics: boolean;
    /** Hourly follower activity (Advanced Access / Verified Business, 100+ followers). */
    onlineFollowers: boolean;
    /** Per-video reach, watch time, completion, sources, retention (video.insights). */
    mediaInsights: boolean;
    /** Profile button clicks (link in bio, email, phone…) — Verified Business Accounts only. */
    profileActions: boolean;
    /** has_advanced_access || is_business_account (null when user.account.type was not granted). */
    advancedAccess: boolean | null;
    checkedAt: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export const num = (v: unknown,): number | null => {
    if (v === undefined || v === null || v === '') return null;
    const x = Number(v,);
    return Number.isFinite(x,) ? x : null;
};

const isDate = (s: string,) => /^\d{4}-\d{2}-\d{2}$/.test(s,);

/** A rate/percentage → a fraction 0…1 (TikTok mixes 0.0237 and 17.49). */
export function fraction(v: unknown,): number | null {
    const x = num(v,);
    if (x === null) return null;
    return x > 1 ? x / 100 : x;
}

/** TikTok gender label → our F/M/U. */
export function genderKey(g: unknown,): string {
    const s = String(g ?? '',).toLowerCase();
    if (s.startsWith('f',)) return 'F';
    if (s.startsWith('m',)) return 'M';
    return 'U';
}

/** Distribution rows [{ <key>, percentage }] → [key, fraction] pairs (percent-scale lists detected as a whole). */
export function distribution(rows: unknown, keyField: string,): Array<[string, number]> {
    if (!Array.isArray(rows,)) return [];
    const pairs = rows
        .map((r,) => r as Record<string, unknown>)
        .map((r,) => [String(r[keyField] ?? '',).trim(), num(r.percentage,),] as const)
        .filter((p,): p is readonly [string, number] => Boolean(p[0],) && p[1] !== null);
    const percentScale = pairs.some(([, v,],) => v > 1,);
    return pairs.map(([k, v,],) => [k, percentScale ? v / 100 : v,]);
}

// ─── Display API (basic tier) ──────────────────────────────────────────────

export function tiktokAccount(u: TikTokUser,): AccountSnapshot {
    return {
        followers: num(u.follower_count,),
        following: num(u.following_count,),
        postsCount: num(u.video_count,),
        totalLikes: num(u.likes_count,),
        raw: { ...u, },
    };
}

export function tiktokPostMetric(v: TikTokVideo,): PostMetric {
    return {
        externalId: v.id,
        views: num(v.view_count,),
        likes: num(v.like_count,),
        comments: num(v.comment_count,),
        shares: num(v.share_count,),
        raw: { duration: num(v.duration,), },
    };
}

/** A listed video (either API) → the social_posts row it becomes. */
export interface TikTokPostRow {
    externalId: string;
    content: string | null;
    postUrl: string | null;
    thumbnailUrl: string | null;
    publishedAt: string | null;
    durationSeconds: number | null;
    /** null = the API did not send it (keep the stored value; never overwrite with 0). */
    likes: number | null;
    comments: number | null;
    shares: number | null;
}

export function tiktokPostRow(v: TikTokVideo,): TikTokPostRow {
    const text = (v.title || v.video_description || '').trim();
    const created = num(v.create_time,);
    return {
        externalId: v.id,
        content: text || null,
        postUrl: v.share_url || null,
        thumbnailUrl: v.cover_image_url || null,
        publishedAt: created ? new Date(created * 1000,).toISOString() : null,
        durationSeconds: num(v.duration,),
        likes: num(v.like_count,),
        comments: num(v.comment_count,),
        shares: num(v.share_count,),
    };
}

/** A Business video → the Display-shaped video, so one upsert serves both tiers. */
export function businessAsVideo(b: BusinessVideo,): TikTokVideo | null {
    const id = String(b.item_id ?? '',);
    if (!id) return null;
    const created = num(b.create_time,);
    return {
        id,
        // Business create_time is seconds (docs example 1628461703); tolerate ms.
        create_time: created === null ? undefined : created > 1e12 ? Math.round(created / 1000,) : created,
        cover_image_url: typeof b.thumbnail_url === 'string' ? b.thumbnail_url : undefined,
        share_url: typeof b.share_url === 'string' ? b.share_url : undefined,
        embed_link: typeof b.embed_url === 'string' ? b.embed_url : undefined,
        video_description: typeof b.caption === 'string' ? b.caption : undefined,
        duration: num(b.video_duration,) ?? undefined,
        like_count: num(b.likes,) ?? undefined,
        comment_count: num(b.comments,) ?? undefined,
        share_count: num(b.shares,) ?? undefined,
        view_count: num(b.video_views,) ?? undefined,
    };
}

export function grantedScopes(credentials: Record<string, unknown>, key = 'scope',): string[] | null {
    const s = String(credentials[key] ?? (key === 'scope' ? credentials.grantedScopes : '') ?? '',).trim();
    return s ? s.split(/[\s,]+/,).filter(Boolean,) : null;
}

// ─── Business API: /business/get/ ──────────────────────────────────────────

/** Field families requested as SEPARATE calls, so one refused field cannot sink the others. */
export const BUSINESS_PROFILE_FIELDS = ['display_name', 'username', 'profile_image', 'bio_description', 'profile_deep_link', 'is_verified', 'following_count', 'followers_count', 'total_likes', 'videos_count',];
export const BUSINESS_ACCOUNT_TYPE_FIELDS = ['is_business_account', 'has_advanced_access',];
/** Daily, any account with user.insights (TikTok Studio data). */
export const BUSINESS_DAILY_FIELDS = ['video_views', 'profile_views', 'likes', 'comments', 'shares', 'followers_count',];
/** Daily, Advanced Access / Verified Business only (Business Analytics data). */
export const BUSINESS_ADVANCED_DAILY_FIELDS = ['unique_video_views', 'daily_total_followers', 'daily_new_followers', 'daily_lost_followers', 'engaged_audience',];
/** Daily, Verified Business only. */
export const BUSINESS_ACTION_FIELDS = ['bio_link_clicks', 'email_clicks', 'phone_number_clicks', 'address_clicks', 'app_download_clicks', 'lead_submissions',];
export const BUSINESS_ACTIVITY_FIELDS = ['audience_activity',];
export const BUSINESS_DEMOGRAPHIC_FIELDS = ['audience_ages', 'audience_genders', 'audience_countries', 'audience_cities',];

/** /business/get/ daily field → our daily metric. */
export const BUSINESS_DAILY_METRICS: Record<string, string> = {
    video_views: 'views',
    unique_video_views: 'reach',
    profile_views: 'profileViews',
    likes: 'likes',
    comments: 'comments',
    shares: 'shares',
    // followers_count inside metrics[] = the follower TOTAL on that date (a level, not a sum).
    followers_count: 'followersTotal',
    daily_total_followers: 'followersNet',
    daily_new_followers: 'newFollowers',
    daily_lost_followers: 'lostFollowers',
    engaged_audience: 'accountsEngaged',
    bio_link_clicks: 'profileLinkTaps',
    email_clicks: 'emailClicks',
    phone_number_clicks: 'phoneClicks',
    address_clicks: 'addressClicks',
    app_download_clicks: 'appDownloadClicks',
    lead_submissions: 'leadSubmissions',
};

/** metrics[] rows → daily points (only the fields present; unknown fields ignored). */
export function businessDailyPoints(rows: unknown,): DailyPoint[] {
    if (!Array.isArray(rows,)) return [];
    const out: DailyPoint[] = [];
    for (const r of rows as Array<Record<string, unknown>>) {
        const date = String(r.date ?? '',).slice(0, 10,);
        if (!isDate(date,)) continue;
        for (const [field, metric,] of Object.entries(BUSINESS_DAILY_METRICS,)) {
            const v = num(r[field],);
            if (v !== null) out.push({ date, metric, value: v, },);
        }
    }
    return out;
}

/** metrics[].audience_activity → onlineFollowers hour:<h> per date. */
export function activityPoints(rows: unknown,): DailyPoint[] {
    if (!Array.isArray(rows,)) return [];
    const out: DailyPoint[] = [];
    for (const r of rows as Array<Record<string, unknown>>) {
        const date = String(r.date ?? '',).slice(0, 10,);
        if (!isDate(date,) || !Array.isArray(r.audience_activity,)) continue;
        for (const a of r.audience_activity as Array<Record<string, unknown>>) {
            const h = num(a.hour,);
            const v = num(a.count,);
            if (h === null || v === null || h < 0 || h > 23) continue;
            out.push({ date, metric: 'onlineFollowers', value: v, dimension: `hour:${h}`, },);
        }
    }
    return out;
}

/** Follower demographics (top-level audience_* lists) → audienceFollowers points dated `date` (value = percent). */
export function followerDemographicPoints(data: BusinessProfile, date: string,): DailyPoint[] {
    const out: DailyPoint[] = [];
    const push = (prefix: string, pairs: Array<[string, number]>,) => {
        for (const [k, v,] of pairs) out.push({ date, metric: 'audienceFollowers', value: Math.round(v * 10000,) / 100, dimension: `${prefix}:${k}`, },);
    };
    push('age', distribution(data.audience_ages, 'age',),);
    push('gender', mergeGender(distribution(data.audience_genders, 'gender',),),);
    push('country', distribution(data.audience_countries, 'country',),);
    push('city', distribution(data.audience_cities, 'city_name',),);
    return out;
}

function mergeGender(pairs: Array<[string, number]>,): Array<[string, number]> {
    const m = new Map<string, number>();
    for (const [k, v,] of pairs) m.set(genderKey(k,), (m.get(genderKey(k,),) ?? 0) + v,);
    return [...m.entries(),];
}

/** The account snapshot from /business/get/ top-level fields (used when no Display token). */
export function businessAccount(data: BusinessProfile,): AccountSnapshot {
    return {
        followers: num(data.followers_count,),
        following: num(data.following_count,),
        postsCount: num(data.videos_count,),
        totalLikes: num(data.total_likes,),
        raw: Object.fromEntries(Object.entries(data,).filter(([k,],) => k !== 'metrics' && !k.startsWith('audience_',),),),
    };
}

// ─── Business API: /business/video/list/ ───────────────────────────────────

export const BUSINESS_VIDEO_BASE_FIELDS = ['item_id', 'create_time', 'thumbnail_url', 'share_url', 'embed_url', 'caption', 'video_duration', 'likes', 'comments', 'shares', 'favorites', 'video_views', 'reach', 'media_type', 'is_ad',];
export const BUSINESS_VIDEO_INSIGHT_FIELDS = [
    'item_id', 'total_time_watched', 'average_time_watched', 'full_video_watched_rate', 'new_followers', 'profile_views',
    'website_clicks', 'phone_number_clicks', 'lead_submissions', 'app_download_clicks', 'email_clicks', 'address_clicks',
    'video_view_retention', 'impression_sources', 'audience_genders', 'audience_countries', 'audience_cities', 'audience_types', 'engagement_likes',
];

const RAW_COUNTERS: Record<string, string> = {
    new_followers: 'newFollowers',
    profile_views: 'profileViews',
    website_clicks: 'websiteClicks',
    phone_number_clicks: 'phoneClicks',
    lead_submissions: 'leadSubmissions',
    app_download_clicks: 'appDownloadClicks',
    email_clicks: 'emailClicks',
    address_clicks: 'addressClicks',
};

/**
 * Timeline curves [{ second, percentage }] → [[second, fraction]] sorted by
 * second. The scale is detected for the WHOLE curve (any value > 1 → percent),
 * like distribution(): per point, a percent curve's tail (0.8 = 0.8 %) would
 * read as 80 %.
 */
export function timeline(rows: unknown,): Array<[number, number]> {
    if (!Array.isArray(rows,)) return [];
    const pairs = (rows as Array<Record<string, unknown>>)
        .map((r,) => [num(r.second,), num(r.percentage,),] as const)
        .filter((p,): p is readonly [number, number] => p[0] !== null && p[1] !== null);
    const percentScale = pairs.some(([, v,],) => v > 1,);
    return pairs
        .map(([s, p,],) => [s, percentScale ? p / 100 : p,] as [number, number])
        .sort((a, b,) => a[0] - b[0],);
}

/** One Business video (base and/or insight fields) → a post metric. Unknown fields are ignored. */
export function businessPostMetric(v: BusinessVideo,): PostMetric | null {
    const id = String(v.item_id ?? '',);
    if (!id) return null;
    const raw: Record<string, unknown> = {};
    for (const [field, key,] of Object.entries(RAW_COUNTERS,)) {
        const x = num(v[field],);
        if (x !== null) raw[key] = x;
    }
    const lists: Array<[string, unknown]> = [
        ['impressionSources', Object.fromEntries(distribution(v.impression_sources, 'impression_source',),),],
        ['audienceTypes', Object.fromEntries(distribution(v.audience_types, 'type',),),],
        ['audienceCountries', Object.fromEntries(distribution(v.audience_countries, 'country',),),],
        ['audienceGenders', Object.fromEntries(mergeGender(distribution(v.audience_genders, 'gender',),),),],
        ['audienceCities', Object.fromEntries(distribution(v.audience_cities, 'city_name',),),],
        ['retention', timeline(v.video_view_retention,),],
        ['engagementLikes', timeline(v.engagement_likes,),],
    ];
    for (const [k, val,] of lists) {
        if (Array.isArray(val,) ? val.length : Object.keys(val as object,).length) raw[k] = val;
    }
    if (typeof v.media_type === 'string') raw.mediaType = v.media_type;
    if (typeof v.is_ad === 'boolean') raw.isAd = v.is_ad;
    const duration = num(v.video_duration,);
    if (duration !== null) raw.duration = duration;
    const metric: PostMetric = {
        externalId: id,
        views: num(v.video_views,),
        likes: num(v.likes,),
        comments: num(v.comments,),
        shares: num(v.shares,),
        saves: num(v.favorites,),
        reach: num(v.reach,),
        watchTimeS: num(v.total_time_watched,),
        avgWatchS: num(v.average_time_watched,),
        completionRate: fraction(v.full_video_watched_rate,),
    };
    if (Object.keys(raw,).length) metric.raw = raw;
    return metric;
}

/** Merge metrics for one post: later non-null values win; raw objects merge. */
export function mergeMetric(a: PostMetric | undefined, b: PostMetric,): PostMetric {
    if (!a) return b;
    const out: PostMetric = { ...a, };
    for (const [k, v,] of Object.entries(b,)) {
        if (k === 'raw' || v === null || v === undefined) continue;
        (out as unknown as Record<string, unknown>)[k] = v;
    }
    if (a.raw || b.raw) out.raw = { ...(a.raw ?? {}), ...(b.raw ?? {}), };
    return out;
}

/**
 * Snapshot splits across the listed videos, weighted by each video's views:
 * reached-audience demographics, traffic sources and viewer types, dated `date`.
 */
export function viewWeightedPoints(metrics: PostMetric[], date: string,): DailyPoint[] {
    const acc = new Map<string, number>();
    const add = (metric: string, dim: string, v: number,) => {
        const key = `${metric}|${dim}`;
        acc.set(key, (acc.get(key,) ?? 0) + v,);
    };
    for (const m of metrics) {
        const views = m.views ?? 0;
        const raw = m.raw ?? {};
        if (!views) continue;
        const each = (obj: unknown, metric: string, prefix: string,) => {
            if (!obj || typeof obj !== 'object' || Array.isArray(obj,)) return;
            for (const [k, share,] of Object.entries(obj as Record<string, number>,)) {
                if (typeof share === 'number' && share > 0) add(metric, `${prefix}:${k}`, share * views,);
            }
        };
        each(raw.audienceCountries, 'audienceReached', 'country',);
        each(raw.audienceGenders, 'audienceReached', 'gender',);
        each(raw.audienceCities, 'audienceReached', 'city',);
        each(raw.impressionSources, 'trafficSources', 'source',);
        each(raw.audienceTypes, 'viewerTypes', 'viewer',);
    }
    return [...acc.entries(),].map(([key, v,],) => {
        const [metric, dimension,] = key.split('|',);
        return { date, metric, dimension, value: Math.round(v,), };
    },).filter((p,) => p.value > 0,);
}

// ─── Status text ───────────────────────────────────────────────────────────

/** What the last run could not get, for the status message. */
export function capabilityNotes(c: TikTokCapabilities | null | undefined,): string[] {
    if (!c || !c.businessAccount) return [];
    const notes: string[] = [];
    if (!c.accountInsights) notes.push('daily views, profile views and engagement');
    if (!c.newFollowers) notes.push('daily new/lost followers, reach and engaged audience (needs Advanced Access or a Business Account)');
    if (!c.demographics) notes.push('follower demographics (needs 100+ followers)');
    if (!c.onlineFollowers) notes.push('when followers are active (needs Advanced Access / Business Account and 100+ followers)');
    if (!c.mediaInsights) notes.push('per-video watch time, completion, reach and traffic sources (video.insights)');
    return notes;
}
