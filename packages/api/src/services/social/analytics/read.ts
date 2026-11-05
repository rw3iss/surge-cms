/**
 * Read side of social analytics: everything the dashboard shows is derived
 * here, in SQL, from our own snapshot tables (never from a live platform call).
 */
import {
    SOCIAL_DEFINITION_CHANGES,
    type SocialAccountSummary,
    type SocialAnalyticsOverview,
    type SocialAnalyticsPostsQuery,
    type SocialAnalyticsPostSeriesResponse,
    type SocialPostAnalytics,
    type SocialSeries,
} from '@sitesurge/types';
import { query, } from '../../../db';
import { NotFoundError, } from '../../../middleware/error';
import { listCollectors, } from './registry';
import { lastRuns, loadConnection, utcDay, } from './runner';

export const DEFAULT_RANGE_DAYS = 28;

export function resolveRange(from?: string, to?: string,): { from: string; to: string; } {
    const end = to && /^\d{4}-\d{2}-\d{2}$/.test(to,) ? to : utcDay();
    let start = from && /^\d{4}-\d{2}-\d{2}$/.test(from,) ? from : '';
    if (!start) {
        const d = new Date(`${end}T00:00:00Z`,);
        d.setUTCDate(d.getUTCDate() - (DEFAULT_RANGE_DAYS - 1),);
        start = d.toISOString().slice(0, 10,);
    }
    return start <= end ? { from: start, to: end, } : { from: end, to: start, };
}

const num = (v: unknown,): number | null => (v === null || v === undefined ? null : Number(v,));

/** Sum of a daily metric (account total) per platform in the range. */
async function dailySums(from: string, to: string,): Promise<Map<string, Record<string, number>>> {
    const r = await query<{ platform: string; metric: string; total: string; weighted: string | null; }>(
        `SELECT platform, metric, SUM(value) AS total
           FROM social_account_daily
          WHERE dimension = '' AND date BETWEEN $1 AND $2
          GROUP BY platform, metric`,
        [from, to,],
    );
    const out = new Map<string, Record<string, number>>();
    for (const row of r.rows) {
        const m = out.get(row.platform,) ?? {};
        m[row.metric] = Number(row.total,);
        out.set(row.platform, m,);
    }
    // Average view duration: weight each day's average by its views.
    const w = await query<{ platform: string; avg: string | null; }>(
        `SELECT a.platform, SUM(a.value * v.value) / NULLIF(SUM(v.value), 0) AS avg
           FROM social_account_daily a
           JOIN social_account_daily v ON v.platform = a.platform AND v.date = a.date AND v.metric = 'views' AND v.dimension = ''
          WHERE a.metric = 'avgViewDuration' AND a.dimension = '' AND a.date BETWEEN $1 AND $2
          GROUP BY a.platform`,
        [from, to,],
    );
    for (const row of w.rows) {
        if (row.avg === null) continue;
        const m = out.get(row.platform,) ?? {};
        m.avgViewDuration = Number(row.avg,);
        out.set(row.platform, m,);
    }
    return out;
}

interface SnapshotEnds {
    since: string | null;
    followersEnd: number | null;
    followersStart: number | null;
    viewsEnd: number | null;
    viewsStart: number | null;
}

async function snapshotEnds(from: string, to: string,): Promise<Map<string, SnapshotEnds>> {
    const r = await query(
        `SELECT p.platform,
                (SELECT MIN(date) FROM social_account_snapshots s WHERE s.platform = p.platform) AS since,
                e.followers AS followers_end, b.followers AS followers_start,
                e.total_views AS views_end, b.total_views AS views_start
           FROM (SELECT DISTINCT platform FROM social_account_snapshots) p
           LEFT JOIN LATERAL (SELECT followers, total_views FROM social_account_snapshots s
                               WHERE s.platform = p.platform AND s.date <= $2 ORDER BY date DESC LIMIT 1) e ON true
           LEFT JOIN LATERAL (SELECT followers, total_views FROM social_account_snapshots s
                               WHERE s.platform = p.platform AND s.date >= $1 AND s.date <= $2 ORDER BY date ASC LIMIT 1) b ON true`,
        [from, to,],
    );
    return new Map(r.rows.map((row,) => [row.platform as string, {
        since: row.since ? new Date(row.since,).toISOString().slice(0, 10,) : null,
        followersEnd: num(row.followers_end,),
        followersStart: num(row.followers_start,),
        viewsEnd: num(row.views_end,),
        viewsStart: num(row.views_start,),
    },]),);
}

/** Per platform: engagement gained by posts inside the range, and published-in-range post stats. */
async function postAggregates(from: string, to: string,): Promise<Map<string, Record<string, number | null>>> {
    const r = await query(
        `WITH m AS (
            SELECT p.platform::text AS platform, p.published_at,
                   e.views AS v_end, e.likes AS l_end, e.comments AS c_end, e.shares AS s_end, e.saves AS sv_end,
                   COALESCE(b.views, CASE WHEN p.published_at >= $1::date THEN 0 END, f.views) AS v_start,
                   COALESCE(b.likes, CASE WHEN p.published_at >= $1::date THEN 0 END, f.likes) AS l_start,
                   COALESCE(b.comments, CASE WHEN p.published_at >= $1::date THEN 0 END, f.comments) AS c_start,
                   COALESCE(b.shares, CASE WHEN p.published_at >= $1::date THEN 0 END, f.shares) AS s_start
              FROM social_posts p
              JOIN LATERAL (SELECT * FROM social_post_metrics x WHERE x.social_post_id = p.id AND x.date <= $2 ORDER BY date DESC LIMIT 1) e ON true
              LEFT JOIN LATERAL (SELECT * FROM social_post_metrics x WHERE x.social_post_id = p.id AND x.date < $1 ORDER BY date DESC LIMIT 1) b ON true
              LEFT JOIN LATERAL (SELECT * FROM social_post_metrics x WHERE x.social_post_id = p.id AND x.date >= $1 ORDER BY date ASC LIMIT 1) f ON true
        )
        SELECT platform,
               SUM(GREATEST(v_end - v_start, 0)) FILTER (WHERE v_end IS NOT NULL AND v_start IS NOT NULL) AS views,
               SUM(GREATEST(l_end - l_start, 0)) FILTER (WHERE l_end IS NOT NULL AND l_start IS NOT NULL) AS likes,
               SUM(GREATEST(c_end - c_start, 0)) FILTER (WHERE c_end IS NOT NULL AND c_start IS NOT NULL) AS comments,
               SUM(GREATEST(s_end - s_start, 0)) FILTER (WHERE s_end IS NOT NULL AND s_start IS NOT NULL) AS shares,
               AVG(v_end) FILTER (WHERE published_at BETWEEN $1::date AND $2::date + 1) AS avg_views,
               SUM(COALESCE(l_end,0) + COALESCE(c_end,0) + COALESCE(s_end,0) + COALESCE(sv_end,0))
                   FILTER (WHERE published_at BETWEEN $1::date AND $2::date + 1) AS engagement,
               SUM(v_end) FILTER (WHERE published_at BETWEEN $1::date AND $2::date + 1) AS pub_views
          FROM m GROUP BY platform`,
        [from, to,],
    );
    const counts = await query<{ platform: string; n: string; }>(
        `SELECT platform::text AS platform, COUNT(*) AS n FROM social_posts
          WHERE published_at >= $1::date AND published_at < $2::date + 1 GROUP BY platform`,
        [from, to,],
    );
    const out = new Map<string, Record<string, number | null>>();
    for (const row of r.rows) {
        const pubViews = num(row.pub_views,);
        const engagement = num(row.engagement,);
        out.set(row.platform, {
            views: num(row.views,),
            likes: num(row.likes,),
            comments: num(row.comments,),
            shares: num(row.shares,),
            avgViewsPerPost: row.avg_views === null ? null : Math.round(Number(row.avg_views,),),
            engagementRate: pubViews && engagement !== null ? engagement / pubViews : null,
            posts: 0,
        },);
    }
    for (const row of counts.rows) {
        const m = out.get(row.platform,) ?? { views: null, likes: null, comments: null, shares: null, avgViewsPerPost: null, engagementRate: null, };
        m.posts = Number(row.n,);
        out.set(row.platform, m,);
    }
    return out;
}

export async function overview(range: { from?: string; to?: string; },): Promise<SocialAnalyticsOverview> {
    const { from, to, } = resolveRange(range.from, range.to,);
    const [daily, snaps, postAgg, runs,] = await Promise.all([dailySums(from, to,), snapshotEnds(from, to,), postAggregates(from, to,), lastRuns(),],);
    const accounts: SocialAccountSummary[] = [];
    for (const c of listCollectors()) {
        const conn = await loadConnection(c.connection,);
        const status = await Promise.resolve(c.status(conn?.credentials ?? {}, Boolean(conn?.is_connected && conn?.is_enabled,),),)
            .catch(() => ({ platform: c.platform, label: c.label, state: 'off' as const, message: 'Status unavailable', collects: [], }));
        const d = daily.get(c.platform,) ?? {};
        const s = snaps.get(c.platform,);
        const p = postAgg.get(c.platform,) ?? {};
        const run = runs.get(c.platform,) ?? null;
        if (status.state === 'off' && !s && !run) {
            accounts.push(emptySummary(c.platform, c.label, status,),);
            continue;
        }
        // Daily platform series first; else snapshot deltas; else what our posts gained.
        const snapViews = s && s.viewsEnd !== null && s.viewsStart !== null ? s.viewsEnd - s.viewsStart : null;
        const views = d.views ?? snapViews ?? p.views ?? null;
        accounts.push({
            platform: c.platform,
            label: c.label,
            status,
            lastRun: run,
            since: s?.since ?? null,
            followers: s?.followersEnd ?? null,
            followerChange: s && s.followersEnd !== null && s.followersStart !== null ? s.followersEnd - s.followersStart : null,
            views,
            engagedViews: d.engagedViews ?? null,
            watchTimeMinutes: d.watchTimeMinutes ?? null,
            avgViewDuration: d.avgViewDuration ?? null,
            likes: d.likes ?? p.likes ?? null,
            comments: d.comments ?? p.comments ?? null,
            shares: d.shares ?? p.shares ?? null,
            posts: Number(p.posts ?? 0,),
            avgViewsPerPost: p.avgViewsPerPost ?? null,
            engagementRate: p.engagementRate ?? null,
        },);
    }
    const sum = (k: keyof SocialAccountSummary,): number => accounts.reduce((t, a,) => t + (Number(a[k] ?? 0,) || 0), 0,);
    return {
        from,
        to,
        accounts,
        totals: {
            followers: sum('followers',),
            followerChange: sum('followerChange',),
            views: sum('views',),
            likes: sum('likes',),
            comments: sum('comments',),
            shares: sum('shares',),
            posts: sum('posts',),
        },
        definitionChanges: SOCIAL_DEFINITION_CHANGES.filter((c,) => c.date >= from && c.date <= to),
    };
}

function emptySummary(platform: SocialAccountSummary['platform'], label: string, status: SocialAccountSummary['status'],): SocialAccountSummary {
    return {
        platform, label, status, lastRun: null, since: null, followers: null, followerChange: null, views: null,
        engagedViews: null, watchTimeMinutes: null, avgViewDuration: null, likes: null, comments: null, shares: null,
        posts: 0, avgViewsPerPost: null, engagementRate: null,
    };
}

const SNAPSHOT_COLUMNS: Record<string, string> = {
    followers: 'followers',
    following: 'following',
    totalViews: 'total_views',
    totalLikes: 'total_likes',
    postsCount: 'posts_count',
};

export async function series(platform: string, metric: string, range: { from?: string; to?: string; },): Promise<SocialSeries> {
    const { from, to, } = resolveRange(range.from, range.to,);
    const col = SNAPSHOT_COLUMNS[metric];
    let rows: Array<{ date: Date; value: string | null; }>;
    if (col) {
        rows = (await query<{ date: Date; value: string | null; }>(
            `SELECT date, ${col} AS value FROM social_account_snapshots WHERE platform = $1 AND date BETWEEN $2 AND $3 AND ${col} IS NOT NULL ORDER BY date`,
            [platform, from, to,],
        )).rows;
    } else {
        rows = (await query<{ date: Date; value: string | null; }>(
            `SELECT date, value FROM social_account_daily WHERE platform = $1 AND metric = $2 AND dimension = '' AND date BETWEEN $3 AND $4 ORDER BY date`,
            [platform, metric, from, to,],
        )).rows;
        // No platform daily views: the day-to-day change of the snapshot total.
        if (!rows.length && metric === 'views') {
            rows = (await query<{ date: Date; value: string | null; }>(
                `SELECT date, total_views - LAG(total_views) OVER (ORDER BY date) AS value
                   FROM social_account_snapshots WHERE platform = $1 AND date BETWEEN $2::date - 1 AND $3 AND total_views IS NOT NULL
                  ORDER BY date`,
                [platform, from, to,],
            )).rows.filter((r,) => r.value !== null);
        }
    }
    return {
        platform,
        metric,
        points: rows.map((r,) => ({ date: new Date(r.date,).toISOString().slice(0, 10,), value: Number(r.value,), })),
    };
}

const SORTS: Record<NonNullable<SocialAnalyticsPostsQuery['sort']>, string> = {
    publishedAt: 'p.published_at',
    views: 'e.views',
    viewsInPeriod: 'views_in_period',
    likes: 'e.likes',
    comments: 'e.comments',
    shares: 'e.shares',
    watchTimeS: 'e.watch_time_s',
    engagementRate: 'engagement_rate',
    impressions: 'impressions',
};

function postUrl(platform: string, externalId: string, url: string | null,): string | null {
    if (url) return url;
    if (platform === 'youtube') return `https://www.youtube.com/watch?v=${externalId}`;
    return null;
}

function titleOf(content: string | null,): string {
    const first = String(content ?? '',).replace(/<[^>]+>/g, ' ',).split(/\n/,).map((s,) => s.trim()).find(Boolean,) ?? '';
    return first.length > 140 ? `${first.slice(0, 137,)}…` : first;
}

const POST_SELECT = `
    SELECT p.id, p.platform::text AS platform, p.external_id, p.content, p.post_url, p.thumbnail_url, p.media_kind, p.published_at,
           e.date AS as_of, e.views, e.likes, e.comments, e.shares, e.saves, e.watch_time_s, e.avg_watch_s,
           e.completion_rate, e.reach, e.clicks,
           COALESCE(imp.total, e.impressions) AS impressions,
           e.views - COALESCE(b.views, CASE WHEN p.published_at >= $1::date THEN 0 END, f.views) AS views_in_period,
           d7.views AS views_day7,
           (COALESCE(e.likes,0) + COALESCE(e.comments,0) + COALESCE(e.shares,0) + COALESCE(e.saves,0))::float / NULLIF(e.views, 0) AS engagement_rate
      FROM social_posts p
      JOIN LATERAL (SELECT * FROM social_post_metrics x WHERE x.social_post_id = p.id AND x.date <= $2 ORDER BY date DESC LIMIT 1) e ON true
      LEFT JOIN LATERAL (SELECT views FROM social_post_metrics x WHERE x.social_post_id = p.id AND x.date < $1 ORDER BY date DESC LIMIT 1) b ON true
      LEFT JOIN LATERAL (SELECT views FROM social_post_metrics x WHERE x.social_post_id = p.id AND x.date >= $1 ORDER BY date ASC LIMIT 1) f ON true
      LEFT JOIN LATERAL (SELECT views FROM social_post_metrics x WHERE x.social_post_id = p.id
                          AND x.date BETWEEN p.published_at::date + 6 AND p.published_at::date + 8
                          ORDER BY ABS(x.date - (p.published_at::date + 7)) LIMIT 1) d7 ON true
      LEFT JOIN LATERAL (SELECT SUM(value) AS total FROM social_account_daily a
                          WHERE a.platform = p.platform::text AND a.metric = 'impressions'
                            AND a.dimension = 'video:' || p.external_id AND a.date BETWEEN $1 AND $2) imp ON true`;

function mapPost(r: Record<string, any>,): SocialPostAnalytics {
    return {
        id: r.id,
        platform: r.platform,
        externalId: r.external_id,
        title: titleOf(r.content,),
        url: postUrl(r.platform, r.external_id, r.post_url,),
        thumbnailUrl: r.thumbnail_url ?? null,
        kind: r.media_kind ?? null,
        publishedAt: r.published_at ? new Date(r.published_at,).toISOString() : null,
        asOf: r.as_of ? new Date(r.as_of,).toISOString().slice(0, 10,) : null,
        views: num(r.views,),
        likes: num(r.likes,),
        comments: num(r.comments,),
        shares: num(r.shares,),
        saves: num(r.saves,),
        watchTimeS: num(r.watch_time_s,),
        avgWatchS: num(r.avg_watch_s,),
        completionRate: num(r.completion_rate,),
        reach: num(r.reach,),
        impressions: num(r.impressions,),
        clicks: num(r.clicks,),
        viewsInPeriod: num(r.views_in_period,),
        viewsDay7: num(r.views_day7,),
        engagementRate: num(r.engagement_rate,),
    };
}

export async function posts(q: SocialAnalyticsPostsQuery,): Promise<{ data: SocialPostAnalytics[]; total: number; page: number; limit: number; }> {
    const { from, to, } = resolveRange(q.from, q.to,);
    const page = Math.max(1, q.page ?? 1,);
    const limit = Math.min(100, Math.max(1, q.limit ?? 25,),);
    const params: unknown[] = [from, to,];
    const where: string[] = [];
    if (q.platform) {
        params.push(q.platform,);
        where.push(`p.platform::text = $${params.length}`,);
    }
    if (q.kind) {
        params.push(q.kind,);
        where.push(`p.media_kind = $${params.length}`,);
    }
    if (q.search) {
        params.push(`%${q.search}%`,);
        where.push(`p.content ILIKE $${params.length}`,);
    }
    if (q.publishedInPeriod) where.push(`p.published_at >= $1::date AND p.published_at < $2::date + 1`,);
    const filter = where.length ? `WHERE ${where.join(' AND ',)}` : '';
    const sort = SORTS[q.sort ?? 'publishedAt'] ?? SORTS.publishedAt;
    const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
    const base = `${POST_SELECT} ${filter}`;
    const total = await query<{ n: string; }>(`SELECT COUNT(*) AS n FROM (${base}) t`, params,);
    params.push(limit, (page - 1) * limit,);
    const r = await query(`${base} ORDER BY ${sort} ${dir} NULLS LAST, p.published_at DESC NULLS LAST LIMIT $${params.length - 1} OFFSET $${params.length}`, params,);
    return { data: r.rows.map(mapPost,), total: Number(total.rows[0]?.n ?? 0,), page, limit, };
}

export async function postSeries(id: string, range: { from?: string; to?: string; },): Promise<SocialAnalyticsPostSeriesResponse> {
    const { from, to, } = resolveRange(range.from, range.to,);
    const r = await query(`${POST_SELECT} WHERE p.id = $3`, [from, to, id,],);
    if (!r.rows[0]) throw new NotFoundError('Post analytics',);
    const pts = await query(
        `SELECT date, views, likes, comments, shares FROM social_post_metrics WHERE social_post_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
        [id, from, to,],
    );
    return {
        post: mapPost(r.rows[0],),
        points: pts.rows.map((p,) => ({
            date: new Date(p.date,).toISOString().slice(0, 10,),
            views: num(p.views,),
            likes: num(p.likes,),
            comments: num(p.comments,),
            shares: num(p.shares,),
        })),
    };
}

export async function collectorStatuses() {
    const out = [];
    for (const c of listCollectors()) {
        const conn = await loadConnection(c.connection,);
        out.push(await Promise.resolve(c.status(conn?.credentials ?? {}, Boolean(conn?.is_connected && conn?.is_enabled,),),),);
    }
    return out;
}
