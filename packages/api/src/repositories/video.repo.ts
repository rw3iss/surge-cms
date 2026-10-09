/**
 * Data access for self-hosted video: `media_videos`, `video_jobs`,
 * `video_renditions`. Key bytes live in `video_keys` (services/video/keys.ts)
 * and never pass through here.
 *
 * Jobs are claimed with a LEASE (`lease_owner` + `lease_until`) under
 * `FOR UPDATE SKIP LOCKED`, so two encoder processes can never take the same
 * job, and a crashed encoder's job is re-taken once its lease lapses. Where to
 * resume is derived from the RENDITION rows (ready → skip), never from the
 * job's display status.
 */
import type { PoolClient, } from 'pg';
import type {
    MediaVideoSummary,
    VideoBlockedReason,
    VideoJob,
    VideoJobKind,
    VideoJobStatus,
    VideoRendition,
    VideoRenditionStatus,
    VideoVariant,
} from '@sitesurge/types';
import { query, } from '../db';

type Db = Pick<PoolClient, 'query'>;
const db = (c?: Db,): Db => c ?? { query: query as unknown as Db['query'], };

const num = (v: unknown,): number | null => (v === null || v === undefined ? null : Number(v,));
const iso = (v: unknown,): string | null => (v ? new Date(v as string,).toISOString() : null);

export const TERMINAL_JOB_STATUSES: VideoJobStatus[] = ['ready', 'failed', 'cancelled',];
const TERMINAL_SQL = `('ready','failed','cancelled')`;

// ─── media_videos ─────────────────────────────────────────────────────

export interface VideoRow {
    mediaId: string;
    encodeId: string;
    storagePrefix: string;
    teaserPrefix: string | null;
    sourceKey: string | null;
    sourceSize: number | null;
    keepOriginal: boolean;
    originalExpiresAt: string | null;
    probe: Record<string, unknown> | null;
    posterUrl: string | null;
    thumbnailsVtt: string | null;
    encrypted: boolean;
    keyVersion: number | null;
    ivHex: string | null;
    teaserEnabled: boolean;
    teaserStartMs: number;
    teaserDurationMs: number;
    hlsVersion: number;
    /** Make a quick-replay MP4 first (live recordings). */
    quickReplay: boolean;
    /** Object key of the quick-replay MP4, once made. */
    quickReplayPath: string | null;
    quickReplayBytes: number | null;
    createdAt: string;
    updatedAt: string;
}

function mapVideo(r: Record<string, unknown>,): VideoRow {
    return {
        mediaId: r.media_id as string,
        encodeId: r.encode_id as string,
        storagePrefix: r.storage_prefix as string,
        teaserPrefix: (r.teaser_prefix as string) ?? null,
        sourceKey: (r.source_key as string) ?? null,
        sourceSize: num(r.source_size,),
        keepOriginal: r.keep_original as boolean,
        originalExpiresAt: iso(r.original_expires_at,),
        probe: (r.probe as Record<string, unknown>) ?? null,
        posterUrl: (r.poster_url as string) ?? null,
        thumbnailsVtt: (r.thumbnails_vtt as string) ?? null,
        encrypted: r.encrypted as boolean,
        keyVersion: num(r.key_version,),
        ivHex: (r.iv_hex as string) ?? null,
        teaserEnabled: r.teaser_enabled as boolean,
        teaserStartMs: Number(r.teaser_start_ms,),
        teaserDurationMs: Number(r.teaser_duration_ms,),
        hlsVersion: Number(r.hls_version,),
        quickReplay: r.quick_replay === true,
        quickReplayPath: (r.quick_replay_path as string) ?? null,
        quickReplayBytes: num(r.quick_replay_bytes,),
        createdAt: iso(r.created_at,)!,
        updatedAt: iso(r.updated_at,)!,
    };
}

export type VideoInsert = Pick<VideoRow, 'mediaId' | 'encodeId' | 'storagePrefix' | 'teaserPrefix' | 'sourceKey' | 'sourceSize'
    | 'keepOriginal' | 'encrypted' | 'keyVersion' | 'ivHex' | 'teaserEnabled' | 'teaserStartMs' | 'teaserDurationMs'>
    & { quickReplay?: boolean; };

export async function insertVideo(v: VideoInsert, c?: Db,): Promise<VideoRow> {
    const r = await db(c,).query(
        `INSERT INTO media_videos (media_id, encode_id, storage_prefix, teaser_prefix, source_key, source_size,
             keep_original, encrypted, key_version, iv_hex, teaser_enabled, teaser_start_ms, teaser_duration_ms, quick_replay)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [v.mediaId, v.encodeId, v.storagePrefix, v.teaserPrefix, v.sourceKey, v.sourceSize, v.keepOriginal,
            v.encrypted, v.keyVersion, v.ivHex, v.teaserEnabled, v.teaserStartMs, v.teaserDurationMs, v.quickReplay === true,],
    );
    return mapVideo(r.rows[0],);
}

export async function getVideo(mediaId: string, c?: Db,): Promise<VideoRow | null> {
    const r = await db(c,).query(`SELECT * FROM media_videos WHERE media_id = $1`, [mediaId,],);
    return r.rows[0] ? mapVideo(r.rows[0],) : null;
}

const VIDEO_COLUMNS: Record<string, string> = {
    encodeId: 'encode_id', storagePrefix: 'storage_prefix', teaserPrefix: 'teaser_prefix', sourceKey: 'source_key',
    sourceSize: 'source_size', keepOriginal: 'keep_original', originalExpiresAt: 'original_expires_at', probe: 'probe',
    posterUrl: 'poster_url', thumbnailsVtt: 'thumbnails_vtt', encrypted: 'encrypted', keyVersion: 'key_version',
    ivHex: 'iv_hex', teaserEnabled: 'teaser_enabled', teaserStartMs: 'teaser_start_ms',
    teaserDurationMs: 'teaser_duration_ms', hlsVersion: 'hls_version',
    quickReplay: 'quick_replay', quickReplayPath: 'quick_replay_path', quickReplayBytes: 'quick_replay_bytes',
};

export async function updateVideo(mediaId: string, patch: Partial<Omit<VideoRow, 'mediaId' | 'createdAt' | 'updatedAt'>>, c?: Db,): Promise<VideoRow | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v,] of Object.entries(patch,)) {
        const col = VIDEO_COLUMNS[k];
        if (!col || v === undefined) continue;
        vals.push(k === 'probe' && v !== null ? JSON.stringify(v,) : v,);
        sets.push(`${col} = $${vals.length}`,);
    }
    if (sets.length === 0) return getVideo(mediaId, c,);
    vals.push(mediaId,);
    const r = await db(c,).query(
        `UPDATE media_videos SET ${sets.join(', ',)}, updated_at = NOW() WHERE media_id = $${vals.length} RETURNING *`,
        vals,
    );
    return r.rows[0] ? mapVideo(r.rows[0],) : null;
}

export async function bumpHlsVersion(mediaId: string, c?: Db,): Promise<void> {
    await db(c,).query(`UPDATE media_videos SET hls_version = hls_version + 1, updated_at = NOW() WHERE media_id = $1`, [mediaId,],);
}

/** Kept originals whose retention has passed. */
export async function listExpiredOriginals(limit = 50,): Promise<VideoRow[]> {
    const r = await query(
        `SELECT * FROM media_videos
          WHERE source_key IS NOT NULL AND original_expires_at IS NOT NULL AND original_expires_at < NOW()
            AND NOT EXISTS (SELECT 1 FROM video_jobs j WHERE j.media_id = media_videos.media_id
                             AND j.status NOT IN ${TERMINAL_SQL})
          ORDER BY original_expires_at LIMIT $1`,
        [limit,],
    );
    return r.rows.map(mapVideo,);
}

/** Private videos encrypted with a key version other than `current`. */
export async function listVideosOnOtherKeys(current: number,): Promise<string[]> {
    const r = await query<{ media_id: string; }>(
        `SELECT media_id FROM media_videos WHERE encrypted = true AND key_version IS DISTINCT FROM $1`,
        [current,],
    );
    return r.rows.map((x,) => x.media_id);
}

// ─── video_jobs ───────────────────────────────────────────────────────

function mapJob(r: Record<string, unknown>,): VideoJob {
    return {
        id: r.id as string,
        mediaId: r.media_id as string,
        kind: r.kind as VideoJobKind,
        status: r.status as VideoJobStatus,
        blockedReason: (r.blocked_reason as VideoBlockedReason) ?? null,
        progress: Number(r.progress ?? 0,),
        attempts: Number(r.attempts,),
        maxAttempts: Number(r.max_attempts,),
        error: (r.error as string) ?? null,
        cancelRequested: r.cancel_requested as boolean,
        createdAt: iso(r.created_at,)!,
        startedAt: iso(r.started_at,),
        finishedAt: iso(r.finished_at,),
        updatedAt: iso(r.updated_at,)!,
    };
}

export interface ClaimedJob extends VideoJob {
    leaseOwner: string;
}

/**
 * Enqueue a job. At most one ACTIVE job per media (partial unique index): if
 * one exists it is returned unchanged instead.
 */
export async function enqueueJob(
    mediaId: string,
    opts: { kind?: VideoJobKind; createdBy?: string | null; priority?: number; } = {},
    c?: Db,
): Promise<VideoJob> {
    const r = await db(c,).query(
        `INSERT INTO video_jobs (media_id, kind, created_by, priority)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (media_id) WHERE status NOT IN ${TERMINAL_SQL} DO NOTHING
         RETURNING *`,
        [mediaId, opts.kind ?? 'encode', opts.createdBy ?? null, opts.priority ?? 100,],
    );
    if (r.rows[0]) return mapJob(r.rows[0],);
    const existing = await activeJob(mediaId, c,);
    if (!existing) throw new Error('enqueueJob: conflict without an active job',);
    return existing;
}

/** Claim the next due job (queued, or with a lapsed lease). */
export async function claimJob(owner: string, leaseSeconds = 90,): Promise<ClaimedJob | null> {
    const r = await query(
        `UPDATE video_jobs SET
             status      = CASE WHEN status = 'queued' THEN 'downloading' ELSE status END,
             lease_owner = $1,
             lease_until = NOW() + make_interval(secs => $2),
             attempts    = attempts + 1,
             blocked_reason = NULL,
             started_at  = COALESCE(started_at, NOW()),
             updated_at  = NOW()
         WHERE id = (
             SELECT id FROM video_jobs
              WHERE status NOT IN ${TERMINAL_SQL}
                AND cancel_requested = false
                AND next_attempt_at <= NOW()
                AND (lease_until IS NULL OR lease_until < NOW())
              ORDER BY priority, created_at
              FOR UPDATE SKIP LOCKED
              LIMIT 1)
         RETURNING *`,
        [owner, leaseSeconds,],
    );
    return r.rows[0] ? { ...mapJob(r.rows[0],), leaseOwner: owner, } : null;
}

/**
 * Extend the lease and record progress/status. Returns FALSE when the lease is
 * no longer ours (another process took the job) — the caller must stop.
 */
export async function heartbeat(
    jobId: string,
    owner: string,
    patch: { progress?: number; status?: VideoJobStatus; } = {},
    leaseSeconds = 90,
): Promise<boolean> {
    const r = await query(
        `UPDATE video_jobs SET lease_until = NOW() + make_interval(secs => $3),
                progress = COALESCE($4, progress), status = COALESCE($5, status), updated_at = NOW()
          WHERE id = $1 AND lease_owner = $2 AND status NOT IN ${TERMINAL_SQL}`,
        [jobId, owner, leaseSeconds, patch.progress ?? null, patch.status ?? null,],
    );
    return (r.rowCount ?? 0) > 0;
}

export async function isCancelRequested(jobId: string,): Promise<boolean> {
    const r = await query<{ cancel_requested: boolean; }>(`SELECT cancel_requested FROM video_jobs WHERE id = $1`, [jobId,],);
    return r.rows[0]?.cancel_requested === true;
}

/** Terminal transition (ready / failed / cancelled). Clears the lease. */
export async function finishJob(jobId: string, status: 'ready' | 'failed' | 'cancelled', error: string | null = null, c?: Db,): Promise<void> {
    await db(c,).query(
        `UPDATE video_jobs SET status = $2::varchar, error = $3, lease_owner = NULL, lease_until = NULL,
                progress = CASE WHEN $2::varchar = 'ready' THEN 100 ELSE progress END,
                finished_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [jobId, status, error,],
    );
}

/** Give the job back (shutdown): next poller takes it at once. */
export async function releaseJob(jobId: string, owner: string,): Promise<void> {
    await query(
        `UPDATE video_jobs SET lease_owner = NULL, lease_until = NULL, attempts = GREATEST(attempts - 1, 0), updated_at = NOW()
          WHERE id = $1 AND lease_owner = $2 AND status NOT IN ${TERMINAL_SQL}`,
        [jobId, owner,],
    );
}

/** Not runnable yet (no ffmpeg, no disk): wait without spending an attempt. */
export async function blockJob(jobId: string, reason: Exclude<VideoBlockedReason, null>, retryInSeconds: number,): Promise<void> {
    await query(
        `UPDATE video_jobs SET blocked_reason = $2, lease_owner = NULL, lease_until = NULL,
                attempts = GREATEST(attempts - 1, 0),
                next_attempt_at = NOW() + make_interval(secs => $3), updated_at = NOW()
          WHERE id = $1`,
        [jobId, reason, retryInSeconds,],
    );
}

/** A failed attempt: retry after `delaySeconds`, or fail for good when out of attempts. */
export async function failAttempt(jobId: string, error: string, delaySeconds: number,): Promise<'retry' | 'failed'> {
    const r = await query<{ status: string; }>(
        `UPDATE video_jobs SET
             status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
             error = $2, lease_owner = NULL, lease_until = NULL,
             next_attempt_at = NOW() + make_interval(secs => $3),
             finished_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE NULL END,
             updated_at = NOW()
          WHERE id = $1 RETURNING status`,
        [jobId, error.slice(0, 4000,), delaySeconds,],
    );
    return r.rows[0]?.status === 'failed' ? 'failed' : 'retry';
}

export async function requestCancel(mediaId: string,): Promise<VideoJob | null> {
    const r = await query(
        `UPDATE video_jobs SET cancel_requested = true, updated_at = NOW()
          WHERE media_id = $1 AND status NOT IN ${TERMINAL_SQL} RETURNING *`,
        [mediaId,],
    );
    // An unclaimed job has nobody to notice the flag: finish it here.
    const job = r.rows[0] ? mapJob(r.rows[0],) : null;
    if (job) {
        await query(
            `UPDATE video_jobs SET status = 'cancelled', finished_at = NOW(), updated_at = NOW()
              WHERE id = $1 AND (lease_until IS NULL OR lease_until < NOW())`,
            [job.id,],
        );
    }
    return job;
}

export async function activeJob(mediaId: string, c?: Db,): Promise<VideoJob | null> {
    const r = await db(c,).query(
        `SELECT * FROM video_jobs WHERE media_id = $1 AND status NOT IN ${TERMINAL_SQL} LIMIT 1`,
        [mediaId,],
    );
    return r.rows[0] ? mapJob(r.rows[0],) : null;
}

export async function latestJob(mediaId: string,): Promise<VideoJob | null> {
    const r = await query(`SELECT * FROM video_jobs WHERE media_id = $1 ORDER BY created_at DESC LIMIT 1`, [mediaId,],);
    return r.rows[0] ? mapJob(r.rows[0],) : null;
}

export async function getJob(jobId: string,): Promise<VideoJob | null> {
    const r = await query(`SELECT * FROM video_jobs WHERE id = $1`, [jobId,],);
    return r.rows[0] ? mapJob(r.rows[0],) : null;
}

export async function listJobs(opts: { active?: boolean; limit?: number; } = {},): Promise<(VideoJob & { title: string | null; })[]> {
    const r = await query(
        `SELECT j.*, COALESCE(NULLIF(m.title, ''), m.original_name) AS title
           FROM video_jobs j JOIN media m ON m.id = j.media_id
          ${opts.active ? `WHERE j.status NOT IN ${TERMINAL_SQL}` : ''}
          ORDER BY j.created_at DESC LIMIT $1`,
        [Math.min(opts.limit ?? 50, 200,),],
    );
    return r.rows.map((row,) => ({ ...mapJob(row,), title: (row.title as string) ?? null, }));
}

/** Re-arm a failed/cancelled job's media for another go. */
export async function retryJob(mediaId: string, createdBy: string | null,): Promise<VideoJob> {
    await query(
        `UPDATE video_renditions SET status = 'queued', progress = 0, error = NULL, attempts = 0
          WHERE media_id = $1 AND status IN ('failed', 'encoding', 'uploading')`,
        [mediaId,],
    );
    return enqueueJob(mediaId, { kind: 'encode', createdBy, },);
}

// ─── video_renditions ─────────────────────────────────────────────────

export interface RenditionRow extends VideoRendition {
    mediaId: string;
    jobId: string | null;
    sortOrder: number;
    avgBandwidth: number | null;
    codecs: string | null;
    playlistPath: string | null;
    downloadPath: string | null;
    attempts: number;
}

function mapRendition(r: Record<string, unknown>,): RenditionRow {
    return {
        id: r.id as string,
        mediaId: r.media_id as string,
        jobId: (r.job_id as string) ?? null,
        variant: r.variant as VideoVariant,
        name: r.name as string,
        sortOrder: Number(r.sort_order,),
        width: num(r.width,),
        height: num(r.height,),
        bandwidth: num(r.bandwidth,),
        avgBandwidth: num(r.avg_bandwidth,),
        codecs: (r.codecs as string) ?? null,
        status: r.status as VideoRenditionStatus,
        progress: Number(r.progress ?? 0,),
        attempts: Number(r.attempts ?? 0,),
        error: (r.error as string) ?? null,
        playlistPath: (r.playlist_path as string) ?? null,
        bytes: num(r.bytes,),
        downloadPath: (r.download_path as string) ?? null,
        downloadBytes: num(r.download_bytes,),
        startedAt: iso(r.started_at,),
        finishedAt: iso(r.finished_at,),
    };
}

/** Public (wire) projection: drops storage paths. */
export function toWireRendition(r: RenditionRow,): VideoRendition {
    return {
        id: r.id, variant: r.variant, name: r.name, width: r.width, height: r.height, bandwidth: r.bandwidth,
        status: r.status, progress: r.progress, error: r.error, bytes: r.bytes, downloadBytes: r.downloadBytes,
        startedAt: r.startedAt, finishedAt: r.finishedAt,
    };
}

export async function listRenditions(mediaId: string, variant?: VideoVariant, c?: Db,): Promise<RenditionRow[]> {
    const r = await db(c,).query(
        `SELECT * FROM video_renditions WHERE media_id = $1 ${variant ? 'AND variant = $2' : ''}
          ORDER BY variant, sort_order`,
        variant ? [mediaId, variant,] : [mediaId,],
    );
    return r.rows.map(mapRendition,);
}

export interface RenditionPlan {
    variant: VideoVariant;
    name: string;
    sortOrder: number;
    width: number | null;
    height: number | null;
    bandwidth: number | null;
    avgBandwidth: number | null;
    codecs: string | null;
}

/**
 * Make the rendition rows match a plan: insert missing ones, keep READY rows
 * untouched (resume), reset non-ready ones, delete rows not in the plan.
 */
export async function syncRenditions(mediaId: string, jobId: string, plan: RenditionPlan[], c?: Db,): Promise<RenditionRow[]> {
    const d = db(c,);
    const keys = plan.map((p,) => `${p.variant}:${p.name}`);
    await d.query(
        `DELETE FROM video_renditions WHERE media_id = $1 AND NOT ((variant || ':' || name) = ANY($2::text[]))`,
        [mediaId, keys,],
    );
    for (const p of plan) {
        await d.query(
            `INSERT INTO video_renditions (media_id, job_id, variant, name, sort_order, width, height, bandwidth, avg_bandwidth, codecs)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (media_id, variant, name) DO UPDATE SET
                 job_id = EXCLUDED.job_id, sort_order = EXCLUDED.sort_order,
                 width = CASE WHEN video_renditions.status = 'ready' THEN video_renditions.width ELSE EXCLUDED.width END,
                 height = CASE WHEN video_renditions.status = 'ready' THEN video_renditions.height ELSE EXCLUDED.height END,
                 bandwidth = CASE WHEN video_renditions.status = 'ready' THEN video_renditions.bandwidth ELSE EXCLUDED.bandwidth END,
                 avg_bandwidth = CASE WHEN video_renditions.status = 'ready' THEN video_renditions.avg_bandwidth ELSE EXCLUDED.avg_bandwidth END,
                 codecs = CASE WHEN video_renditions.status = 'ready' THEN video_renditions.codecs ELSE EXCLUDED.codecs END,
                 status = CASE WHEN video_renditions.status = 'ready' THEN 'ready' ELSE 'queued' END,
                 progress = CASE WHEN video_renditions.status = 'ready' THEN 100 ELSE 0 END`,
            [mediaId, jobId, p.variant, p.name, p.sortOrder, p.width, p.height, p.bandwidth, p.avgBandwidth, p.codecs,],
        );
    }
    return listRenditions(mediaId, undefined, c,);
}

/** Drop every rendition (a full re-encode to a new prefix). */
export async function deleteRenditions(mediaId: string, c?: Db,): Promise<void> {
    await db(c,).query(`DELETE FROM video_renditions WHERE media_id = $1`, [mediaId,],);
}

const RENDITION_COLUMNS: Record<string, string> = {
    status: 'status', progress: 'progress', error: 'error', playlistPath: 'playlist_path', bytes: 'bytes',
    downloadPath: 'download_path', downloadBytes: 'download_bytes', width: 'width', height: 'height',
    bandwidth: 'bandwidth', avgBandwidth: 'avg_bandwidth', codecs: 'codecs', startedAt: 'started_at',
    finishedAt: 'finished_at', attempts: 'attempts', jobId: 'job_id',
};

export async function updateRendition(id: string, patch: Partial<Omit<RenditionRow, 'id' | 'mediaId' | 'variant' | 'name'>>, c?: Db,): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v,] of Object.entries(patch,)) {
        const col = RENDITION_COLUMNS[k];
        if (!col || v === undefined) continue;
        vals.push(v,);
        sets.push(`${col} = $${vals.length}`,);
    }
    if (sets.length === 0) return;
    vals.push(id,);
    await db(c,).query(`UPDATE video_renditions SET ${sets.join(', ',)} WHERE id = $${vals.length}`, vals,);
}

// ─── Summaries for the media list ─────────────────────────────────────

/** One query for a page of media rows → the compact video block per id. */
export async function summaries(mediaIds: string[],): Promise<Map<string, MediaVideoSummary>> {
    const out = new Map<string, MediaVideoSummary>();
    if (mediaIds.length === 0) return out;
    const r = await query(
        `SELECT v.media_id, v.poster_url, v.encrypted,
                (v.teaser_enabled AND EXISTS (SELECT 1 FROM video_renditions t WHERE t.media_id = v.media_id
                     AND t.variant = 'teaser' AND t.status = 'ready')) AS has_teaser,
                j.status AS job_status, j.progress AS job_progress, j.blocked_reason,
                COALESCE((SELECT json_agg(json_build_object('variant', x.variant, 'name', x.name,
                                 'status', x.status, 'progress', x.progress) ORDER BY x.variant, x.sort_order)
                            FROM video_renditions x WHERE x.media_id = v.media_id), '[]') AS renditions
           FROM media_videos v
           LEFT JOIN LATERAL (SELECT status, progress, blocked_reason FROM video_jobs
                               WHERE media_id = v.media_id ORDER BY created_at DESC LIMIT 1) j ON true
          WHERE v.media_id = ANY($1::uuid[])`,
        [mediaIds,],
    );
    for (const row of r.rows) {
        out.set(row.media_id, {
            posterUrl: row.poster_url ?? null,
            hasTeaser: row.has_teaser === true,
            encrypted: row.encrypted === true,
            progress: Number(row.job_progress ?? 0,),
            jobStatus: row.job_status ?? null,
            blockedReason: row.blocked_reason ?? null,
            renditions: (row.renditions as { variant: VideoVariant; name: string; status: VideoRenditionStatus; progress: number; }[])
                .map((x,) => ({ ...x, progress: Number(x.progress,), })),
        },);
    }
    return out;
}
