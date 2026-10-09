/**
 * Live-show recordings → the replay.
 *
 * Method `browser` (the only one implemented): the host page records its
 * camera with MediaRecorder and uploads EQUAL-SIZE parts (`LIVE_PART_SIZE`,
 * last part may be smaller — R2 refuses unequal parts) straight to object
 * storage with presigned URLs while live. `complete` assembles them, creates a
 * video `media` row and hands it to the video pipeline, which encodes the
 * replay; the post gets `type_settings.recordingMediaId`.
 *
 * `listParts` is the authority on what was uploaded (client ETags are never
 * trusted). Safety net: ending a show arms a 10-minute timer that finalizes a
 * forgotten recording, and a daily cron sweeps anything older.
 *
 * Method `server` (a WHEP recorder on our box) plugs in as another
 * `LiveRecorder`; until then it refuses with "not available yet".
 */
import crypto from 'crypto';
import path from 'path';
import type { LiveRecording, LiveRecordingMethod, Media, User, } from '@sitesurge/types';
import { NotFoundError, ValidationError, ConflictError, } from '../core/errors';
import { transaction, } from '../db';
import * as repo from '../repositories/liveRecordings.repo';
import type { LiveRecordingRow, } from '../repositories/liveRecordings.repo';
import { cache, } from './cache';
import { logAudit, } from './audit';
import { cronRegistry, } from './cron';
import { effectiveStatus, isLivePost, loadLivePost, } from './liveRooms/state';
import { getPostsSettings, } from './postSettings';
import { isFeatureEnabledServer, } from './settings';
import { isObjectStore, resolveStorageProvider, type ObjectStore, type UploadedPart, } from './storage';
import type { AuditContext, } from './types';
import { fileUrl, } from './video/paths';
import { registerVideo, } from './video/register';
import { logger, } from '../utils/logger';
import { mapRow, } from '../utils/mapRow';
import { uuidOrNull, } from '../utils/uuid';

/** 8 MiB: every part but the last must be exactly this size. */
export const LIVE_PART_SIZE = 8 * 1024 * 1024;
export const LIVE_PART_URL_TTL = 3600;
export const MAX_PART_NUMBER = 10_000;
/** After a show ends, how long the host gets to complete before the server does. */
export const AUTO_FINALIZE_DELAY_MS = 10 * 60_000;

const STORAGE_MSG = 'Live recording needs S3-compatible storage (Settings → Media → Storage).';

// ─── Recorders ────────────────────────────────────────────────────

export interface LiveRecorder {
    method: LiveRecordingMethod;
    /** Takes parts from the host browser (the start / part-url / complete endpoints). */
    browserUploads: boolean;
    /** Server-side recorders: begin capturing when the show goes live. */
    onShowStart?(postId: string,): Promise<void>;
    /** Server-side recorders: stop + hand the file to `completeFromKey`. */
    onShowEnd?(postId: string,): Promise<void>;
}

const browserRecorder: LiveRecorder = { method: 'browser', browserUploads: true, };

const serverRecorder: LiveRecorder = {
    method: 'server',
    browserUploads: false,
    onShowStart: () => Promise.reject(new Error('Server recording is not available yet',),),
    onShowEnd: () => Promise.reject(new Error('Server recording is not available yet',),),
};

const noneRecorder: LiveRecorder = { method: 'none', browserUploads: false, };

export function getRecorder(method: LiveRecordingMethod,): LiveRecorder {
    return method === 'server' ? serverRecorder : method === 'none' ? noneRecorder : browserRecorder;
}

/** The active provider's `recordingMethod` (default `browser`). */
export async function recordingMethod(): Promise<LiveRecordingMethod> {
    const s = await getPostsSettings();
    const v = s.live.provider ? s.live.providers[s.live.provider]?.recordingMethod : undefined;
    return v === 'server' || v === 'none' ? v : 'browser';
}

// ─── Helpers ──────────────────────────────────────────────────────

async function store(): Promise<ObjectStore> {
    const p = await resolveStorageProvider();
    if (!isObjectStore(p,)) throw new ValidationError(STORAGE_MSG,);
    return p;
}

async function quietly(fn: () => Promise<unknown>,): Promise<void> {
    try {
        await fn();
    } catch (e) {
        logger.warn('Live recording cleanup step failed', { error: (e as Error).message, },);
    }
}

const iso = (d: Date | string,): string => (d instanceof Date ? d : new Date(d,)).toISOString();

/** `video/webm;codecs=vp9,opus` → `video/webm`. */
export const baseMime = (mime: string,): string => mime.split(';',)[0]!.trim().toLowerCase();

export function extForMime(mime: string,): string {
    const b = baseMime(mime,);
    if (b === 'video/webm' || b === 'audio/webm') return 'webm';
    if (b === 'video/mp4' || b === 'audio/mp4') return 'mp4';
    if (b === 'video/x-matroska') return 'mkv';
    if (b === 'video/quicktime') return 'mov';
    return 'bin';
}

export function toRecording(row: LiveRecordingRow, parts: UploadedPart[] = [],): LiveRecording {
    return {
        id: row.id,
        postId: row.post_id,
        status: row.status,
        mimeType: row.mime_type,
        partSize: Number(row.part_size,),
        uploadedParts: parts.map((p,) => p.partNumber).sort((a, b,) => a - b),
        uploadedBytes: parts.reduce((s, p,) => s + (Number(p.size,) || 0), 0,),
        mediaId: row.media_id,
        error: row.error,
        createdAt: iso(row.created_at,),
        updatedAt: iso(row.updated_at,),
    };
}

async function safeListParts(s: ObjectStore, row: LiveRecordingRow,): Promise<UploadedPart[]> {
    try {
        return await s.listParts(row.object_key, row.upload_id,);
    } catch (e) {
        logger.warn('Live recording listParts failed', { recordingId: row.id, error: (e as Error).message, },);
        return [];
    }
}

async function loadShow(postId: string,) {
    const row = await loadLivePost(postId,);
    if (!row || !isLivePost(row,)) throw new NotFoundError('Live show',);
    return row;
}

async function loadRecording(postId: string, recordingId: string,): Promise<LiveRecordingRow> {
    const row = await repo.findById(recordingId,);
    if (!row || row.post_id !== postId) throw new NotFoundError('Recording',);
    return row;
}

// ─── Host API ─────────────────────────────────────────────────────

/** GET /posts/:id/live/recording — the open recording, else the latest, else null. */
export async function current(postId: string,): Promise<LiveRecording | null> {
    await loadShow(postId,);
    const row = await repo.findOpen(postId,) ?? await repo.findLatest(postId,);
    if (!row) return null;
    if (row.status !== 'recording') return toRecording(row,);
    return toRecording(row, await safeListParts(await store(), row,),);
}

/** POST /posts/:id/live/recording — resume the show's open recording, else start one. */
export async function start(postId: string, mimeType: unknown, user: Pick<User, 'id'> | undefined, ctx: AuditContext,): Promise<LiveRecording> {
    const mime = typeof mimeType === 'string' ? mimeType.trim() : '';
    if (!mime) throw new ValidationError('mimeType is required',);
    if (mime.length > 128 || !/^(video|audio)\/[\w.+-]+(\s*;.*)?$/i.test(mime,)) throw new ValidationError('mimeType must be a video/* MediaRecorder type',);

    const show = await loadShow(postId,);
    if (effectiveStatus(show,) === 'ended') throw new ConflictError('This show has ended', { code: 'ended', },);
    if (show.typeSettings.archiveVideo === false) throw new ValidationError('Recording is off for this show (Archive video)',);

    const method = await recordingMethod();
    const recorder = getRecorder(method,);
    if (!recorder.browserUploads) {
        throw new ValidationError(method === 'none'
            ? 'Recording is turned off in the live provider settings'
            : 'Server recording is not available yet',);
    }

    const s = await store();
    const open = await repo.findOpen(postId,);
    if (open) return toRecording(open, await safeListParts(s, open,),);

    const id = crypto.randomUUID();
    const objectKey = `incoming/live/${postId}/${id}.${extForMime(mime,)}`;
    const uploadId = await s.createMultipart(objectKey, baseMime(mime,),);
    let row: LiveRecordingRow;
    try {
        row = await repo.insert({
            id, postId, userId: uuidOrNull(user?.id,), method, mimeType: mime, objectKey, uploadId, partSize: LIVE_PART_SIZE,
        },);
    } catch (e) {
        await quietly(() => s.abortMultipart(objectKey, uploadId,));
        // Lost a race with another tab: the unique "one open per show" index fired.
        const raced = await repo.findOpen(postId,);
        if (raced) return toRecording(raced, await safeListParts(s, raced,),);
        throw e;
    }
    await logAudit({
        userId: ctx.userId, action: 'create', entityType: 'live_recording', entityId: id,
        newValues: { postId, method, mimeType: mime, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return toRecording(row, [],);
}

/** POST /posts/:id/live/recording/:rid/part-url — a presigned PUT for one part. */
export async function partUrl(postId: string, recordingId: string, partNumber: unknown,): Promise<{ url: string; expiresIn: number; }> {
    const n = Number(partNumber,);
    if (!Number.isInteger(n,) || n < 1 || n > MAX_PART_NUMBER) {
        throw new ValidationError(`partNumber must be an integer 1–${MAX_PART_NUMBER}`,);
    }
    const row = await loadRecording(postId, recordingId,);
    if (row.status !== 'recording') throw new ValidationError(`Recording is ${row.status}`,);
    const s = await store();
    return { url: await s.presignPart(row.object_key, row.upload_id, n, LIVE_PART_URL_TTL,), expiresIn: LIVE_PART_URL_TTL, };
}

/** POST /posts/:id/live/recording/:rid/complete */
export async function complete(postId: string, recordingId: string, ctx: AuditContext | null,): Promise<LiveRecording> {
    const row = await loadRecording(postId, recordingId,);
    if (row.status === 'completed') return toRecording(row,);
    return finalize(row, ctx,);
}

/** DELETE /posts/:id/live/recording/:rid — discard. */
export async function abort(postId: string, recordingId: string, ctx: AuditContext | null,): Promise<{ message: string; }> {
    const row = await loadRecording(postId, recordingId,);
    if (row.status !== 'recording') return { message: `Recording is ${row.status}`, };
    await abortRow(row,);
    if (ctx) {
        await logAudit({
            userId: ctx.userId, action: 'delete', entityType: 'live_recording', entityId: row.id,
            newValues: { postId, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        },);
    }
    return { message: 'Recording discarded', };
}

async function abortRow(row: LiveRecordingRow,): Promise<void> {
    try {
        const s = await store();
        await s.abortMultipart(row.object_key, row.upload_id,);
    } catch (e) {
        logger.warn('Live recording abortMultipart failed', { recordingId: row.id, error: (e as Error).message, },);
    }
    await repo.transition(row.id, 'recording', 'aborted',);
}

// ─── Finalize ─────────────────────────────────────────────────────

/**
 * recording → finalizing (atomic, so the host and the safety net cannot both
 * run it) → assemble → media + replay encode → completed. A failure before
 * the multipart is assembled returns the row to `recording` (retryable);
 * after it, the row is `failed` with the error.
 */
async function finalize(row: LiveRecordingRow, ctx: AuditContext | null,): Promise<LiveRecording> {
    const s = await store();
    const claimed = await repo.transition(row.id, 'recording', 'finalizing',);
    if (!claimed) {
        const now = await repo.findById(row.id,);
        if (now?.status === 'completed') return toRecording(now,);
        throw new ConflictError(`Recording is ${now?.status ?? 'gone'}`,);
    }

    let parts: UploadedPart[];
    try {
        parts = (await s.listParts(row.object_key, row.upload_id,))
            .filter((p,) => p.partNumber >= 1 && p.partNumber <= MAX_PART_NUMBER)
            .sort((a, b,) => a.partNumber - b.partNumber);
        if (parts.length === 0) throw new ValidationError('Nothing was recorded yet (no parts uploaded)',);
        await s.completeMultipart(row.object_key, row.upload_id, parts,);
    } catch (e) {
        await repo.transition(row.id, 'finalizing', 'recording',);
        throw e;
    }

    try {
        const head = await s.head(row.object_key,);
        const size = Number(head?.size ?? parts.reduce((t, p,) => t + (Number(p.size,) || 0), 0,),);
        const show = await loadLivePost(row.post_id,);
        const title = `${show?.title || 'Live show'} — live recording`;
        const accessLevel = show?.requiredTierId ? 'private' : 'public';
        const videoOn = await isFeatureEnabledServer('video',);
        const mime = baseMime(row.mime_type,);
        const mediaId = crypto.randomUUID();
        const filename = path.posix.basename(row.object_key,);
        const url = videoOn ? fileUrl(mediaId,) : s.publicUrl(row.object_key,);
        const uploadedBy = uuidOrNull(ctx?.userId,) ?? row.user_id;

        const inserted = await transaction(async (client,) => {
            const r = await client.query(
                `INSERT INTO media (id, filename, original_name, mime_type, size, url, thumbnail_url,
                                    title, uploaded_by, status, access_level, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, NOW())
                 RETURNING *`,
                [
                    mediaId, filename, `${show?.slug || 'live'}-recording.${extForMime(mime,)}`, mime, size, url,
                    title, uploadedBy, videoOn ? 'processing' : 'ready', accessLevel,
                ],
            );
            if (videoOn) {
                await registerVideo({
                    mediaId, sourceKey: row.object_key, sourceSize: size, accessLevel, createdBy: uploadedBy,
                }, client,);
            }
            await client.query(
                `UPDATE posts SET type_settings = COALESCE(type_settings, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
                [row.post_id, JSON.stringify({ recordingMediaId: mediaId, },),],
            );
            const done = await repo.transition(row.id, 'finalizing', 'completed', { mediaId, error: null, }, client,);
            if (!done) throw new ConflictError('Recording changed while finalizing',);
            return { media: r.rows[0] as Record<string, unknown>, rec: done, };
        },);

        await cache.invalidatePostCache(row.post_id,);
        await cache.invalidateMediaConsumersCache();
        if (!videoOn) logger.info('Live recording stored as a plain file (video feature off — no replay encode)', { recordingId: row.id, mediaId, },);
        const media = mapRow<Media>(inserted.media,);
        await logAudit({
            userId: ctx?.userId ?? 'system', action: 'update', entityType: 'live_recording', entityId: row.id,
            newValues: { postId: row.post_id, mediaId: media.id, size, parts: parts.length, encoded: videoOn, },
            ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
        },);
        return toRecording(inserted.rec, parts,);
    } catch (e) {
        const msg = (e as Error).message;
        logger.error('Live recording finalize failed', { recordingId: row.id, error: msg, },);
        await repo.transition(row.id, 'finalizing', 'failed', { error: msg.slice(0, 2000,), },);
        throw e;
    }
}

/**
 * Safety net for one recording: complete it when it has parts, abort it when
 * it has none. Never throws.
 */
export async function autoFinalize(row: LiveRecordingRow,): Promise<'completed' | 'aborted' | 'skipped'> {
    try {
        if (row.status === 'finalizing') {
            await repo.transition(row.id, 'finalizing', 'failed', { error: 'Finalizing never finished', },);
            return 'skipped';
        }
        if (row.status !== 'recording') return 'skipped';
        const s = await store();
        const parts = await safeListParts(s, row,);
        if (parts.length === 0) {
            await abortRow(row,);
            return 'aborted';
        }
        await finalize(row, null,);
        return 'completed';
    } catch (e) {
        logger.warn('Live recording auto-finalize failed', { recordingId: row.id, error: (e as Error).message, },);
        return 'skipped';
    }
}

const timers = new Map<string, NodeJS.Timeout>();

/** Arm (once per show) the post-show finalize. In-process; the daily cron covers a restart. */
export function scheduleAutoFinalize(postId: string, delayMs = AUTO_FINALIZE_DELAY_MS,): void {
    if (timers.has(postId,)) return;
    const t = setTimeout(() => {
        timers.delete(postId,);
        void (async () => {
            const open = await repo.findOpen(postId,).catch(() => null);
            if (open) await autoFinalize(open,);
        })();
    }, delayMs,);
    t.unref?.();
    timers.set(postId, t,);
}

/** Test-only. */
export function _clearTimers(): void {
    for (const t of timers.values()) clearTimeout(t,);
    timers.clear();
}

/** Daily sweep: recordings left open > 6 h after their show ended (or > 24 h regardless). */
export async function sweepStaleRecordings(): Promise<number> {
    const rows = await repo.listStale(6, 24,);
    let n = 0;
    for (const row of rows) if ((await autoFinalize(row,)) !== 'skipped') n++;
    if (n > 0) logger.info('Live recordings swept', { count: n, },);
    return n;
}

export function initLiveRecordingCron(): void {
    cronRegistry.register({
        name: 'live-recordings',
        schedule: '41 4 * * *',
        description: 'Complete (or abort) live-show recordings the host never finished',
        handler: async () => {
            try {
                await sweepStaleRecordings();
            } catch (err) {
                logger.error('Live recording sweep failed', { error: err, },);
            }
        },
    },);
}
