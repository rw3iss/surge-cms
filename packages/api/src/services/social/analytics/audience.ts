/**
 * Audience + content breakdowns for one platform, read from our own tables
 * (dimensioned social_account_daily rows + post metrics). Instagram fills it
 * today; any collector writing the same metric/dimension names shows up here.
 * Conventions: see collectors/instagramMapping.ts.
 */
import type { AudienceBenchmark, AudienceBucket, AudienceDemographics, SocialAudience, } from '@sitesurge/types';
import { query, } from '../../../db';
import { resolveRange, } from './read';
import { loadConnection, } from './runner';

const day = (v: Date | string,) => (v instanceof Date ? v.toISOString() : String(v,)).slice(0, 10,);

/** Buckets with their share of the total, largest first (age bands in age order). */
export function toBuckets(rows: Array<{ key: string; value: number; }>, opts: { limit?: number; ageOrder?: boolean; } = {},): AudienceBucket[] {
    const total = rows.reduce((t, r,) => t + Math.max(0, r.value,), 0,);
    let out = rows.filter((r,) => r.value > 0,).map((r,) => ({ key: r.key, value: r.value, share: total ? r.value / total : 0, }));
    if (opts.ageOrder) out.sort((a, b,) => parseInt(a.key, 10,) - parseInt(b.key, 10,) || a.key.localeCompare(b.key,),);
    else out.sort((a, b,) => b.value - a.value,);
    if (opts.limit) out = out.slice(0, opts.limit,);
    return out;
}

/** Hashtags in a caption (#word, any language), lower-cased, unique per post. */
export function hashtagsOf(text: string | null,): string[] {
    return [...new Set((String(text ?? '',).match(/#[\p{L}\p{N}_]+/gu,) ?? []).map((t,) => t.toLowerCase(),),),];
}

const AUDIENCE_KEYS = { followers: 'audienceFollowers', engaged: 'audienceEngaged', reached: 'audienceReached', } as const;

async function demographics(platform: string, to: string,): Promise<{ asOf: string | null; result: SocialAudience['demographics']; }> {
    const r = await query<{ metric: string; dimension: string; value: string; date: Date; }>(
        `SELECT DISTINCT ON (metric, dimension) metric, dimension, value, date
           FROM social_account_daily
          WHERE platform = $1 AND metric = ANY($2::text[]) AND date <= $3
          ORDER BY metric, dimension, date DESC`,
        [platform, Object.values(AUDIENCE_KEYS,), to,],
    );
    // Only the newest snapshot of each metric (a bucket that vanished later must not linger).
    const latest = new Map<string, string>();
    for (const row of r.rows) {
        const d = day(row.date,);
        if (!latest.has(row.metric,) || d > latest.get(row.metric,)!) latest.set(row.metric, d,);
    }
    const build = (metric: string,): AudienceDemographics | null => {
        const rows = r.rows.filter((x,) => x.metric === metric && day(x.date,) === latest.get(metric,));
        if (!rows.length) return null;
        const of = (prefix: string,) => rows.filter((x,) => x.dimension.startsWith(`${prefix}:`,))
            .map((x,) => ({ key: x.dimension.slice(prefix.length + 1,), value: Number(x.value,), }));
        return {
            age: toBuckets(of('age',), { ageOrder: true, },),
            gender: toBuckets(of('gender',),),
            country: toBuckets(of('country',), { limit: 15, },),
            city: toBuckets(of('city',), { limit: 15, },),
        };
    };
    const asOf = [...latest.values(),].sort().pop() ?? null;
    return {
        asOf,
        result: { followers: build(AUDIENCE_KEYS.followers,), engaged: build(AUDIENCE_KEYS.engaged,), reached: build(AUDIENCE_KEYS.reached,), },
    };
}

async function splits(platform: string, from: string, to: string,): Promise<SocialAudience['breakdowns']> {
    const r = await query<{ metric: string; dimension: string; total: string; }>(
        `SELECT metric, dimension, SUM(value) AS total
           FROM social_account_daily
          WHERE platform = $1 AND metric IN ('views', 'reach', 'engagements', 'videoViews', 'reactions')
            AND (dimension LIKE 'type:%' OR dimension LIKE 'follow:%' OR dimension LIKE 'paid:%' OR dimension LIKE 'play:%' OR dimension LIKE 'reaction:%')
            AND date BETWEEN $2 AND $3
          GROUP BY metric, dimension`,
        [platform, from, to,],
    );
    const pick = (metric: string, prefix: string,) => toBuckets(r.rows
        .filter((x,) => x.metric === metric && x.dimension.startsWith(`${prefix}:`,))
        .map((x,) => ({ key: x.dimension.slice(prefix.length + 1,), value: Number(x.total,), })),);
    return {
        viewsByType: pick('views', 'type',),
        reachByType: pick('reach', 'type',),
        interactionsByType: pick('engagements', 'type',),
        viewsByFollow: pick('views', 'follow',),
        reachByFollow: pick('reach', 'follow',),
        // Facebook: page views split paid/organic (else the video views split), autoplay vs click, reactions by type.
        viewsByPaid: (() => { const v = pick('views', 'paid',); return v.length ? v : pick('videoViews', 'paid',); })(),
        videoViewsByPlay: pick('videoViews', 'play',),
        reactionsByType: r.rows.some((x,) => x.dimension.startsWith('reaction:',),)
            ? toBuckets(r.rows.filter((x,) => x.dimension.startsWith('reaction:',),).map((x,) => ({ key: x.dimension.slice(9,), value: Number(x.total,), })),)
            : [],
    };
}

/**
 * Splits written as a SNAPSHOT on each collection day (TikTok traffic sources
 * and viewer types: lifetime per-video splits) — read the newest day ≤ `to`,
 * never summed across days.
 */
async function snapshotSplits(platform: string, to: string,): Promise<{ trafficSources: AudienceBucket[]; viewerTypes: AudienceBucket[]; viewerFollow: AudienceBucket[]; }> {
    const r = await query<{ metric: string; dimension: string; value: string; }>(
        `SELECT d.metric, d.dimension, d.value
           FROM social_account_daily d
           JOIN (SELECT metric, MAX(date) AS date FROM social_account_daily
                  WHERE platform = $1 AND metric IN ('trafficSources', 'viewerTypes') AND date <= $2
                  GROUP BY metric) l ON l.metric = d.metric AND l.date = d.date
          WHERE d.platform = $1`,
        [platform, to,],
    );
    const rows = (metric: string, prefix: string,) => r.rows
        .filter((x,) => x.metric === metric && x.dimension.startsWith(`${prefix}:`,))
        .map((x,) => ({ key: x.dimension.slice(prefix.length + 1,), value: Number(x.value,), }));
    const viewer = rows('viewerTypes', 'viewer',);
    // viewer:* holds TWO splits (new vs returning, followers vs not) — each needs its own shares.
    const of = (keys: Record<string, string>,) => toBuckets(viewer.filter((v,) => keys[v.key.toUpperCase()],).map((v,) => ({ key: keys[v.key.toUpperCase()], value: v.value, })),);
    return {
        trafficSources: toBuckets(rows('trafficSources', 'source',), { limit: 12, },),
        viewerTypes: of({ NEW_VIEWER: 'NEW', RETURN_VIEWER: 'RETURNING', },),
        viewerFollow: of({ FOLLOWER_PERCENT: 'FOLLOWER', NON_FOLLOWER_PERCENT: 'NON_FOLLOWER', },),
    };
}

async function onlineHours(platform: string, from: string, to: string,): Promise<SocialAudience['onlineHours']> {
    const r = await query<{ dimension: string; avg: string; }>(
        `SELECT dimension, AVG(value) AS avg FROM social_account_daily
          WHERE platform = $1 AND metric = 'onlineFollowers' AND dimension LIKE 'hour:%' AND date BETWEEN $2::date - 30 AND $3
          GROUP BY dimension`,
        [platform, from, to,],
    );
    return r.rows.map((x,) => ({ hour: Number(x.dimension.slice(5,),), value: Math.round(Number(x.avg,) * 10,) / 10, }))
        .filter((x,) => Number.isInteger(x.hour,),).sort((a, b,) => a.hour - b.hour);
}

interface PostRow {
    media_kind: string | null; content: string | null; views: string | null; likes: string | null;
    comments: string | null; shares: string | null; saves: string | null; reach: string | null;
}

async function postsInPeriod(platform: string, from: string, to: string,): Promise<PostRow[]> {
    const r = await query<PostRow>(
        `SELECT p.media_kind, p.content, e.views, e.likes, e.comments, e.shares, e.saves, e.reach
           FROM social_posts p
           LEFT JOIN LATERAL (SELECT * FROM social_post_metrics x WHERE x.social_post_id = p.id AND x.date <= $3 ORDER BY date DESC LIMIT 1) e ON true
          WHERE p.platform::text = $1 AND p.published_at >= $2::date AND p.published_at < $3::date + 1`,
        [platform, from, to,],
    );
    return r.rows;
}

const n = (v: string | null,) => (v === null ? null : Number(v,));
const engagement = (rows: PostRow[],) => {
    const views = rows.reduce((t, r,) => t + (n(r.views,) ?? 0), 0,);
    if (!views) return null;
    const e = rows.reduce((t, r,) => t + (n(r.likes,) ?? 0) + (n(r.comments,) ?? 0) + (n(r.shares,) ?? 0) + (n(r.saves,) ?? 0), 0,);
    return e / views;
};

export function contentKinds(rows: PostRow[],): SocialAudience['contentKinds'] {
    const groups = new Map<string, PostRow[]>();
    for (const r of rows) {
        const k = r.media_kind ?? 'post';
        const list = groups.get(k,);
        if (list) list.push(r,);
        else groups.set(k, [r,],);
    }
    return [...groups.entries(),].map(([kind, list,],) => {
        const withViews = list.filter((r,) => r.views !== null);
        const views = withViews.length ? withViews.reduce((t, r,) => t + Number(r.views,), 0,) : null;
        return { kind, posts: list.length, views, avgViews: views === null ? null : Math.round(views / withViews.length,), engagementRate: engagement(list,), };
    },).sort((a, b,) => b.posts - a.posts);
}

export function hashtagStats(rows: PostRow[],): SocialAudience['hashtags'] {
    const tags = new Map<string, PostRow[]>();
    for (const r of rows) {
        for (const t of hashtagsOf(r.content,)) {
            const list = tags.get(t,);
            if (list) list.push(r,);
            else tags.set(t, [r,],);
        }
    }
    return [...tags.entries(),].map(([tag, list,],) => {
        const withViews = list.filter((r,) => r.views !== null);
        return {
            tag,
            posts: list.length,
            avgViews: withViews.length ? Math.round(withViews.reduce((t, r,) => t + Number(r.views,), 0,) / withViews.length,) : null,
            engagementRate: engagement(list,),
        };
    },).sort((a, b,) => b.posts - a.posts || (b.avgViews ?? 0) - (a.avgViews ?? 0)).slice(0, 25,);
}

async function benchmarks(platform: string, from: string, to: string,): Promise<AudienceBenchmark[]> {
    const r = await query<{ dimension: string; metric: string; value: string; date: Date; first: string | null; }>(
        `SELECT DISTINCT ON (dimension, metric) dimension, metric, value, date,
                (SELECT f.value FROM social_account_daily f WHERE f.platform = d.platform AND f.metric = d.metric AND f.dimension = d.dimension
                   AND f.date >= $2 ORDER BY f.date ASC LIMIT 1) AS first
           FROM social_account_daily d
          WHERE platform = $1 AND dimension LIKE 'peer:%' AND date <= $3
          ORDER BY dimension, metric, date DESC`,
        [platform, from, to,],
    );
    const by = new Map<string, Record<string, { value: number; first: number | null; date: string; }>>();
    for (const row of r.rows) {
        const u = row.dimension.slice(5,);
        const m = by.get(u,) ?? {};
        m[row.metric] = { value: Number(row.value,), first: row.first === null ? null : Number(row.first,), date: day(row.date,), };
        by.set(u, m,);
    }
    return [...by.entries(),].map(([username, m,],) => {
        const f = m.peerFollowers;
        const likes = m.peerAvgLikes?.value ?? null;
        const comments = m.peerAvgComments?.value ?? null;
        return {
            username,
            followers: f?.value ?? null,
            followerChange: f && f.first !== null && f.first !== f.value ? f.value - f.first : (f && f.first !== null ? 0 : null),
            mediaCount: m.peerMediaCount?.value ?? null,
            avgLikes: likes === null ? null : Math.round(likes,),
            avgComments: comments === null ? null : Math.round(comments * 10,) / 10,
            engagementRate: f?.value && (likes !== null || comments !== null) ? ((likes ?? 0) + (comments ?? 0)) / f.value : null,
            postsPerWeek: m.peerPostsPerWeek ? Math.round(m.peerPostsPerWeek.value * 10,) / 10 : null,
            asOf: f?.date ?? null,
        };
    },).sort((a, b,) => (b.followers ?? 0) - (a.followers ?? 0));
}

export async function audience(platform: string, range: { from?: string; to?: string; },): Promise<SocialAudience> {
    const { from, to, } = resolveRange(range.from, range.to,);
    const [demo, br, snap, hours, posts, peers, conn,] = await Promise.all([
        demographics(platform, to,),
        splits(platform, from, to,),
        snapshotSplits(platform, to,),
        onlineHours(platform, from, to,),
        postsInPeriod(platform, from, to,),
        benchmarks(platform, from, to,),
        loadConnection(platform,),
    ],);
    const storyRows = posts.filter((p,) => p.media_kind === 'story');
    const sum = (rows: PostRow[], k: keyof PostRow,) => {
        const vals = rows.map((r,) => n(r[k] as string | null,),).filter((v,): v is number => v !== null,);
        return vals.length ? vals.reduce((t, v,) => t + v, 0,) : null;
    };
    const caps = conn?.credentials && typeof conn.credentials.analyticsCapabilities === 'object'
        ? conn.credentials.analyticsCapabilities as Record<string, unknown>
        : null;
    return {
        platform,
        from,
        to,
        asOf: demo.asOf,
        demographics: demo.result,
        onlineHours: hours,
        breakdowns: {
            ...br,
            // TikTok has no daily follower/non-follower view split; its per-video viewer split stands in.
            viewsByFollow: br.viewsByFollow.length ? br.viewsByFollow : snap.viewerFollow,
            trafficSources: snap.trafficSources,
            viewerTypes: snap.viewerTypes,
        },
        contentKinds: contentKinds(posts,),
        hashtags: hashtagStats(posts.filter((p,) => p.media_kind !== 'story'),),
        stories: { count: storyRows.length, views: sum(storyRows, 'views',), reach: sum(storyRows, 'reach',), replies: sum(storyRows, 'comments',), },
        benchmarks: peers,
        capabilities: caps ? Object.fromEntries(Object.entries(caps,).filter(([, v,],) => typeof v === 'boolean'),) as Record<string, boolean> : null,
    };
}
