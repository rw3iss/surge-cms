/**
 * `live_recordings` — one row per browser recording (S3/R2 multipart upload)
 * of a live show. Raw rows; `services/liveRecordings` maps them.
 */
import type { PoolClient, } from 'pg';
import type { LiveRecordingStatus, } from '@sitesurge/types';
import { query, } from '../db';

export interface LiveRecordingRow {
    id: string;
    post_id: string;
    user_id: string | null;
    method: string;
    status: LiveRecordingStatus;
    mime_type: string;
    object_key: string;
    upload_id: string;
    /** BIGINT — pg returns it as a string. */
    part_size: string | number;
    media_id: string | null;
    error: string | null;
    created_at: Date | string;
    updated_at: Date | string;
}

type Runner = Pick<PoolClient, 'query'>;
const run = (client?: Runner,) => (client ? client.query.bind(client,) : query) as typeof query;

export interface InsertRecordingInput {
    id: string;
    postId: string;
    userId: string | null;
    method: string;
    mimeType: string;
    objectKey: string;
    uploadId: string;
    partSize: number;
}

export async function insert(i: InsertRecordingInput,): Promise<LiveRecordingRow> {
    const r = await query<LiveRecordingRow>(
        `INSERT INTO live_recordings (id, post_id, user_id, method, status, mime_type, object_key, upload_id, part_size)
         VALUES ($1, $2, $3, $4, 'recording', $5, $6, $7, $8)
         RETURNING *`,
        [i.id, i.postId, i.userId, i.method, i.mimeType, i.objectKey, i.uploadId, i.partSize,],
    );
    return r.rows[0]!;
}

export async function findById(id: string,): Promise<LiveRecordingRow | null> {
    const r = await query<LiveRecordingRow>(`SELECT * FROM live_recordings WHERE id = $1`, [id,],);
    return r.rows[0] ?? null;
}

/** The show's open (`recording`) row, if any. */
export async function findOpen(postId: string,): Promise<LiveRecordingRow | null> {
    const r = await query<LiveRecordingRow>(
        `SELECT * FROM live_recordings WHERE post_id = $1 AND status = 'recording' ORDER BY created_at DESC LIMIT 1`,
        [postId,],
    );
    return r.rows[0] ?? null;
}

export async function findLatest(postId: string,): Promise<LiveRecordingRow | null> {
    const r = await query<LiveRecordingRow>(
        `SELECT * FROM live_recordings WHERE post_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [postId,],
    );
    return r.rows[0] ?? null;
}

/**
 * Atomic status transition: only moves a row that is still in `from`, so two
 * finalizers (the host + the safety-net timer) cannot both complete it.
 */
export async function transition(
    id: string,
    from: LiveRecordingStatus,
    to: LiveRecordingStatus,
    extra: { error?: string | null; mediaId?: string | null; } = {},
    client?: Runner,
): Promise<LiveRecordingRow | null> {
    const r = await run(client,)<LiveRecordingRow>(
        `UPDATE live_recordings
            SET status = $3,
                error = CASE WHEN $4::boolean THEN $5 ELSE error END,
                media_id = COALESCE($6, media_id),
                updated_at = NOW()
          WHERE id = $1 AND status = $2
          RETURNING *`,
        [id, from, to, 'error' in extra, extra.error ?? null, extra.mediaId ?? null,],
    );
    return r.rows[0] ?? null;
}

/**
 * Safety-net candidates: `recording` rows older than `olderThanHours` whose
 * show has ended, or that are older than `staleHours` regardless (a show
 * never marked ended); plus `finalizing` rows stuck that long.
 */
export async function listStale(olderThanHours: number, staleHours: number,): Promise<LiveRecordingRow[]> {
    const r = await query<LiveRecordingRow>(
        `SELECT lr.* FROM live_recordings lr
           JOIN posts p ON p.id = lr.post_id
          WHERE (lr.status = 'recording'
                 AND lr.created_at < NOW() - make_interval(hours => $1::int)
                 AND (p.live_ended_at IS NOT NULL OR lr.created_at < NOW() - make_interval(hours => $2::int)))
             OR (lr.status = 'finalizing' AND lr.updated_at < NOW() - make_interval(hours => $1::int))
          ORDER BY lr.created_at
          LIMIT 200`,
        [olderThanHours, staleHours,],
    );
    return r.rows;
}
