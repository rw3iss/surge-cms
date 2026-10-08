/**
 * The few `media` / rendition writes the video encoder needs beyond
 * `video.repo.ts`: the media row's probe facts, status and thumbnail, and
 * bulk rendition resets.
 */
import type { PoolClient, } from 'pg';
import type { MediaAccessLevel, MediaStatus, VideoVariant, } from '@sitesurge/types';
import { query, } from '../db';

type Db = Pick<PoolClient, 'query'>;
const db = (c?: Db,): Db => c ?? { query: query as unknown as Db['query'], };

export interface MediaVideoFacts {
    id: string;
    filename: string;
    originalName: string;
    accessLevel: MediaAccessLevel;
    status: MediaStatus;
    durationMs: number | null;
}

export async function getMediaFacts(mediaId: string,): Promise<MediaVideoFacts | null> {
    const r = await query(
        `SELECT id, filename, original_name, access_level, status, duration_ms FROM media WHERE id = $1`,
        [mediaId,],
    );
    const m = r.rows[0];
    if (!m) return null;
    return {
        id: m.id,
        filename: m.filename,
        originalName: m.original_name,
        accessLevel: m.access_level === 'private' ? 'private' : 'public',
        status: m.status,
        durationMs: m.duration_ms === null ? null : Number(m.duration_ms,),
    };
}

export async function setMediaProbe(mediaId: string, p: { width: number; height: number; durationMs: number; },): Promise<void> {
    await query(
        `UPDATE media SET width = $2, height = $3, duration_ms = $4, updated_at = NOW() WHERE id = $1`,
        [mediaId, p.width, p.height, p.durationMs,],
    );
}

export async function setMediaStatus(mediaId: string, status: MediaStatus,): Promise<void> {
    await query(`UPDATE media SET status = $2, updated_at = NOW() WHERE id = $1 AND status <> $2`, [mediaId, status,],);
}

export async function setMediaThumbnail(mediaId: string, url: string,): Promise<void> {
    await query(`UPDATE media SET thumbnail_url = $2, updated_at = NOW() WHERE id = $1`, [mediaId, url,],);
}

/** Any FULL rendition playable? */
export async function hasReadyFull(mediaId: string,): Promise<boolean> {
    const r = await query(
        `SELECT 1 FROM video_renditions WHERE media_id = $1 AND variant = 'full' AND status = 'ready' LIMIT 1`,
        [mediaId,],
    );
    return (r.rowCount ?? 0) > 0;
}

/** Back to `queued` (incl. ready ones) — the rows will be rebuilt to a new prefix. */
export async function resetRenditions(mediaId: string, variant: VideoVariant, c?: Db,): Promise<void> {
    await db(c,).query(
        `UPDATE video_renditions SET status = 'queued', progress = 0, error = NULL, playlist_path = NULL, bytes = NULL,
                download_path = NULL, download_bytes = NULL, started_at = NULL, finished_at = NULL
          WHERE media_id = $1 AND variant = $2`,
        [mediaId, variant,],
    );
}

/** A stopped job's half-done renditions read as waiting, not as running. */
export async function resetInFlightRenditions(mediaId: string,): Promise<void> {
    await query(
        `UPDATE video_renditions SET status = 'queued', progress = 0
          WHERE media_id = $1 AND status IN ('encoding', 'uploading')`,
        [mediaId,],
    );
}
