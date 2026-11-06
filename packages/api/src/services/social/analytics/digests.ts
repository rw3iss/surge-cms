/**
 * Social analytics DIGESTS — a periodic report built from our own analytics
 * tables, stored as a SNAPSHOT (`social_analytics_digests.data`) so it reads
 * the same in the browser or an email months later, and kept for the
 * configured retention.
 *
 * Schedule: the hourly `social-analytics-digest` cron asks `dueSlot()` whether
 * a digest is due in the configured time zone; each slot has a unique
 * `schedule_key`, so overlapping runs or processes produce ONE digest.
 * Delivery: the digest email (settings recipients + / or the "Social analytics
 * digest" notification type's email recipients) and the notification's other
 * channels (in-app, desktop, SMS) with a link to the browser view.
 */
import type {
    DigestAiInsights,
    DigestData,
    DigestFrequency,
    DigestMetric,
    DigestPlatform,
    DigestSection,
    SocialAccountSummary,
    SocialAnalyticsDigest,
    SocialAnalyticsDigestSummary,
    SocialAnalyticsSettings,
    SocialSeriesPoint,
} from '@sitesurge/types';
import { query, } from '../../../db';
import { NotFoundError, } from '../../../core/errors';
import { logger, } from '../../../utils/logger';
import * as ai from '../../ai';
import { overview, posts, resolveRange, series, } from './read';
import { getSettings, } from './settings';
import { summaryTarget, } from './summary';

// ─── Dates (pure) ─────────────────────────────────────────────────────────────

const DAY = 86_400_000;

export function addDays(day: string, n: number,): string {
    return new Date(Date.parse(`${day}T00:00:00Z`,) + n * DAY,).toISOString().slice(0, 10,);
}

function daysBetween(from: string, to: string,): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`,) - Date.parse(`${from}T00:00:00Z`,)) / DAY,) + 1;
}

/** Wall-clock parts of `now` in `timeZone`. */
export function localParts(now: Date, timeZone: string,): { date: string; hour: number; weekday: number; day: number; } {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
    },).formatToParts(now,).map((p,) => [p.type, p.value,]),);
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',];
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        hour: Number(parts.hour,) % 24,
        weekday: weekdays.indexOf(parts.weekday,),
        day: Number(parts.day,),
    };
}

/** The period a digest due on `localDate` covers: up to yesterday (local), one day / week / month long. */
export function periodFor(frequency: DigestFrequency, localDate: string,): { from: string; to: string; } {
    const to = addDays(localDate, -1,);
    if (frequency === 'daily') return { from: to, to, };
    if (frequency === 'weekly') return { from: addDays(to, -6,), to, };
    // Monthly: from the same day last month (a calendar month long).
    const d = new Date(`${localDate}T00:00:00Z`,);
    d.setUTCMonth(d.getUTCMonth() - 1,);
    return { from: d.toISOString().slice(0, 10,), to, };
}

/** The same-length period right before `range`. */
export function previousPeriod(range: { from: string; to: string; },): { from: string; to: string; } {
    const len = daysBetween(range.from, range.to,);
    return { from: addDays(range.from, -len,), to: addDays(range.from, -1,), };
}

/**
 * Is a scheduled digest due at `now`? Due from the configured hour onwards on
 * the matching day (so a cron that missed the exact hour still catches up the
 * same day); the slot key makes it once per day.
 */
export function dueSlot(d: SocialAnalyticsSettings['digest'], now: Date,): { key: string; localDate: string; } | null {
    if (!d.enabled) return null;
    const p = localParts(now, d.timezone,);
    if (p.hour < d.hour) return null;
    if (d.frequency === 'weekly' && p.weekday !== d.weekday) return null;
    if (d.frequency === 'monthly' && p.day !== d.monthDay) return null;
    return { key: `${d.frequency}:${p.date}`, localDate: p.date, };
}

// ─── Snapshot (pure helpers) ──────────────────────────────────────────────────

export function metric(value: number | null | undefined, previous: number | null | undefined,): DigestMetric {
    const v = value ?? null;
    const p = previous ?? null;
    const change = v !== null && p !== null ? v - p : null;
    return { value: v, previous: p, change, changePct: change !== null && p ? change / Math.abs(p,) : null, };
}

/** Display order of a platform's metrics (stored JSONB does not keep key order). */
export const PLATFORM_METRICS: Array<keyof SocialAccountSummary> = [
    'followers', 'followerChange', 'views', 'engagedViews', 'watchTimeMinutes', 'avgViewDuration',
    'likes', 'comments', 'shares', 'posts', 'avgViewsPerPost', 'engagementRate',
];

function engagementRate(a: { likes: number | null; comments: number | null; shares: number | null; views: number | null; },): number | null {
    if (!a.views) return null;
    return ((a.likes ?? 0) + (a.comments ?? 0) + (a.shares ?? 0)) / a.views;
}

/** Totals across the included platforms. */
export function totalsOf(accounts: SocialAccountSummary[],): Record<string, number | null> {
    const sum = (k: keyof SocialAccountSummary,) => {
        const vals = accounts.map((a,) => a[k],).filter((v,): v is number => typeof v === 'number',);
        return vals.length ? vals.reduce((t, v,) => t + v, 0,) : null;
    };
    const t = {
        followers: sum('followers',), followerChange: sum('followerChange',), views: sum('views',), likes: sum('likes',),
        comments: sum('comments',), shares: sum('shares',), posts: sum('posts',), watchTimeMinutes: sum('watchTimeMinutes',),
    };
    return { ...t, engagementRate: engagementRate(t,), };
}

export function cleanInsights(raw: unknown,): DigestAiInsights | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const strs = (v: unknown, max = 8,) => (Array.isArray(v,) ? v : []).map((x,) => String(x ?? '',).trim(),).filter(Boolean,).slice(0, max,);
    const headline = String(o.headline ?? '',).trim();
    if (!headline) return null;
    return {
        headline: headline.slice(0, 300,),
        highlights: strs(o.highlights,),
        platforms: (Array.isArray(o.platforms,) ? o.platforms : []).map((p,) => ({
            platform: String((p as Record<string, unknown>)?.platform ?? '',).trim(),
            summary: String((p as Record<string, unknown>)?.summary ?? '',).trim(),
        }),).filter((p,) => p.platform && p.summary,).slice(0, 10,),
        topPosts: (Array.isArray(o.topPosts,) ? o.topPosts : []).map((p,) => ({
            id: String((p as Record<string, unknown>)?.id ?? '',).trim(),
            why: String((p as Record<string, unknown>)?.why ?? '',).trim(),
        }),).filter((p,) => p.id && p.why,).slice(0, 20,),
        suggestions: strs(o.suggestions, 6,),
    };
}

// ─── Build ────────────────────────────────────────────────────────────────────

const AI_SYSTEM = 'You are a social media analyst for a news/media organisation. Write in plain, short American English. '
    + 'Use ONLY the numbers given; never invent figures. Say so when a platform has little or no data.';

async function aiInsights(data: Omit<DigestData, 'ai'>, pool: string,): Promise<DigestData['ai']> {
    const target = await summaryTarget(pool,);
    if (!target.ok) return { status: 'failed', insights: null, error: target.error, provider: null, pool: null, };
    const digest = {
        period: { from: data.from, to: data.to, previous: { from: data.previousFrom, to: data.previousTo, }, },
        totals: data.totals,
        platforms: data.platforms.map((p,) => ({ platform: p.label, since: p.since, metrics: p.metrics, status: p.statusMessage, })),
        topPosts: data.topPosts.map((p,) => ({
            id: p.id, platform: p.platform, kind: p.kind, title: p.title, published: p.publishedAt?.slice(0, 10,),
            viewsInPeriod: p.viewsInPeriod, views: p.views, viewsDay7: p.viewsDay7, likes: p.likes, comments: p.comments,
            avgWatchSec: p.avgWatchS, engagementRate: p.engagementRate,
        })),
    };
    const prompt = [
        'Analyse this social media digest (each metric has value, previous period value and change). Return ONLY JSON:',
        'Note: we collect analytics daily from each platform\'s "since" date. A missing (null) previous value means there was no',
        'data before that date — mention it at most once and never suggest changing the digest itself. Suggestions are about content',
        'and channels; when a platform reports a status message (more access needed), you may suggest acting on it.',
        '{"headline": one sentence,',
        ' "highlights": 3-6 short bullets on what changed and why it matters,',
        ' "platforms": [{"platform": name, "summary": 1-2 sentences}] for platforms with data,',
        ' "topPosts": [{"id": the post id given, "why": one sentence on why it likely worked}] for up to 5 posts,',
        ' "suggestions": 2-4 concrete next steps}',
        '',
        'Data:',
        JSON.stringify(digest,),
    ].join('\n',);
    const r = await ai.ask(prompt, { system: AI_SYSTEM, kind: 'ANALYTICS DIGEST', format: 'json', timeoutSec: 600, ...target.opts, },);
    const insights = r.status === 'completed' ? cleanInsights(r.data,) : null;
    if (!insights) {
        return { status: 'failed', insights: null, error: r.error ?? 'The AI answer had no usable insights.', provider: r.provider, pool: r.pool, };
    }
    return { status: 'ok', insights, error: null, provider: r.provider, pool: r.pool ?? target.opts.pool ?? null, };
}

/** Build a digest snapshot for a period. */
export async function buildDigestData(range: { from: string; to: string; }, settings: SocialAnalyticsSettings,): Promise<DigestData> {
    const d = settings.digest;
    const sections: DigestSection[] = d.sections;
    const has = (s: DigestSection,) => sections.includes(s,);
    const prev = previousPeriod(range,);
    const [cur, before,] = await Promise.all([overview(range,), overview(prev,),],);
    const want = (platform: string,) => !d.platforms.length || d.platforms.includes(platform,);
    const accounts = cur.accounts.filter((a,) => want(a.platform,) && (a.since || a.lastRun),);
    const prevOf = (platform: string,) => before.accounts.find((a,) => a.platform === platform,);

    const platforms: DigestPlatform[] = [];
    for (const a of accounts) {
        const p = prevOf(a.platform,);
        const metrics: Record<string, DigestMetric> = {};
        for (const k of PLATFORM_METRICS) {
            // One engagement definition everywhere in a digest: (likes + comments + shares) ÷ views.
            const v = k === 'engagementRate' ? engagementRate(a,) : a[k] as number | null;
            const pv = k === 'engagementRate' ? (p ? engagementRate(p,) : null) : (p?.[k] ?? null) as number | null;
            if (v === null && pv === null) continue;
            metrics[k] = metric(v, pv,);
        }
        const seriesOut: Record<string, SocialSeriesPoint[]> = {};
        if (has('trends',)) {
            const keys = ['followers', 'views', ...(a.platform === 'youtube' ? ['watchTimeMinutes',] : []),];
            for (const k of keys) {
                const s = await series(a.platform, k, range,).catch(() => null);
                if (s?.points.length) seriesOut[k] = s.points;
            }
        }
        platforms.push({
            platform: a.platform, label: a.label, since: a.since, metrics, series: seriesOut,
            status: a.status.state, statusMessage: a.status.message,
        },);
    }

    const curTotals = totalsOf(accounts,);
    const prevTotals = totalsOf(before.accounts.filter((a,) => accounts.some((x,) => x.platform === a.platform),),);
    const totals: Record<string, DigestMetric> = {};
    for (const k of Object.keys(curTotals,)) totals[k] = metric(curTotals[k], prevTotals[k],);

    let topPosts: DigestData['topPosts'] = [];
    if (has('topPosts',) && d.topPosts > 0) {
        const r = await posts({ ...range, sort: 'viewsInPeriod', dir: 'desc', limit: Math.min(100, d.topPosts * 3,), },);
        topPosts = r.data.filter((p,) => want(p.platform,) && (p.viewsInPeriod ?? 0) > 0,).slice(0, d.topPosts,);
    }

    const base: Omit<DigestData, 'ai'> = {
        v: 1, from: range.from, to: range.to, previousFrom: prev.from, previousTo: prev.to, sections,
        totals, platforms, topPosts, definitionChanges: cur.definitionChanges,
    };
    const aiPart: DigestData['ai'] = has('ai',)
        ? await aiInsights(base, d.aiPool,).catch((e,) => ({ status: 'failed' as const, insights: null, error: (e as Error).message, provider: null, pool: null, }))
        : { status: 'skipped', insights: null, error: null, provider: null, pool: null, };
    return { ...base, ai: aiPart, };
}

// ─── Storage ──────────────────────────────────────────────────────────────────

interface DigestRow {
    id: string; frequency: string; trigger: string; period_from: Date | string; period_to: Date | string; status: string;
    headline: string | null; data?: DigestData | null; error: string | null; emailed_at: Date | null; email_count: number; created_at: Date;
}

const day = (v: Date | string,) => (v instanceof Date ? v.toISOString() : String(v,)).slice(0, 10,);

function mapSummary(r: DigestRow,): SocialAnalyticsDigestSummary {
    return {
        id: r.id,
        frequency: r.frequency as SocialAnalyticsDigestSummary['frequency'],
        from: day(r.period_from,),
        to: day(r.period_to,),
        status: r.status as SocialAnalyticsDigestSummary['status'],
        headline: r.headline,
        trigger: r.trigger as SocialAnalyticsDigestSummary['trigger'],
        createdAt: new Date(r.created_at,).toISOString(),
        emailedAt: r.emailed_at ? new Date(r.emailed_at,).toISOString() : null,
        emailCount: Number(r.email_count ?? 0,),
        error: r.error,
    };
}

export async function listDigests(page = 1, limit = 20,): Promise<{ data: SocialAnalyticsDigestSummary[]; total: number; page: number; limit: number; }> {
    const l = Math.min(100, Math.max(1, limit,),);
    const p = Math.max(1, page,);
    const [rows, count,] = await Promise.all([
        query<DigestRow>(
            `SELECT id, frequency, trigger, period_from, period_to, status, headline, error, emailed_at, email_count, created_at
               FROM social_analytics_digests ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
            [l, (p - 1) * l,],
        ),
        query<{ n: string; }>(`SELECT COUNT(*) AS n FROM social_analytics_digests`,),
    ],);
    return { data: rows.rows.map(mapSummary,), total: Number(count.rows[0]?.n ?? 0,), page: p, limit: l, };
}

export async function getDigest(id: string,): Promise<SocialAnalyticsDigest> {
    const r = await query<DigestRow>(`SELECT * FROM social_analytics_digests WHERE id = $1`, [id,],);
    if (!r.rows[0]) throw new NotFoundError('Digest',);
    return { ...mapSummary(r.rows[0],), data: r.rows[0].data ?? null, };
}

export async function deleteDigest(id: string,): Promise<{ deleted: true; }> {
    const r = await query(`DELETE FROM social_analytics_digests WHERE id = $1`, [id,],);
    if (!r.rowCount) throw new NotFoundError('Digest',);
    return { deleted: true, };
}

/** Drop digests older than the retention (null = keep forever). */
export async function sweepRetention(settings?: SocialAnalyticsSettings,): Promise<number> {
    const s = settings ?? await getSettings();
    if (s.retentionDays === null) return 0;
    const r = await query(
        `DELETE FROM social_analytics_digests WHERE created_at < NOW() - ($1 || ' days')::interval`,
        [String(s.retentionDays,),],
    );
    return r.rowCount ?? 0;
}

export interface GenerateOptions {
    from?: string;
    to?: string;
    frequency?: DigestFrequency | 'manual';
    trigger?: 'schedule' | 'manual';
    scheduleKey?: string;
    createdBy?: string | null;
    email?: boolean;
    /** false = return the 'generating' row at once and finish in the background. */
    wait?: boolean;
}

/**
 * Build + store a digest (and deliver it when asked). A scheduled slot that
 * already has a digest returns null (another process got there first).
 */
export async function generateDigest(opts: GenerateOptions = {},): Promise<SocialAnalyticsDigest | null> {
    const settings = await getSettings();
    let range: { from: string; to: string; };
    if (opts.from || opts.to) range = resolveRange(opts.from, opts.to,);
    else {
        const today = localParts(new Date(), settings.digest.timezone,).date;
        range = periodFor(settings.digest.frequency, today,);
    }
    const frequency = opts.frequency ?? (opts.from || opts.to ? 'manual' : settings.digest.frequency);
    const ins = await query<{ id: string; }>(
        `INSERT INTO social_analytics_digests (frequency, trigger, schedule_key, period_from, period_to, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (schedule_key) WHERE schedule_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [frequency, opts.trigger ?? 'manual', opts.scheduleKey ?? null, range.from, range.to, opts.createdBy ?? null,],
    );
    const id = ins.rows[0]?.id;
    if (!id) return null;
    const work = completeDigest(id, range, settings, Boolean(opts.email,),);
    // wait:false (HTTP "Generate now") returns the row at once; the admin polls it —
    // the AI part can take longer than a proxied request may stay open.
    if (opts.wait === false) {
        work.catch(() => {},);
        return getDigest(id,);
    }
    await work;
    return getDigest(id,);
}

async function completeDigest(id: string, range: { from: string; to: string; }, settings: SocialAnalyticsSettings, email: boolean,): Promise<void> {
    try {
        const data = await buildDigestData(range, settings,);
        const headline = data.ai.insights?.headline ?? null;
        await query(
            `UPDATE social_analytics_digests SET status = 'ready', data = $2, headline = $3, updated_at = NOW() WHERE id = $1`,
            [id, JSON.stringify(data,), headline,],
        );
    } catch (e) {
        const msg = (e as Error).message || 'Digest failed';
        logger.warn('social-analytics digest failed', { id, error: msg, },);
        await query(`UPDATE social_analytics_digests SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`, [id, msg,],);
        return;
    }
    const digest = await getDigest(id,);
    // Delivery is best-effort: a mail failure never loses the stored digest.
    const { announceDigest, sendDigestEmail, } = await import('./digestDelivery.js');
    if (email) await sendDigestEmail(digest, settings,).catch((e,) => logger.warn('digest email failed', { id, error: (e as Error).message, },));
    await announceDigest(digest,).catch(() => {},);
}

/** Cron: generate the scheduled digest when due, then apply the retention. */
export const SOCIAL_ANALYTICS_DIGEST_CRON = {
    name: 'social-analytics-digest',
    schedule: '20 * * * *',
    description: 'Builds the scheduled social analytics digest when due (Social → Analytics → Settings) and drops digests past their retention.',
    handler: async (): Promise<void> => {
        const settings = await getSettings();
        const slot = dueSlot(settings.digest, new Date(),);
        if (slot) {
            const range = periodFor(settings.digest.frequency, slot.localDate,);
            await generateDigest({ ...range, frequency: settings.digest.frequency, trigger: 'schedule', scheduleKey: slot.key, email: settings.email.enabled, },);
        }
        await sweepRetention(settings,);
    },
};
