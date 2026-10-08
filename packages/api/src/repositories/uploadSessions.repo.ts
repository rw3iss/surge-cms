/**
 * `media_upload_sessions` — one row per direct (browser → object store)
 * multipart upload. Raw rows; the service maps them to `UploadSession`.
 */
import type { PoolClient, } from 'pg';
import { query, } from '../db';

export interface UploadSessionRow {
    id: string;
    user_id: string | null;
    filename: string;
    mime_type: string;
    /** BIGINT — pg returns it as a string. */
    size: string | number;
    fingerprint: string;
    object_key: string;
    upload_id: string;
    part_size: string | number;
    part_count: number;
    status: 'uploading' | 'completed' | 'aborted' | 'expired';
    options: Record<string, unknown> | null;
    media_id: string | null;
    created_at: Date | string;
    updated_at: Date | string;
    expires_at: Date | string;
}

type Runner = Pick<PoolClient, 'query'>;
const run = (client?: Runner,) => (client ? client.query.bind(client,) : query) as typeof query;

export interface InsertSessionInput {
    id: string;
    userId: string | null;
    filename: string;
    mimeType: string;
    size: number;
    fingerprint: string;
    objectKey: string;
    uploadId: string;
    partSize: number;
    partCount: number;
    options: Record<string, unknown>;
}

export async function insertSession(i: InsertSessionInput, client?: Runner,): Promise<UploadSessionRow> {
    const r = await run(client,)<UploadSessionRow>(
        `INSERT INTO media_upload_sessions
            (id, user_id, filename, mime_type, size, fingerprint, object_key, upload_id, part_size, part_count, options)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [i.id, i.userId, i.filename, i.mimeType, i.size, i.fingerprint, i.objectKey, i.uploadId, i.partSize, i.partCount, JSON.stringify(i.options,),],
    );
    return r.rows[0]!;
}

/** An open, unexpired session for the same user + file (resume). */
export async function findOpenByFingerprint(userId: string | null, fingerprint: string, size: number,): Promise<UploadSessionRow | null> {
    const r = await query<UploadSessionRow>(
        `SELECT * FROM media_upload_sessions
          WHERE user_id IS NOT DISTINCT FROM $1 AND fingerprint = $2 AND size = $3
            AND status = 'uploading' AND expires_at > NOW()
          ORDER BY created_at DESC LIMIT 1`,
        [userId, fingerprint, size,],
    );
    return r.rows[0] ?? null;
}

export async function listOpenByUser(userId: string | null, limit = 20,): Promise<UploadSessionRow[]> {
    const r = await query<UploadSessionRow>(
        `SELECT * FROM media_upload_sessions
          WHERE user_id IS NOT DISTINCT FROM $1 AND status = 'uploading' AND expires_at > NOW()
          ORDER BY created_at DESC LIMIT $2`,
        [userId, limit,],
    );
    return r.rows;
}

export async function findById(id: string, client?: Runner,): Promise<UploadSessionRow | null> {
    const r = await run(client,)<UploadSessionRow>(`SELECT * FROM media_upload_sessions WHERE id = $1`, [id,],);
    return r.rows[0] ?? null;
}

export async function setMediaId(id: string, mediaId: string, client?: Runner,): Promise<void> {
    await run(client,)(`UPDATE media_upload_sessions SET media_id = $2 WHERE id = $1`, [id, mediaId,],);
}

export async function setStatus(
    id: string,
    status: UploadSessionRow['status'],
    mediaId: string | null = null,
    client?: Runner,
): Promise<void> {
    await run(client,)(
        `UPDATE media_upload_sessions SET status = $2, media_id = COALESCE($3, media_id), updated_at = NOW() WHERE id = $1`,
        [id, status, mediaId,],
    );
}

/** Uploading sessions past their expiry (the sweep's work list). */
export async function listExpired(limit = 500,): Promise<UploadSessionRow[]> {
    const r = await query<UploadSessionRow>(
        `SELECT * FROM media_upload_sessions WHERE status = 'uploading' AND expires_at < NOW()
          ORDER BY expires_at LIMIT $1`,
        [limit,],
    );
    return r.rows;
}

/** Flip uploading → completed (media_id is set once the media row exists).
 *  False when another request got there first. */
export async function markCompleted(id: string, client?: Runner,): Promise<boolean> {
    const r = await run(client,)(
        `UPDATE media_upload_sessions SET status = 'completed', updated_at = NOW()
          WHERE id = $1 AND status = 'uploading'`,
        [id,],
    );
    return (r.rowCount ?? 0) > 0;
}
