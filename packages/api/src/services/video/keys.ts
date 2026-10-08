/**
 * Shared AES-128 keys for private videos.
 *
 * One CURRENT key encrypts every new private encode; its version is stored on
 * the video and baked into the playlist's key URI (`/media/hls-key/<v>`).
 * Rotating creates a new current version and queues a cheap re-package of
 * every private video still on an older one; an old version is retired (stops
 * being served) once no video uses it.
 *
 * Key bytes live only in `video_keys` and leave the server only through the
 * permission-gated key endpoint.
 */
import crypto from 'crypto';
import type { VideoKeyVersion, } from '@sitesurge/types';
import { query, } from '../../db';

export async function currentKey(): Promise<{ version: number; key: Buffer; }> {
    const r = await query<{ version: number; key_bytes: Buffer; }>(
        `SELECT version, key_bytes FROM video_keys WHERE retired_at IS NULL ORDER BY version DESC LIMIT 1`,
    );
    if (r.rows[0]) return { version: r.rows[0].version, key: r.rows[0].key_bytes, };
    return createKey();
}

export async function createKey(): Promise<{ version: number; key: Buffer; }> {
    const key = crypto.randomBytes(16,);
    const r = await query<{ version: number; }>(`INSERT INTO video_keys (key_bytes) VALUES ($1) RETURNING version`, [key,],);
    return { version: r.rows[0].version, key, };
}

/** Key bytes for a version, or null when unknown or retired. */
export async function keyBytes(version: number,): Promise<Buffer | null> {
    const r = await query<{ key_bytes: Buffer; }>(
        `SELECT key_bytes FROM video_keys WHERE version = $1 AND retired_at IS NULL`,
        [version,],
    );
    return r.rows[0]?.key_bytes ?? null;
}

export async function listKeys(): Promise<VideoKeyVersion[]> {
    const r = await query(
        `SELECT k.version, k.created_at, k.retired_at,
                (SELECT COUNT(*)::int FROM media_videos v WHERE v.encrypted AND v.key_version = k.version) AS video_count
           FROM video_keys k ORDER BY k.version DESC`,
    );
    const current = r.rows.find((x,) => !x.retired_at)?.version ?? null;
    return r.rows.map((x,) => ({
        version: x.version,
        createdAt: new Date(x.created_at,).toISOString(),
        retiredAt: x.retired_at ? new Date(x.retired_at,).toISOString() : null,
        videoCount: x.video_count,
        current: x.version === current,
    }));
}

/** Retire every non-current version no video uses any more. */
export async function retireUnusedKeys(): Promise<number> {
    const r = await query(
        `UPDATE video_keys k SET retired_at = NOW()
          WHERE retired_at IS NULL
            AND version < (SELECT MAX(version) FROM video_keys)
            AND NOT EXISTS (SELECT 1 FROM media_videos v WHERE v.encrypted AND v.key_version = k.version)`,
    );
    return r.rowCount ?? 0;
}

/** Random IV per video (hex, 32 chars) for `#EXT-X-KEY:IV=`. */
export const newIvHex = (): string => crypto.randomBytes(16,).toString('hex',);
