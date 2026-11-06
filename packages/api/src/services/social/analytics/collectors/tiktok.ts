/**
 * TikTok analytics collector — two TIERS on one 'tiktok' connection:
 *
 *  BASIC — Login Kit token (Display API v2, open.tiktokapis.com; scopes
 *    user.info.basic, user.info.profile, user.info.stats, video.list):
 *    followers / following / likes / video count, and every video's views,
 *    likes, comments, shares. Listed videos are upserted into social_posts
 *    (tiktokMedia.ts; covers mirrored once).
 *
 *  UPGRADED — TikTok API for Business "Accounts" token (business-api.tiktok.com
 *    v1.3; credentials businessAccessToken + businessId = the token's open_id):
 *    /business/get/ — daily views, reach, profile views, likes, comments,
 *    shares, follower total, new / lost / net followers, engaged audience,
 *    profile-button clicks, hourly follower activity, follower age / gender /
 *    country / city; /business/video/list/ — per video reach, saves, watch
 *    time, average watch, full-watch rate, new followers, profile views,
 *    retention + like curves, traffic sources, viewer types, viewer countries /
 *    genders / cities. Most numbers lag 24–48 h, so the daily window is
 *    rewritten each run. Many need a Business Account or "Advanced Access"
 *    and 100+ followers — TikTok returns nothing otherwise.
 *
 * Every family runs on its own (attempt): a refused one is recorded in
 * credentials.analyticsCapabilities and the others still collect. A dead
 * Business token never fails the basic tier (and vice versa when both exist).
 *
 * Tokens: Login Kit access 24 h (older docs: 2 h), refresh 365 days and
 * ROTATED on each refresh; Business access 1 day, refresh 1 year. Both are
 * renewed here when due and saved back before anything else happens.
 * Mapping (pure) lives in tiktokMapping.ts; field lists + doc URLs there too.
 */
import type { SocialCollectorStatus, } from '@sitesurge/types';
import { config, } from '../../../../config';
import { query, } from '../../../../db';
import { logger, } from '../../../../utils/logger';
import {
    businessAppCredentials,
    businessTokenCredentials,
    displayTokenCredentials,
    requestBusinessToken,
    requestDisplayToken,
    TIKTOK_BUSINESS_API,
    TIKTOK_DISPLAY_API,
} from '../../../oauth/tiktok';
import { registerCollector, } from '../registry';
import type { AccountSnapshot, CollectContext, CollectResult, DailyPoint, PostMetric, } from '../types';
import {
    activityPoints,
    BUSINESS_ACCOUNT_TYPE_FIELDS,
    BUSINESS_ACTION_FIELDS,
    BUSINESS_ACTIVITY_FIELDS,
    BUSINESS_ADVANCED_DAILY_FIELDS,
    BUSINESS_DAILY_FIELDS,
    BUSINESS_DEMOGRAPHIC_FIELDS,
    BUSINESS_PROFILE_FIELDS,
    BUSINESS_VIDEO_BASE_FIELDS,
    BUSINESS_VIDEO_INSIGHT_FIELDS,
    businessAccount,
    businessAsVideo,
    businessDailyPoints,
    businessPostMetric,
    type BusinessProfile,
    type BusinessVideo,
    capabilityNotes,
    followerDemographicPoints,
    grantedScopes,
    mergeMetric,
    type TikTokCapabilities,
    tiktokAccount,
    tiktokPostMetric,
    type TikTokUser,
    type TikTokVideo,
    viewWeightedPoints,
} from './tiktokMapping';
import { upsertTikTokVideos, } from './tiktokMedia';

// Re-exported for callers/tests that imported them from here before the split.
export { grantedScopes, tiktokAccount, tiktokPostMetric, tiktokPostRow, } from './tiktokMapping';
export { upsertTikTokVideos, } from './tiktokMedia';

const USER_STATS_FIELDS = 'open_id,display_name,avatar_url,follower_count,following_count,likes_count,video_count';
const USER_PROFILE_FIELDS = 'username,bio_description,profile_deep_link,is_verified';
const VIDEO_FIELDS = 'id,create_time,cover_image_url,share_url,embed_link,video_description,title,duration,like_count,comment_count,share_count,view_count';
/** Display: 20 per page × 25 = the 500 newest videos. Business: 20 × 15 = 300 (two calls per page). */
const MAX_PAGES = 25;
const BUSINESS_MAX_PAGES = 15;
const PAGE_SIZE = 20;
/** Days of daily account data re-read each run (TikTok lags 24–48 h; max look-back 60). */
const DAILY_WINDOW = 14;
/** Refresh this long before a token expires. */
const SKEW_MS = 5 * 60_000;

function addDays(day: string, k: number,): string {
    const d = new Date(`${day}T00:00:00Z`,);
    d.setUTCDate(d.getUTCDate() + k,);
    return d.toISOString().slice(0, 10,);
}

// ── Errors ───────────────────────────────────────────────────────────────

class TikTokError extends Error {
    constructor(message: string, public status: number, public code: string,) {
        super(message,);
    }
}

/** A token problem — the tier stops (refresh/reconnect needed). */
const isTokenError = (e: unknown,): boolean =>
    e instanceof TikTokError
    && (e.status === 401 || /access_token|token_invalid|token.*expired|^4010[0-5]$/i.test(e.code,) || /access.?token.*(invalid|expired)/i.test(e.message,));

/** A scope / permission / account-type refusal — this family only. */
const isRefusal = (e: unknown,): boolean =>
    e instanceof TikTokError && (e.status === 403 || /scope|permission|not.?authori[sz]ed|40001|40002/i.test(`${e.code} ${e.message}`,));

// ── HTTP ─────────────────────────────────────────────────────────────────

async function displayCall(token: string, path: string, init: RequestInit = {},): Promise<any> {
    const res = await fetch(`${TIKTOK_DISPLAY_API}${path}`, {
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

async function businessCall(token: string, path: string, params: Record<string, string>,): Promise<any> {
    const res = await fetch(`${TIKTOK_BUSINESS_API}${path}?${new URLSearchParams(params,)}`, { headers: { 'Access-Token': token, }, },);
    const body = await res.json().catch(() => ({})) as { code?: number; message?: string; data?: unknown; };
    if (!res.ok || (body.code !== undefined && body.code !== 0)) {
        throw new TikTokError(body.message || `HTTP ${res.status}`, res.status, String(body.code ?? '',),);
    }
    return body.data ?? {};
}

async function saveCreds(patch: Record<string, unknown>,): Promise<void> {
    await query(
        `UPDATE social_connections SET credentials = COALESCE(credentials, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE provider = 'tiktok'`,
        [JSON.stringify(patch,),],
    );
}

// ── Tokens ───────────────────────────────────────────────────────────────

function displayApp(creds: Record<string, unknown>,): { key: string; secret: string; } | null {
    const key = String(creds.clientKey || creds.appId || config.social.tiktok.clientKey || '',);
    const secret = String(creds.clientSecret || creds.appSecret || config.social.tiktok.clientSecret || '',);
    return key && secret ? { key, secret, } : null;
}

const expired = (at: unknown,): boolean => {
    const t = Date.parse(String(at ?? '',),);
    return Number.isFinite(t,) && t - SKEW_MS <= Date.now();
};

/** Exchange the Login Kit refresh token for a new pair and save both (rotated). */
export async function refreshTikTokToken(creds: Record<string, unknown>,): Promise<string> {
    const app = displayApp(creds,);
    const refresh = String(creds.refreshToken ?? '',);
    if (!app || !refresh) throw new Error('TikTok token expired and no refresh token + client key/secret are saved — reconnect TikTok.',);
    try {
        const t = await requestDisplayToken({ client_key: app.key, client_secret: app.secret, grant_type: 'refresh_token', refresh_token: refresh, },);
        const patch = displayTokenCredentials(t,);
        await saveCreds(patch,);
        Object.assign(creds, patch,);
        return t.accessToken;
    } catch (e) {
        await saveCreds({ oauthError: (e as Error).message, },).catch(() => {});
        throw new Error(`TikTok token refresh failed: ${(e as Error).message}`,);
    }
}

/** Renew the Business token (1 day) with its refresh token and save the new pair. */
export async function refreshTikTokBusinessToken(creds: Record<string, unknown>,): Promise<string> {
    const app = businessAppCredentials(creds,);
    const refresh = String(creds.businessRefreshToken ?? '',);
    if (!app || !refresh) throw new Error('the Business token expired and no refresh token + Business App ID/Secret are saved — click Authorize Business API again.',);
    try {
        const t = await requestBusinessToken('refresh_token', {
            client_id: app.appId, client_secret: app.appSecret, grant_type: 'refresh_token', refresh_token: refresh,
        },);
        const patch = businessTokenCredentials(t,);
        if (!t.openId) delete patch.businessId;
        await saveCreds(patch,);
        Object.assign(creds, patch,);
        return t.accessToken;
    } catch (e) {
        await saveCreds({ businessOauthError: (e as Error).message, },).catch(() => {});
        throw new Error(`TikTok Business token refresh failed: ${(e as Error).message}`,);
    }
}

// ── Status ───────────────────────────────────────────────────────────────

const hasDisplay = (c: Record<string, unknown>,): boolean => Boolean(c.accessToken,);
const hasBusiness = (c: Record<string, unknown>,): boolean => Boolean(c.businessAccessToken && c.businessId,);

function capabilitiesOf(credentials: Record<string, unknown>,): TikTokCapabilities | null {
    const c = credentials.analyticsCapabilities;
    return c && typeof c === 'object' ? c as TikTokCapabilities : null;
}

export const UPGRADE_HELP = 'For watch time, completion, reach, profile views, follower history, demographics, active hours and traffic sources: '
    + 'switch the account to a Business Account in the TikTok app (Profile → ☰ → Settings and privacy → Account → Switch to Business Account), '
    + 'create a TikTok API for Business app with the TikTok Accounts permission (business-api.tiktok.com → My Apps), '
    + 'then save its App ID / Secret on the TikTok card in Social → Configuration and click Authorize Business API.';

function status(credentials: Record<string, unknown>, connected: boolean,): SocialCollectorStatus {
    const base = { platform: 'tiktok' as const, label: 'TikTok', };
    if (!connected || (!hasDisplay(credentials,) && !hasBusiness(credentials,))) {
        return { ...base, state: 'off', message: 'Connect TikTok in Social → Configuration (Authorize with TikTok).', collects: [], };
    }
    const collects: string[] = [];
    const problems: string[] = [];

    if (hasDisplay(credentials,)) {
        const scopes = grantedScopes(credentials,);
        const missing: string[] = [];
        for (const [scope, what,] of [['user.info.stats', 'Followers, following, likes, video count',], ['video.list', 'Every video with views, likes, comments, shares',],] as const) {
            if (!scopes || scopes.includes(scope,)) collects.push(what,);
            else missing.push(scope,);
        }
        if (missing.length) problems.push(`Reconnect TikTok and allow ${missing.join(' + ',)}.`,);
        if (expired(credentials.tokenExpiresAt,) && (!credentials.refreshToken || !displayApp(credentials,))) {
            problems.push('The TikTok token has expired and cannot be renewed — click Authorize with TikTok again.',);
        } else if (expired(credentials.refreshTokenExpiresAt,)) {
            problems.push('The TikTok sign-in has lapsed (refresh token expired) — click Authorize with TikTok again.',);
        } else if (credentials.oauthError) {
            problems.push(`TikTok sign-in needs renewing: ${String(credentials.oauthError,)}`,);
        }
    }

    if (!hasBusiness(credentials,)) {
        return { ...base, state: 'partial', message: [...problems, UPGRADE_HELP,].join(' ',), collects, };
    }

    const caps = capabilitiesOf(credentials,);
    const on = (k: keyof TikTokCapabilities,) => caps ? Boolean(caps[k],) : true;
    if (!hasDisplay(credentials,)) collects.push('Followers, following, likes, video count (Business API)', 'Every video with views, likes, comments, shares',);
    if (on('accountInsights',)) collects.push('Daily views, profile views, likes, comments, shares, follower total',);
    if (on('newFollowers',)) collects.push('Daily new / lost / net followers, reach (unique viewers), engaged audience',);
    if (on('profileActions',)) collects.push('Profile button clicks (link in bio, email, phone, address, app, leads)',);
    if (on('demographics',)) collects.push('Follower age, gender, country, city',);
    if (on('onlineFollowers',)) collects.push('When followers are active (hourly)',);
    if (on('mediaInsights',)) {
        collects.push('Per-video reach, saves, watch time, average watch, full-watch rate, retention curve, new followers',);
        collects.push('Traffic sources, new vs returning viewers, viewer countries / genders / cities',);
    }

    if (expired(credentials.businessTokenExpiresAt,) && (!credentials.businessRefreshToken || !businessAppCredentials(credentials,))) {
        problems.push('The TikTok Business token has expired and cannot be renewed — click Authorize Business API again.',);
    } else if (expired(credentials.businessRefreshTokenExpiresAt,)) {
        problems.push('The TikTok Business sign-in has lapsed (refresh token expired) — click Authorize Business API again.',);
    } else if (credentials.businessOauthError) {
        problems.push(`TikTok Business API: ${String(credentials.businessOauthError,)}`,);
    }
    const notes = capabilityNotes(caps,);
    if (notes.length) {
        problems.push(`TikTok does not give this account: ${notes.join('; ',)}. Advanced numbers need a Business Account (or Advanced Access) and 100+ followers; `
            + 'per-video insights need the video.insights scope — re-authorize the Business API after adding it to the app.',);
    }
    if (problems.length) return { ...base, state: 'partial', message: problems.join(' ',), collects, };
    return { ...base, state: 'ready', message: null, collects, };
}

// ── Collection ───────────────────────────────────────────────────────────

/** Thrown inside a family when its tier's token is dead — handled per tier. */
class TierDown extends Error {}

/**
 * Run one family on its own: a token error stops that TIER (TierDown), a
 * refusal leaves the family empty quietly, anything else also warns.
 */
async function attempt<T,>(fn: () => Promise<T>, fallback: T, warn: (m: string,) => void, label: string,): Promise<{ ok: boolean; value: T; }> {
    try {
        return { ok: true, value: await fn(), };
    } catch (e) {
        if (e instanceof TierDown || isTokenError(e,)) throw e instanceof TierDown ? e : new TierDown((e as Error).message,);
        if (!isRefusal(e,)) warn(`${label}: ${(e as Error).message}`,);
        return { ok: false, value: fallback, };
    }
}

async function listDisplayVideos(token: string,): Promise<TikTokVideo[]> {
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

async function listBusinessVideos(token: string, businessId: string, fields: string[],): Promise<BusinessVideo[]> {
    const out: BusinessVideo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < BUSINESS_MAX_PAGES; page++) {
        const params: Record<string, string> = { business_id: businessId, fields: JSON.stringify(fields,), max_count: String(PAGE_SIZE,), };
        if (cursor) params.cursor = cursor;
        const data = await businessCall(token, '/business/video/list/', params,);
        out.push(...((data.videos ?? []) as BusinessVideo[]),);
        if (!data.has_more || data.cursor === undefined || data.cursor === null) break;
        cursor = String(data.cursor,);
    }
    return out;
}

interface DisplayOutcome {
    account: AccountSnapshot | null;
    authorName: string | null;
    videos: TikTokVideo[] | null;
    profileOk: boolean;
}

async function collectDisplay(creds: Record<string, unknown>, warn: (m: string,) => void,): Promise<DisplayOutcome> {
    let token = String(creds.accessToken,);
    if (expired(creds.tokenExpiresAt,)) token = await refreshTikTokToken(creds,);
    let refreshed = false;
    // One refresh-and-retry when TikTok says the token is dead mid-run.
    const call = async <T,>(fn: (t: string,) => Promise<T>,): Promise<T> => {
        try {
            return await fn(token,);
        } catch (e) {
            if (!isTokenError(e,) || refreshed || !creds.refreshToken) throw e;
            refreshed = true;
            token = await refreshTikTokToken(creds,);
            return fn(token,);
        }
    };
    const out: DisplayOutcome = { account: null, authorName: null, videos: null, profileOk: false, };
    const stats = await attempt(() => call((t,) => displayCall(t, `/user/info/?fields=${USER_STATS_FIELDS}`,)), null, warn, 'TikTok profile stats (user.info.stats)',);
    if (stats.ok) {
        const user = (stats.value?.user ?? {}) as TikTokUser;
        const extra = await attempt(() => call((t,) => displayCall(t, `/user/info/?fields=${USER_PROFILE_FIELDS}`,)), null, () => {}, '',);
        Object.assign(user, (extra.value?.user ?? {}) as TikTokUser,);
        out.account = tiktokAccount(user,);
        out.authorName = user.display_name || user.username || null;
        out.profileOk = true;
    }
    const list = await attempt(() => call(listDisplayVideos,), null as TikTokVideo[] | null, warn, 'TikTok video list (video.list)',);
    out.videos = list.value;
    return out;
}

interface BusinessOutcome {
    account: AccountSnapshot | null;
    authorName: string | null;
    daily: DailyPoint[];
    videos: BusinessVideo[] | null;
    posts: PostMetric[];
    caps: Omit<TikTokCapabilities, 'profile' | 'videoList' | 'checkedAt'>;
}

async function collectBusiness(creds: Record<string, unknown>, today: string, warn: (m: string,) => void,): Promise<BusinessOutcome> {
    let token = String(creds.businessAccessToken,);
    if (expired(creds.businessTokenExpiresAt,)) token = await refreshTikTokBusinessToken(creds,);
    const id = String(creds.businessId,);
    const get = (fields: string[], dated: boolean,) =>
        businessCall(token, '/business/get/', {
            business_id: id,
            fields: JSON.stringify(fields,),
            ...(dated ? { start_date: addDays(today, -DAILY_WINDOW,), end_date: addDays(today, -1,), } : {}),
        },) as Promise<BusinessProfile>;

    const out: BusinessOutcome = {
        account: null,
        authorName: null,
        daily: [],
        videos: null,
        posts: [],
        caps: {
            businessAccount: false, accountInsights: false, newFollowers: false, demographics: false, onlineFollowers: false,
            mediaInsights: false, profileActions: false, advancedAccess: null,
        },
    };

    const profile = await attempt(() => get(BUSINESS_PROFILE_FIELDS, false,), null as BusinessProfile | null, warn, 'TikTok Business profile',);
    if (profile.value) {
        out.account = businessAccount(profile.value,);
        out.authorName = String(profile.value.display_name || profile.value.username || '',) || null;
    }
    const type = await attempt(() => get(BUSINESS_ACCOUNT_TYPE_FIELDS, false,), null as BusinessProfile | null, warn, 'TikTok account type',);
    if (type.value) {
        const adv = type.value.has_advanced_access === true || type.value.is_business_account === true;
        out.caps.advancedAccess = typeof type.value.has_advanced_access === 'boolean' || typeof type.value.is_business_account === 'boolean' ? adv : null;
    }

    const daily = await attempt(() => get(BUSINESS_DAILY_FIELDS, true,), null as BusinessProfile | null, warn, 'TikTok daily insights',);
    const dailyPts = businessDailyPoints(daily.value?.metrics,);
    out.daily.push(...dailyPts,);
    out.caps.accountInsights = dailyPts.length > 0;

    const advanced = await attempt(() => get(BUSINESS_ADVANCED_DAILY_FIELDS, true,), null as BusinessProfile | null, warn, 'TikTok follower history',);
    const advPts = businessDailyPoints(advanced.value?.metrics,);
    out.daily.push(...advPts,);
    out.caps.newFollowers = advPts.some((p,) => p.metric === 'newFollowers' || p.metric === 'followersNet',);

    const actions = await attempt(() => get(BUSINESS_ACTION_FIELDS, true,), null as BusinessProfile | null, warn, 'TikTok profile clicks',);
    const actPts = businessDailyPoints(actions.value?.metrics,);
    out.daily.push(...actPts,);
    out.caps.profileActions = actPts.length > 0;

    const activity = await attempt(() => get(BUSINESS_ACTIVITY_FIELDS, true,), null as BusinessProfile | null, warn, 'TikTok follower activity',);
    const actvPts = activityPoints(activity.value?.metrics,);
    out.daily.push(...actvPts,);
    out.caps.onlineFollowers = actvPts.length > 0;

    const demo = await attempt(() => get(BUSINESS_DEMOGRAPHIC_FIELDS, false,), null as BusinessProfile | null, warn, 'TikTok follower demographics',);
    const demoPts = demo.value ? followerDemographicPoints(demo.value, today,) : [];
    out.daily.push(...demoPts,);
    out.caps.demographics = demoPts.length > 0;

    const base = await attempt(() => listBusinessVideos(token, id, BUSINESS_VIDEO_BASE_FIELDS,), null as BusinessVideo[] | null, warn, 'TikTok Business video list',);
    out.videos = base.value;
    const insight = await attempt(() => listBusinessVideos(token, id, BUSINESS_VIDEO_INSIGHT_FIELDS,), [] as BusinessVideo[], warn, 'TikTok video insights',);
    const merged = new Map<string, PostMetric>();
    for (const v of [...(base.value ?? []), ...insight.value,]) {
        const m = businessPostMetric(v,);
        if (m) merged.set(m.externalId, mergeMetric(merged.get(m.externalId,), m,),);
    }
    out.posts = [...merged.values(),];
    out.caps.mediaInsights = insight.ok && out.posts.some((p,) => p.watchTimeS != null || p.completionRate != null || p.avgWatchS != null,);

    out.caps.businessAccount = profile.ok || daily.ok || base.ok;
    return out;
}

async function saveCapabilities(caps: TikTokCapabilities,): Promise<void> {
    await saveCreds({ analyticsCapabilities: caps, },).catch((e,) => logger.warn('tiktok: could not save capabilities', { error: (e as Error).message, },),);
}

async function collect(ctx: CollectContext,): Promise<CollectResult> {
    const creds = { ...ctx.credentials, };
    const display = hasDisplay(creds,);
    const business = hasBusiness(creds,);
    if (!display && !business) throw new Error('TikTok is not connected (no access token).',);

    const result: CollectResult = { daily: [], posts: [], };
    const posts = new Map<string, PostMetric>();
    let authorName: string | null = null;
    let videos: TikTokVideo[] | null = null;
    let profileOk = false;
    let displayDown: string | null = null;

    if (display) {
        try {
            const d = await collectDisplay(creds, ctx.warn,);
            result.account = d.account;
            authorName = d.authorName;
            profileOk = d.profileOk;
            videos = d.videos;
            for (const v of d.videos ?? []) posts.set(v.id, tiktokPostMetric(v,),);
        } catch (e) {
            displayDown = (e as Error).message;
            await saveCreds({ oauthError: displayDown, },).catch(() => {});
            if (!business) throw new Error(`TikTok token rejected — click Authorize with TikTok again (${displayDown}).`,);
            ctx.warn(`TikTok Login Kit token: ${displayDown} (Business API still collected).`,);
        }
    }

    let caps: TikTokCapabilities = {
        profile: profileOk, videoList: videos !== null, businessAccount: false, accountInsights: false, newFollowers: false,
        demographics: false, onlineFollowers: false, mediaInsights: false, profileActions: false, advancedAccess: null,
        checkedAt: new Date().toISOString(),
    };

    if (business) {
        try {
            const b = await collectBusiness(creds, ctx.today, ctx.warn,);
            if (!result.account && b.account) result.account = b.account;
            else if (result.account && b.account?.raw) result.account.raw = { ...b.account.raw, ...(result.account.raw ?? {}), };
            authorName = authorName ?? b.authorName;
            result.daily!.push(...b.daily,);
            if (!videos && b.videos) videos = b.videos.map(businessAsVideo,).filter((v,): v is TikTokVideo => v !== null);
            for (const m of b.posts) posts.set(m.externalId, mergeMetric(posts.get(m.externalId,), m,),);
            caps = { ...caps, ...b.caps, profile: caps.profile || Boolean(b.account,), videoList: caps.videoList || b.videos !== null, };
            if (creds.businessOauthError) await saveCreds({ businessOauthError: null, },).catch(() => {});
        } catch (e) {
            const msg = (e as Error).message;
            await saveCreds({ businessOauthError: msg, },).catch(() => {});
            if (!display || displayDown) throw new Error(`TikTok Business token rejected — click Authorize Business API again (${msg}).`,);
            ctx.warn(`TikTok Business API token: ${msg} (basic stats still collected).`,);
        }
        await saveCapabilities(caps,);
    }

    if (videos?.length) await upsertTikTokVideos(videos, authorName,);
    result.posts = [...posts.values(),];
    // Lifetime per-video splits (viewer demographics, sources, viewer types) as a dated snapshot.
    result.daily!.push(...viewWeightedPoints(result.posts, ctx.today,),);
    return result;
}

registerCollector({ platform: 'tiktok', label: 'TikTok', connection: 'tiktok', status, collect, },);
