/**
 * The management side of video (staff): status, actions, access changes,
 * key rotation, and cleaning up storage when a video is deleted. Everything
 * here is available to any caller (routes, SDK, MCP, a future "Videos" page)
 * through the same functions.
 */
import type { MediaAccessLevel, MediaVideoInfo, VideoJobKind, } from '@sitesurge/types';
import { query, } from '../../db';
import { NotFoundError, ValidationError, } from '../../core/errors';
import { logger, } from '../../utils/logger';
import { logAudit, } from '../audit';
import { cache, } from '../cache';
import type { AuditContext, } from '../types';
import * as repo from '../../repositories/video.repo';
import { isObjectStore, resolveStorageProvider, } from '../storage';
import { mediaHead, } from './playback';
import { createKey, retireUnusedKeys, } from './keys';
import { fileUrl, masterUrl, mediaVideoRoot, teaserMasterUrl, } from './paths';
import { createShareToken, } from './share';

export async function info(id: string,): Promise<MediaVideoInfo> {
    const m = await mediaHead(id,);
    const video = await repo.getVideo(id,);
    if (!video) throw new NotFoundError('Video',);
    const [renditions, job,] = await Promise.all([repo.listRenditions(id,), repo.latestJob(id,),],);
    const hasTeaser = video.teaserEnabled && renditions.some((r,) => r.variant === 'teaser' && r.status === 'ready');
    return {
        mediaId: id,
        status: m.status,
        accessLevel: m.accessLevel,
        encrypted: video.encrypted,
        keyVersion: video.keyVersion,
        posterUrl: video.posterUrl,
        thumbnailsVtt: video.thumbnailsVtt,
        durationMs: m.durationMs,
        width: m.width,
        height: m.height,
        masterUrl: masterUrl(id,),
        teaserUrl: hasTeaser ? teaserMasterUrl(id,) : null,
        hasTeaser,
        teaserStartMs: video.teaserStartMs,
        teaserDurationMs: video.teaserDurationMs,
        hasOriginal: !!video.sourceKey,
        originalExpiresAt: video.originalExpiresAt,
        renditions: renditions.map(repo.toWireRendition,),
        job,
        progress: job?.progress ?? 0,
    };
}

async function audit(ctx: AuditContext, id: string, action: string, values?: Record<string, unknown>,) {
    await logAudit({
        userId: ctx.userId, action, entityType: 'media_video', entityId: id, newValues: values,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
}

export async function cancel(id: string, ctx: AuditContext,): Promise<MediaVideoInfo> {
    const job = await repo.requestCancel(id,);
    if (!job) throw new ValidationError('Nothing is running for this video.',);
    await audit(ctx, id, 'video_cancel',);
    return info(id,);
}

export async function retry(id: string, ctx: AuditContext,): Promise<MediaVideoInfo> {
    const video = await repo.getVideo(id,);
    if (!video) throw new NotFoundError('Video',);
    if (await repo.activeJob(id,)) throw new ValidationError('This video is already processing.',);
    const needsSource = (await repo.listRenditions(id, 'full',)).some((r,) => r.status !== 'ready');
    if (needsSource && !video.sourceKey) {
        throw new ValidationError('The original was deleted; re-upload the video to encode it again.',);
    }
    await repo.retryJob(id, ctx.userId ?? null,);
    await setMediaStatus(id, 'processing', true,);
    await audit(ctx, id, 'video_retry',);
    return info(id,);
}

export async function reencode(id: string, kind: VideoJobKind, ctx: AuditContext,): Promise<MediaVideoInfo> {
    const video = await repo.getVideo(id,);
    if (!video) throw new NotFoundError('Video',);
    if (await repo.activeJob(id,)) throw new ValidationError('This video is already processing.',);
    if (kind === 'encode') {
        if (!video.sourceKey) throw new ValidationError('The original was deleted; use Re-package or re-upload the video.',);
        // A full re-encode replaces every rendition; the worker writes a new
        // prefix, so drop the old rows (the objects go with the next cleanup).
        await repo.deleteRenditions(id,);
        await setMediaStatus(id, 'processing', false,);
    }
    await repo.enqueueJob(id, { kind, createdBy: ctx.userId ?? null, },);
    await cache.invalidateVideoCache(id,);
    await audit(ctx, id, `video_${kind}`,);
    return info(id,);
}

async function setMediaStatus(id: string, status: 'processing' | 'ready', onlyIfNotReady: boolean,): Promise<void> {
    await query(
        `UPDATE media SET status = $2, updated_at = NOW() WHERE id = $1 ${onlyIfNotReady ? `AND status <> 'ready'` : ''}`,
        [id, status,],
    );
}

export interface VideoPatch {
    accessLevel?: MediaAccessLevel;
    teaserEnabled?: boolean;
    teaserStartMs?: number;
    teaserDurationMs?: number;
    originalExpiresAt?: string | null;
}

/**
 * Per-video changes. An access change that flips encryption queues a cheap
 * RE-PACKAGE (the stored MP4s are re-segmented with or without the key) —
 * public → private must re-segment because plaintext segments may already be
 * cached or copied; private → public drops the key so the CDN copy is plain.
 * A teaser window change also re-packages (the teaser is cut from the MP4s).
 */
export async function update(id: string, patch: VideoPatch, ctx: AuditContext,): Promise<MediaVideoInfo> {
    const m = await mediaHead(id,);
    const video = await repo.getVideo(id,);
    if (!video) throw new NotFoundError('Video',);
    let repackage = false;

    if (patch.accessLevel && patch.accessLevel !== m.accessLevel) {
        await query(`UPDATE media SET access_level = $2, updated_at = NOW() WHERE id = $1`, [id, patch.accessLevel,],);
        repackage = video.encrypted !== (patch.accessLevel === 'private');
    }
    const teaserChanged = (patch.teaserEnabled !== undefined && patch.teaserEnabled !== video.teaserEnabled)
        || (patch.teaserStartMs !== undefined && patch.teaserStartMs !== video.teaserStartMs)
        || (patch.teaserDurationMs !== undefined && patch.teaserDurationMs !== video.teaserDurationMs);
    if (teaserChanged) {
        await repo.updateVideo(id, {
            teaserEnabled: patch.teaserEnabled,
            teaserStartMs: patch.teaserStartMs !== undefined ? Math.max(0, Math.round(patch.teaserStartMs,),) : undefined,
            teaserDurationMs: patch.teaserDurationMs !== undefined ? Math.max(1000, Math.round(patch.teaserDurationMs,),) : undefined,
            // A teaser that was off has no prefix yet.
            teaserPrefix: patch.teaserEnabled && !video.teaserPrefix ? `video/${id}/${video.encodeId}-teaser` : undefined,
        },);
        // Remove stale teaser rows; the job rebuilds them from the MP4s.
        await query(`DELETE FROM video_renditions WHERE media_id = $1 AND variant = 'teaser'`, [id,],);
        if (patch.teaserEnabled !== false) repackage = true;
    }
    if (patch.originalExpiresAt !== undefined && video.sourceKey) {
        await repo.updateVideo(id, { originalExpiresAt: patch.originalExpiresAt, },);
    }
    if (repackage && !(await repo.activeJob(id,))) {
        await repo.enqueueJob(id, { kind: 'repackage', createdBy: ctx.userId ?? null, },);
    }
    await cache.invalidateVideoCache(id,);
    await cache.invalidateMediaConsumersCache();
    await audit(ctx, id, 'video_update', patch as Record<string, unknown>,);
    return info(id,);
}

/** A time-limited link to the plain file that skips the access check. */
export async function share(id: string, days: number, ctx: AuditContext,): Promise<{ url: string; expiresAt: string; }> {
    await mediaHead(id,);
    const { token, expiresAt, } = createShareToken(id, days,);
    await audit(ctx, id, 'video_share', { expiresAt, },);
    return { url: `${fileUrl(id,)}?t=${token}`, expiresAt, };
}

/** New shared key; every private video still on an older key is re-packaged. */
export async function rotateKey(ctx: AuditContext,): Promise<{ version: number; repackageQueued: number; }> {
    const { version, } = await createKey();
    const ids = await repo.listVideosOnOtherKeys(version,);
    let queued = 0;
    for (const id of ids) {
        try {
            await repo.enqueueJob(id, { kind: 'repackage', createdBy: ctx.userId ?? null, priority: 200, },);
            queued++;
        } catch (e) {
            logger.warn('Could not queue re-package after key rotation', { mediaId: id, error: (e as Error).message, },);
        }
    }
    await retireUnusedKeys();
    await logAudit({
        userId: ctx.userId, action: 'video_key_rotate', entityType: 'video_keys', entityId: String(version,),
        newValues: { repackageQueued: queued, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return { version, repackageQueued: queued, };
}

/**
 * Storage cleanup for a deleted video: stop its job, then remove every object
 * it owns (renditions, teaser, downloads, poster, sprites, the original and an
 * unfinished upload). Called by `media.remove` BEFORE the row is deleted
 * (afterwards the paths are gone). Never throws — a storage hiccup must not
 * block deleting the row; leftovers sit under video/<id>/ and are harmless.
 */
export async function deleteVideoAssets(id: string,): Promise<void> {
    try {
        const video = await repo.getVideo(id,);
        if (!video) return;
        await repo.requestCancel(id,);
        // Give a running encoder a moment to notice and stop writing.
        for (let i = 0; i < 10 && await repo.activeJob(id,); i++) {
            await new Promise((r,) => setTimeout(r, 1000,));
        }
        const store = await resolveStorageProvider();
        if (!isObjectStore(store,)) return;
        await store.deletePrefix(mediaVideoRoot(id,),);
        await store.deletePrefix(`originals/${id}/`,);
        if (video.sourceKey) await store.deleteObject(video.sourceKey,).catch(() => undefined);
        await cache.invalidateVideoCache(id,);
    } catch (e) {
        logger.warn('Video storage cleanup failed', { mediaId: id, error: (e as Error).message, },);
    }
}
