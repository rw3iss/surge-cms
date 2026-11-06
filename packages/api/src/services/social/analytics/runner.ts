/**
 * Runs the collectors and writes what they return. The ONE writer of the
 * analytics tables (migration 201).
 *
 * Post cadence: a post gets a metrics row every day for its first 90 days,
 * then about once a week (when its newest row is 7+ days old) — enough for
 * "views at day 7" comparisons without a row per post per day forever.
 * Locking: one 'running' run per platform (unique index, migration 204), so
 * the cron, "Collect now" and other processes never collect a platform twice
 * at the same time.
 */
import type { SocialAnalyticsRun, } from '@sitesurge/types';
import { query, transaction, } from '../../../db';
import { logger, } from '../../../utils/logger';
import { listCollectors, } from './registry';
import type { CollectResult, KnownPost, SocialAnalyticsCollector, } from './types';
import './collectors';

const DAILY_POST_DAYS = 90;
/** Older posts: a new row when the newest one is this many days old. */
const WEEKLY_POST_DAYS = 7;
const MAX_POSTS_PER_RUN = 1000;
/** A run still "running" after this long is treated as dead. */
export const STALE_RUN_MINUTES = 30;
/** Run history kept for the admin (older rows are deleted after each daily collection). */
const RUN_HISTORY_DAYS = 180;

export function utcDay(d = new Date(),): string {
    return d.toISOString().slice(0, 10,);
}

interface ConnectionRow {
    is_connected: boolean;
    is_enabled: boolean;
    credentials: Record<string, unknown> | null;
    settings: Record<string, unknown> | null;
}

export async function loadConnection(provider: string,): Promise<ConnectionRow | null> {
    const r = await query<ConnectionRow>(
        `SELECT is_connected, is_enabled, credentials, settings FROM social_connections WHERE provider::text = $1`,
        [provider,],
    ).catch(() => ({ rows: [] as ConnectionRow[], }));
    return r.rows[0] ?? null;
}

/**
 * Posts of a platform due a snapshot today (no row for today yet): every post
 * of the last 90 days, plus older ones whose newest row is a week old. (This
 * used to be "older posts on Mondays only", so a missed Monday cron skipped
 * them for a whole week.)
 */
async function duePosts(platform: string, today: string,): Promise<KnownPost[]> {
    const r = await query<{ id: string; external_id: string; published_at: Date | null; media_kind: string | null; }>(
        `SELECT p.id, p.external_id, p.published_at, p.media_kind
           FROM social_posts p
          WHERE p.platform::text = $1
            AND NOT EXISTS (SELECT 1 FROM social_post_metrics m WHERE m.social_post_id = p.id AND m.date = $2::date)
            AND (p.published_at IS NULL
                 OR p.published_at >= $2::date - $3::int
                 OR NOT EXISTS (SELECT 1 FROM social_post_metrics m
                                 WHERE m.social_post_id = p.id AND m.date > $2::date - $4::int))
          ORDER BY p.published_at DESC NULLS LAST
          LIMIT $5`,
        [platform, today, DAILY_POST_DAYS, WEEKLY_POST_DAYS, MAX_POSTS_PER_RUN,],
    );
    return r.rows.map((row,) => ({
        id: row.id,
        externalId: row.external_id,
        publishedAt: row.published_at ? new Date(row.published_at,).toISOString() : null,
        kind: row.media_kind,
    }));
}

const num = (v: number | null | undefined,): number | null => (typeof v === 'number' && Number.isFinite(v,) ? v : null);
const int = (v: number | null | undefined,): number | null => {
    const n = num(v,);
    return n === null ? null : Math.round(n,);
};

/** Write one collector's result (one transaction). Returns row counts. */
export async function storeResult(
    platform: string,
    today: string,
    result: CollectResult,
    posts: KnownPost[],
): Promise<Record<string, number>> {
    const counts = { account: 0, daily: 0, posts: 0, unmatched: 0, };
    const idByExternal = new Map(posts.map((p,) => [p.externalId, p.id,]),);
    // A collector may report posts outside the due list (e.g. all recent
    // videos) — map those too.
    const extra = (result.posts ?? []).map((p,) => p.externalId).filter((id,) => !idByExternal.has(id,));
    if (extra.length) {
        const r = await query<{ id: string; external_id: string; }>(
            `SELECT id, external_id FROM social_posts WHERE platform::text = $1 AND external_id = ANY($2::text[])`,
            [platform, extra,],
        );
        for (const row of r.rows) idByExternal.set(row.external_id, row.id,);
    }

    await transaction(async (client,) => {
        const a = result.account;
        if (a) {
            await client.query(
                `INSERT INTO social_account_snapshots (platform, date, followers, following, posts_count, total_views, total_likes, raw, collected_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                 ON CONFLICT (platform, date) DO UPDATE SET
                   followers = COALESCE(EXCLUDED.followers, social_account_snapshots.followers),
                   following = COALESCE(EXCLUDED.following, social_account_snapshots.following),
                   posts_count = COALESCE(EXCLUDED.posts_count, social_account_snapshots.posts_count),
                   total_views = COALESCE(EXCLUDED.total_views, social_account_snapshots.total_views),
                   total_likes = COALESCE(EXCLUDED.total_likes, social_account_snapshots.total_likes),
                   raw = social_account_snapshots.raw || EXCLUDED.raw, collected_at = NOW()`,
                [platform, today, int(a.followers,), int(a.following,), int(a.postsCount,), int(a.totalViews,), int(a.totalLikes,), JSON.stringify(a.raw ?? {},),],
            );
            counts.account = 1;
        }
        for (const d of result.daily ?? []) {
            if (!Number.isFinite(d.value,)) continue;
            await client.query(
                `INSERT INTO social_account_daily (platform, date, metric, dimension, value, collected_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (platform, date, metric, dimension) DO UPDATE SET value = EXCLUDED.value, collected_at = NOW()`,
                [platform, d.date, d.metric, d.dimension ?? '', d.value,],
            );
            counts.daily++;
        }
        for (const p of result.posts ?? []) {
            const id = idByExternal.get(p.externalId,);
            if (!id) {
                counts.unmatched++;
                continue;
            }
            await client.query(
                `INSERT INTO social_post_metrics (social_post_id, date, views, likes, comments, shares, saves, watch_time_s,
                        avg_watch_s, completion_rate, reach, impressions, clicks, raw, collected_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
                 ON CONFLICT (social_post_id, date) DO UPDATE SET
                   views = COALESCE(EXCLUDED.views, social_post_metrics.views),
                   likes = COALESCE(EXCLUDED.likes, social_post_metrics.likes),
                   comments = COALESCE(EXCLUDED.comments, social_post_metrics.comments),
                   shares = COALESCE(EXCLUDED.shares, social_post_metrics.shares),
                   saves = COALESCE(EXCLUDED.saves, social_post_metrics.saves),
                   watch_time_s = COALESCE(EXCLUDED.watch_time_s, social_post_metrics.watch_time_s),
                   avg_watch_s = COALESCE(EXCLUDED.avg_watch_s, social_post_metrics.avg_watch_s),
                   completion_rate = COALESCE(EXCLUDED.completion_rate, social_post_metrics.completion_rate),
                   reach = COALESCE(EXCLUDED.reach, social_post_metrics.reach),
                   impressions = COALESCE(EXCLUDED.impressions, social_post_metrics.impressions),
                   clicks = COALESCE(EXCLUDED.clicks, social_post_metrics.clicks),
                   raw = social_post_metrics.raw || EXCLUDED.raw, collected_at = NOW()`,
                [id, today, int(p.views,), int(p.likes,), int(p.comments,), int(p.shares,), int(p.saves,),
                    num(p.watchTimeS,), num(p.avgWatchS,), num(p.completionRate,), int(p.reach,), int(p.impressions,),
                    int(p.clicks,), JSON.stringify(p.raw ?? {},),],
            );
            counts.posts++;
        }
    },);
    return counts;
}

function mapRun(r: Record<string, any>,): SocialAnalyticsRun {
    return {
        id: r.id,
        platform: r.platform,
        trigger: r.trigger,
        status: r.status,
        startedAt: new Date(r.started_at,).toISOString(),
        finishedAt: r.finished_at ? new Date(r.finished_at,).toISOString() : null,
        counts: r.counts ?? {},
        warnings: r.warnings ?? [],
        error: r.error ?? null,
    };
}

export async function listRuns(platform?: string, limit = 20,): Promise<SocialAnalyticsRun[]> {
    const r = await query(
        `SELECT * FROM social_analytics_runs WHERE ($1::text IS NULL OR platform = $1) ORDER BY started_at DESC LIMIT $2`,
        [platform ?? null, Math.min(Math.max(limit, 1,), 200,),],
    );
    return r.rows.map(mapRun,);
}

export async function lastRuns(): Promise<Map<string, SocialAnalyticsRun>> {
    const r = await query(
        `SELECT DISTINCT ON (platform) * FROM social_analytics_runs ORDER BY platform, started_at DESC`,
    );
    return new Map(r.rows.map((row,) => [row.platform as string, mapRun(row,),]),);
}

/** Mark runs still 'running' after STALE_RUN_MINUTES as failed (the process stopped). */
export async function expireStaleRuns(platform?: string,): Promise<number> {
    const r = await query(
        `UPDATE social_analytics_runs
            SET status = 'failed', finished_at = NOW(), error = COALESCE(error, 'The run did not finish (the process stopped or timed out).')
          WHERE status = 'running' AND started_at < NOW() - ($1 || ' minutes')::interval
            AND ($2::text IS NULL OR platform = $2)`,
        [String(STALE_RUN_MINUTES,), platform ?? null,],
    );
    return r.rowCount ?? 0;
}

/** Drop run history older than RUN_HISTORY_DAYS (the newest run per platform is always kept). */
export async function pruneRuns(): Promise<number> {
    const r = await query(
        `DELETE FROM social_analytics_runs r
          WHERE r.started_at < NOW() - ($1 || ' days')::interval
            AND r.status <> 'running'
            AND EXISTS (SELECT 1 FROM social_analytics_runs n WHERE n.platform = r.platform AND n.started_at > r.started_at)`,
        [String(RUN_HISTORY_DAYS,),],
    );
    return r.rowCount ?? 0;
}

/** Run one collector now; null when it cannot collect (or is already running). */
export async function runCollector(c: SocialAnalyticsCollector, trigger: string,): Promise<SocialAnalyticsRun | null> {
    const conn = await loadConnection(c.connection,);
    const credentials = conn?.credentials ?? {};
    const connected = Boolean(conn?.is_connected && conn?.is_enabled,);
    const status = await Promise.resolve(c.status(credentials, connected,),).catch(() => null);
    if (!status || status.state === 'off') return null;

    // Close runs a crashed process left 'running', then claim the platform: the
    // unique index (migration 204) lets only ONE caller insert a running row.
    await expireStaleRuns(c.platform,);
    const run = await query<{ id: string; }>(
        `INSERT INTO social_analytics_runs (platform, trigger) VALUES ($1, $2)
         ON CONFLICT (platform) WHERE status = 'running' DO NOTHING
         RETURNING id`,
        [c.platform, trigger,],
    );
    if (!run.rows[0]) return null;
    const runId = run.rows[0].id;
    const warnings: string[] = [];
    const today = utcDay();
    try {
        const posts = await duePosts(c.platform, today,);
        const result = await c.collect({
            today,
            posts,
            credentials,
            settings: conn?.settings ?? {},
            warn: (m,) => warnings.push(m,),
        },);
        const counts = await storeResult(c.platform, today, result, posts,);
        await query(
            `UPDATE social_analytics_runs SET status = $2, finished_at = NOW(), counts = $3, warnings = $4 WHERE id = $1`,
            [runId, warnings.length ? 'partial' : 'ok', JSON.stringify(counts,), JSON.stringify(warnings,),],
        );
    } catch (err) {
        const msg = (err as Error).message || 'Collection failed';
        logger.warn('social-analytics: collector failed', { platform: c.platform, error: msg, },);
        await query(
            `UPDATE social_analytics_runs SET status = 'failed', finished_at = NOW(), error = $2, warnings = $3 WHERE id = $1`,
            [runId, msg, JSON.stringify(warnings,),],
        );
    }
    const done = await query(`SELECT * FROM social_analytics_runs WHERE id = $1`, [runId,],);
    return mapRun(done.rows[0],);
}

/** Run every (or the named) collector, one after another; one failure never stops the rest. */
export async function runCollection(opts: { platforms?: string[]; trigger?: string; } = {},): Promise<SocialAnalyticsRun[]> {
    const runs: SocialAnalyticsRun[] = [];
    for (const c of listCollectors()) {
        if (opts.platforms?.length && !opts.platforms.includes(c.platform,)) continue;
        try {
            const r = await runCollector(c, opts.trigger ?? 'cron',);
            if (r) runs.push(r,);
        } catch (err) {
            logger.warn('social-analytics: run failed', { platform: c.platform, error: (err as Error).message, },);
        }
    }
    return runs;
}

/** How long an HTTP "Collect now" waits before answering (proxies cut requests at ~60–100 s). */
const COLLECT_NOW_WAIT_MS = 50_000;

/**
 * "Collect now" over HTTP: start the collection, answer with the finished runs
 * after ≤ 50 s. Collectors still working keep going in the background and are
 * returned as their 'running' rows, so the admin can say so and refresh later.
 */
export async function collectNow(opts: { platforms?: string[]; } = {}, waitMs = COLLECT_NOW_WAIT_MS,): Promise<SocialAnalyticsRun[]> {
    const startedAt = new Date();
    const work = runCollection({ platforms: opts.platforms, trigger: 'manual', },);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve,) => {
        timer = setTimeout(() => resolve(null,), waitMs,);
    },);
    const done = await Promise.race([work, timedOut,],).finally(() => clearTimeout(timer,),);
    if (done) return done;
    work.catch((e,) => logger.warn('social-analytics: background collection failed', { error: (e as Error).message, },));
    // Every run this request started (finished or still running), newest per platform.
    const r = await query(
        `SELECT DISTINCT ON (platform) * FROM social_analytics_runs
          WHERE trigger = 'manual' AND started_at >= $1 AND ($2::text[] IS NULL OR platform = ANY($2::text[]))
          ORDER BY platform, started_at DESC`,
        [startedAt, opts.platforms?.length ? opts.platforms : null,],
    );
    return r.rows.map(mapRun,);
}

/** Cron: daily at 06:10 UTC (platforms finish yesterday's numbers overnight). */
export const SOCIAL_ANALYTICS_CRON = {
    name: 'social-analytics',
    schedule: '10 6 * * *',
    description: 'Collects daily social analytics (accounts, daily series, post metrics) from every connected platform.',
    handler: async (): Promise<void> => {
        await runCollection({ trigger: 'cron', },);
        await pruneRuns().catch((e,) => logger.warn('social-analytics: run pruning failed', { error: (e as Error).message, },));
    },
};
