/**
 * YouTube analytics collector — three Google APIs (plan §3.1):
 *
 *  1. Data API v3 (API key OR the Google sign-in): channel subscribers /
 *     total views / video count, and each video's views, likes, comments.
 *     Works today in key mode.
 *  2. Analytics API v2 (sign-in + `yt-analytics.readonly`): the channel's
 *     daily views, engaged views, watch time, avg view duration, likes,
 *     comments, shares, subscribers gained/lost (last 7 days — YouTube revises
 *     ~3 days back, so each run rewrites them) and each video's LIFETIME watch
 *     time, avg view duration and % viewed.
 *  3. Reporting API v1 (same scope): the daily "reach" report — thumbnail
 *     impressions + click-through rate per video. A job is created once;
 *     YouTube then drops one file per day, kept 60 days, so we read the recent
 *     files on every run.
 *
 * The signer must be the channel OWNER; a manager gets 403s from 2 and 3.
 */
import type { SocialCollectorStatus, } from '@sitesurge/types';
import { YT_ANALYTICS_SCOPE, } from '../../../oauth/google';
import { authRequest, resolveYouTubeAuth, type YouTubeAuth, } from '../../youtubeAuth';
import { registerCollector, } from '../registry';
import type { CollectContext, CollectResult, DailyPoint, PostMetric, } from '../types';

const DATA_API = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports';
const REPORTING_API = 'https://youtubereporting.googleapis.com/v1';
/** YouTube's launch — "lifetime" start for per-video totals. */
const LIFETIME_START = '2005-02-14';
const DAILY_WINDOW = 7;
const REPORT_WINDOW_DAYS = 5;
/** Per-request timeout: a hung Google socket must not stall the whole run. */
const TIMEOUT_MS = 30_000;
/** Reporting API pages (jobs / reports lists). */
const MAX_LIST_PAGES = 10;

/** fetch with a timeout; network errors become a plain message (never the URL — it may carry the API key). */
async function timedFetch(url: string, init: RequestInit = {},): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS,), },);
    } catch (e) {
        const name = (e as Error)?.name;
        throw new Error(name === 'TimeoutError' || name === 'AbortError' ? `Google did not answer within ${TIMEOUT_MS / 1000} s.` : 'Google API unreachable (network error).',);
    }
}

async function getJson(url: string, init: RequestInit = {},): Promise<any> {
    const res = await timedFetch(url, init,);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = (data as { error?: { message?: string; }; })?.error?.message || `HTTP ${res.status}`;
        const err = new Error(msg,) as Error & { status?: number; };
        err.status = res.status;
        throw err;
    }
    return data;
}

function addDays(day: string, n: number,): string {
    const d = new Date(`${day}T00:00:00Z`,);
    d.setUTCDate(d.getUTCDate() + n,);
    return d.toISOString().slice(0, 10,);
}

function chunk<T,>(list: T[], size: number,): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size,),);
    return out;
}

const n = (v: unknown,): number | null => {
    const x = Number(v,);
    return v === undefined || v === null || v === '' || !Number.isFinite(x,) ? null : x;
};

export function hasAnalyticsScope(credentials: Record<string, unknown>,): boolean {
    return String(credentials.grantedScopes ?? '',).split(/\s+/,).includes(YT_ANALYTICS_SCOPE,);
}

/** Analytics API column name → our metric key. */
const DAILY_METRICS: Record<string, string> = {
    views: 'views',
    engagedViews: 'engagedViews',
    estimatedMinutesWatched: 'watchTimeMinutes',
    averageViewDuration: 'avgViewDuration',
    likes: 'likes',
    comments: 'comments',
    shares: 'shares',
    subscribersGained: 'subscribersGained',
    subscribersLost: 'subscribersLost',
};

interface AnalyticsReport {
    columnHeaders?: Array<{ name: string; }>;
    rows?: unknown[][];
}

async function analyticsQuery(auth: YouTubeAuth, params: Record<string, string>,): Promise<AnalyticsReport> {
    const q = new URLSearchParams({ ids: 'channel==MINE', ...params, },);
    return getJson(`${ANALYTICS_API}?${q}`, authRequest(auth,).init,);
}

/** Rows of a report as objects keyed by column name. */
export function reportRows(report: AnalyticsReport,): Array<Record<string, unknown>> {
    const cols = (report.columnHeaders ?? []).map((c,) => c.name);
    return (report.rows ?? []).map((row,) => Object.fromEntries(cols.map((c, i,) => [c, row[i],]),));
}

async function dailyChannel(auth: YouTubeAuth, today: string,): Promise<DailyPoint[]> {
    const base = { startDate: addDays(today, -DAILY_WINDOW,), endDate: addDays(today, -1,), dimensions: 'day', sort: 'day', };
    let metrics = Object.keys(DAILY_METRICS,);
    let report: AnalyticsReport;
    try {
        report = await analyticsQuery(auth, { ...base, metrics: metrics.join(',',), },);
    } catch (e) {
        // engagedViews is newer than the rest; drop it if this channel/API refuses it.
        if ((e as { status?: number; }).status !== 400) throw e;
        metrics = metrics.filter((m,) => m !== 'engagedViews');
        report = await analyticsQuery(auth, { ...base, metrics: metrics.join(',',), },);
    }
    const points: DailyPoint[] = [];
    for (const row of reportRows(report,)) {
        const date = String(row.day ?? '',);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date,)) continue;
        for (const [col, metric,] of Object.entries(DAILY_METRICS,)) {
            const v = n(row[col],);
            if (v !== null) points.push({ date, metric, value: v, },);
        }
    }
    return points;
}

/** Lifetime watch time / avg duration / % viewed per video. */
async function videoLifetime(auth: YouTubeAuth, today: string, ids: string[],): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>();
    for (const batch of chunk(ids, 50,)) {
        const report = await analyticsQuery(auth, {
            startDate: LIFETIME_START,
            endDate: today,
            dimensions: 'video',
            filters: `video==${batch.join(',',)}`,
            metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,shares',
            maxResults: String(batch.length,),
            // The video dimension is a "top videos" report: it needs a sort.
            sort: '-views',
        },);
        for (const row of reportRows(report,)) out.set(String(row.video,), row,);
    }
    return out;
}

/** Minimal CSV parser (the Reporting API emits plain RFC 4180 with a header row). */
export function parseCsv(text: string,): Array<Record<string, string>> {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') {
                cell += '"';
                i++;
            } else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') {
            row.push(cell,);
            cell = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell,);
            rows.push(row,);
            row = [];
            cell = '';
        } else cell += ch;
    }
    if (cell || row.length) {
        row.push(cell,);
        rows.push(row,);
    }
    const [header, ...body] = rows.filter((r,) => r.some((c,) => c !== ''));
    if (!header) return [];
    return body.map((r,) => Object.fromEntries(header.map((h, i,) => [h.trim(), r[i] ?? '',]),));
}

/**
 * Reach report rows → daily impressions (+ CTR) per video and channel totals.
 * A video/day has several rows (traffic source, country…): impressions are
 * summed and the CTR is impression-weighted across them (Σ imp·ctr ÷ Σ imp) —
 * never one row's CTR.
 */
export function reachPoints(rows: Array<Record<string, string>>,): DailyPoint[] {
    const totals = new Map<string, number>();
    const ctrWeighted = new Map<string, { sum: number; imp: number; }>();
    for (const r of rows) {
        const raw = r.date ?? '';
        const date = /^\d{8}$/.test(raw,) ? `${raw.slice(0, 4,)}-${raw.slice(4, 6,)}-${raw.slice(6, 8,)}` : raw;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date,)) continue;
        const video = r.video_id;
        const imp = n(r.video_thumbnail_impressions,);
        const ctr = n(r.video_thumbnail_impressions_ctr,);
        if (!video || imp === null) continue;
        const key = `${date}|${video}`;
        totals.set(key, (totals.get(key,) ?? 0) + imp,);
        if (ctr !== null && imp > 0) {
            const w = ctrWeighted.get(key,) ?? { sum: 0, imp: 0, };
            w.sum += imp * ctr;
            w.imp += imp;
            ctrWeighted.set(key, w,);
        }
    }
    const points: DailyPoint[] = [];
    const channel = new Map<string, number>();
    for (const [key, value,] of totals) {
        const [date, video,] = key.split('|',);
        points.push({ date, metric: 'impressions', dimension: `video:${video}`, value, },);
        channel.set(date, (channel.get(date,) ?? 0) + value,);
        const w = ctrWeighted.get(key,);
        if (w && w.imp > 0) points.push({ date, metric: 'impressionsCtr', dimension: `video:${video}`, value: Math.round((w.sum / w.imp) * 1e6,) / 1e6, },);
    }
    for (const [date, value,] of channel) points.push({ date, metric: 'impressions', value, },);
    return points;
}

/** Points from several report files: one value per (date, metric, dimension) — a later file replaces an earlier one. */
export function latestPoints(points: DailyPoint[],): DailyPoint[] {
    const seen = new Map<string, DailyPoint>();
    for (const p of points) seen.set(`${p.date}|${p.metric}|${p.dimension ?? ''}`, p,);
    return [...seen.values(),];
}

async function reach(auth: YouTubeAuth, ctx: CollectContext,): Promise<DailyPoint[]> {
    const init = authRequest(auth,).init;
    const types = await getJson(`${REPORTING_API}/reportTypes`, init,);
    const type = ((types.reportTypes ?? []) as Array<{ id: string; }>)
        .map((t,) => t.id)
        .find((id,) => /reach/i.test(id,) && !/playlist/i.test(id,));
    if (!type) {
        ctx.warn('YouTube Reporting API offers no reach report for this channel yet.',);
        return [];
    }
    const jobs = await listAll<{ id: string; reportTypeId: string; }>(`${REPORTING_API}/jobs`, 'jobs', init,);
    let job = jobs.find((j,) => j.reportTypeId === type);
    if (!job) {
        job = await getJson(`${REPORTING_API}/jobs`, {
            ...init,
            method: 'POST',
            headers: { ...(init.headers as Record<string, string>), 'Content-Type': 'application/json', },
            body: JSON.stringify({ reportTypeId: type, name: 'sitesurge-reach', },),
        },);
        ctx.warn('Started the YouTube reach report — impressions appear within ~2 days.',);
        return [];
    }
    const after = new Date(Date.now() - REPORT_WINDOW_DAYS * 86400_000,).toISOString();
    const reports = await listAll<{ downloadUrl: string; createTime?: string; }>(
        `${REPORTING_API}/jobs/${encodeURIComponent(job!.id,)}/reports?createdAfter=${encodeURIComponent(after,)}`, 'reports', init,
    );
    // Oldest first, so a regenerated (newer) file for the same day replaces the older one.
    reports.sort((a, b,) => String(a.createTime ?? '',).localeCompare(String(b.createTime ?? '',),),);
    const points: DailyPoint[] = [];
    for (const rep of reports) {
        if (!rep.downloadUrl) continue;
        let res: Response;
        try {
            res = await timedFetch(rep.downloadUrl, init,);
        } catch (e) {
            ctx.warn(`A YouTube reach file could not be downloaded (${(e as Error).message}).`,);
            continue;
        }
        if (!res.ok) {
            ctx.warn(`A YouTube reach file could not be downloaded (HTTP ${res.status}).`,);
            continue;
        }
        points.push(...reachPoints(parseCsv(await res.text(),),),);
    }
    return latestPoints(points,);
}

/** Every item of a paged Reporting API list (nextPageToken), at most MAX_LIST_PAGES pages. */
async function listAll<T,>(url: string, key: string, init: RequestInit,): Promise<T[]> {
    const out: T[] = [];
    let token: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const sep = url.includes('?',) ? '&' : '?';
        const body = await getJson(token ? `${url}${sep}pageToken=${encodeURIComponent(token,)}` : url, init,);
        out.push(...((body[key] ?? []) as T[]),);
        const next = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : undefined;
        if (!next || next === token) break;
        token = next;
    }
    return out;
}

async function status(credentials: Record<string, unknown>, connected: boolean,): Promise<SocialCollectorStatus> {
    const base = { platform: 'youtube' as const, label: 'YouTube', };
    const channel = String(credentials.channelId ?? '',);
    if (!connected || (!credentials.apiKey && !credentials.refreshToken) || !channel) {
        return { ...base, state: 'off', message: 'Connect YouTube in Social → Configuration.', collects: [], };
    }
    const basic = ['Subscribers, total views, video count', 'Per-video views, likes, comments',];
    if (!credentials.refreshToken) {
        return {
            ...base,
            state: 'partial',
            message: 'Sign in with Google (Social → Configuration → YouTube) as the channel owner to add watch time, daily views and impressions.',
            collects: basic,
        };
    }
    if (credentials.oauthError) {
        return { ...base, state: 'partial', message: `Google sign-in needs renewing: ${String(credentials.oauthError,)}`, collects: basic, };
    }
    if (!hasAnalyticsScope(credentials,)) {
        return {
            ...base,
            state: 'partial',
            message: 'Sign in with Google again to allow YouTube Analytics (watch time, daily views, impressions).',
            collects: basic,
        };
    }
    return {
        ...base,
        state: 'ready',
        message: null,
        collects: [...basic, 'Daily views, engaged views, watch time, subscribers gained/lost', 'Per-video watch time, avg view duration, % viewed', 'Thumbnail impressions + CTR (Reporting API)',],
    };
}

async function collect(ctx: CollectContext,): Promise<CollectResult> {
    const auth = await resolveYouTubeAuth();
    if (!auth) throw new Error('YouTube is not connected (no API key or Google sign-in).',);
    const { query: q, init, } = authRequest(auth,);
    const result: CollectResult = { daily: [], posts: [], };
    if (auth.mode === 'key' && ctx.credentials.refreshToken) {
        const why = ctx.credentials.oauthError ? `: ${String(ctx.credentials.oauthError,)}` : '';
        ctx.warn(`Google sign-in could not be renewed${why} — only public counters were read with the API key. Sign in with Google again (Social → Configuration → YouTube).`,);
    }

    // 1. Data API — channel + per-video counters.
    const ch = await getJson(`${DATA_API}/channels?part=statistics&id=${encodeURIComponent(auth.channelId,)}${q}`, init,);
    const s = ch.items?.[0]?.statistics;
    if (s) {
        result.account = {
            followers: s.hiddenSubscriberCount ? null : n(s.subscriberCount,),
            totalViews: n(s.viewCount,),
            postsCount: n(s.videoCount,),
            raw: s,
        };
    } else ctx.warn('YouTube returned no channel statistics.',);

    const posts = new Map<string, PostMetric>();
    let videoErrors = 0;
    let videoError = '';
    for (const batch of chunk(ctx.posts.map((p,) => p.externalId), 50,)) {
        let v: any;
        try {
            v = await getJson(`${DATA_API}/videos?part=statistics&id=${batch.map(encodeURIComponent,).join(',',)}${q}`, init,);
        } catch (e) {
            videoErrors++;
            videoError = (e as Error).message;
            continue;
        }
        for (const item of (v.items ?? []) as Array<{ id: string; statistics?: Record<string, string>; }>) {
            const st = item.statistics ?? {};
            posts.set(item.id, { externalId: item.id, views: n(st.viewCount,), likes: n(st.likeCount,), comments: n(st.commentCount,), },);
        }
    }
    if (videoErrors) ctx.warn(`YouTube video counters: ${videoErrors} batch(es) failed — ${videoError}`,);

    // 2 + 3. Analytics + Reporting — owner sign-in with the analytics scope only.
    // A sign-in that recorded its scopes WITHOUT yt-analytics.readonly gets 403s — say so once instead.
    const scopes = String(ctx.credentials.grantedScopes ?? '',).trim();
    const scopeMissing = auth.mode === 'oauth' && scopes !== '' && !hasAnalyticsScope(ctx.credentials,);
    if (scopeMissing) {
        ctx.warn('YouTube Analytics skipped: the Google sign-in did not grant yt-analytics.readonly — sign in with Google again as the channel owner and allow it.',);
    }
    if (auth.mode === 'oauth' && !scopeMissing) {
        try {
            result.daily!.push(...await dailyChannel(auth, ctx.today,),);
        } catch (e) {
            ctx.warn(`YouTube Analytics (daily): ${(e as Error).message}`,);
        }
        try {
            const life = await videoLifetime(auth, ctx.today, [...posts.keys(),],);
            for (const [id, row,] of life) {
                const p = posts.get(id,) ?? { externalId: id, };
                const minutes = n(row.estimatedMinutesWatched,);
                const pct = n(row.averageViewPercentage,);
                posts.set(id, {
                    ...p,
                    watchTimeS: minutes === null ? null : minutes * 60,
                    avgWatchS: n(row.averageViewDuration,),
                    completionRate: pct === null ? null : pct / 100,
                    shares: n(row.shares,),
                    raw: { analyticsViews: n(row.views,), },
                },);
            }
        } catch (e) {
            ctx.warn(`YouTube Analytics (per video): ${(e as Error).message}`,);
        }
        try {
            result.daily!.push(...await reach(auth, ctx,),);
        } catch (e) {
            ctx.warn(`YouTube Reporting (impressions): ${(e as Error).message}`,);
        }
    }
    result.posts = [...posts.values(),];
    return result;
}

registerCollector({ platform: 'youtube', label: 'YouTube', connection: 'youtube', status, collect, },);
