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

async function getJson(url: string, init: RequestInit = {},): Promise<any> {
    const res = await fetch(url, init,);
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

/** Reach report rows → daily impressions (+ CTR) per video and channel totals. */
export function reachPoints(rows: Array<Record<string, string>>,): DailyPoint[] {
    const points: DailyPoint[] = [];
    const totals = new Map<string, number>();
    for (const r of rows) {
        const raw = r.date ?? '';
        const date = /^\d{8}$/.test(raw,) ? `${raw.slice(0, 4,)}-${raw.slice(4, 6,)}-${raw.slice(6, 8,)}` : raw;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date,)) continue;
        const video = r.video_id;
        const imp = n(r.video_thumbnail_impressions,);
        const ctr = n(r.video_thumbnail_impressions_ctr,);
        if (!video || imp === null) continue;
        // Several rows per video/day (traffic source, country…) — sum them.
        const key = `${date}|${video}`;
        totals.set(key, (totals.get(key,) ?? 0) + imp,);
        if (ctr !== null) points.push({ date, metric: 'impressionsCtr', dimension: `video:${video}`, value: ctr, },);
    }
    const channel = new Map<string, number>();
    for (const [key, value,] of totals) {
        const [date, video,] = key.split('|',);
        points.push({ date, metric: 'impressions', dimension: `video:${video}`, value, },);
        channel.set(date, (channel.get(date,) ?? 0) + value,);
    }
    for (const [date, value,] of channel) points.push({ date, metric: 'impressions', value, },);
    // De-duplicate CTR (last one wins per video/day).
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
    const jobs = await getJson(`${REPORTING_API}/jobs`, init,);
    let job = ((jobs.jobs ?? []) as Array<{ id: string; reportTypeId: string; }>).find((j,) => j.reportTypeId === type);
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
    const list = await getJson(`${REPORTING_API}/jobs/${job!.id}/reports?createdAfter=${encodeURIComponent(after,)}`, init,);
    const points: DailyPoint[] = [];
    for (const rep of (list.reports ?? []) as Array<{ downloadUrl: string; }>) {
        const res = await fetch(rep.downloadUrl, init,);
        if (!res.ok) {
            ctx.warn(`A YouTube reach file could not be downloaded (HTTP ${res.status}).`,);
            continue;
        }
        points.push(...reachPoints(parseCsv(await res.text(),),),);
    }
    return points;
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
    for (const batch of chunk(ctx.posts.map((p,) => p.externalId), 50,)) {
        const v = await getJson(`${DATA_API}/videos?part=statistics&id=${batch.map(encodeURIComponent,).join(',',)}${q}`, init,);
        for (const item of (v.items ?? []) as Array<{ id: string; statistics?: Record<string, string>; }>) {
            const st = item.statistics ?? {};
            posts.set(item.id, { externalId: item.id, views: n(st.viewCount,), likes: n(st.likeCount,), comments: n(st.commentCount,), },);
        }
    }

    // 2 + 3. Analytics + Reporting — owner sign-in with the analytics scope only.
    if (auth.mode === 'oauth') {
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
