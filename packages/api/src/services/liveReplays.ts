/**
 * A live show's saved recordings ("versions") and their lifecycle:
 * list / choose the one shown on the post / delete one (removing every file
 * from storage + CDN) / restart an ended show to record a new version — plus
 * the purge that runs when a post is PERMANENTLY deleted.
 *
 * Versions live in `posts.type_settings.recordingVersions`; the shown one is
 * `recordingMediaId`. Deleting the shown one leaves the post in place with
 * `recordingRemovedAt` set, so the page says "Video has been removed."
 */
import type { LiveRecordingVersion, } from '@sitesurge/types';
import { query, transaction, } from '../db';
import { ConflictError, NotFoundError, } from '../core/errors';
import { logger, } from '../utils/logger';
import { logAudit, } from './audit';
import { cache, } from './cache';
import * as media from './media';
import { findMediaUsage, } from './mediaUsage';
import type { AuditContext, } from './types';

interface Versioned {
    id: string;
    post_type: string;
    live_ended_at: string | null;
    type_settings: {
        recordingMediaId?: string | null;
        recordingVersions?: { mediaId: string; recordedAt: string; recordingId?: string; }[];
        recordingRemovedAt?: string | null;
        providerInputId?: string | null;
    } | null;
}

async function loadPost(postId: string,): Promise<Versioned> {
    const r = await query<Versioned>(
        `SELECT id, post_type, live_ended_at, type_settings FROM posts WHERE id = $1`,
        [postId,],
    );
    if (!r.rows[0]) throw new NotFoundError('Post',);
    return r.rows[0];
}

/** Versions incl. any recording that predates the versions list. */
function versionsOf(p: Versioned,): { mediaId: string; recordedAt: string; }[] {
    const ts = p.type_settings ?? {};
    const list = [...(ts.recordingVersions ?? []),];
    if (ts.recordingMediaId && !list.some((v,) => v.mediaId === ts.recordingMediaId)) {
        list.push({ mediaId: ts.recordingMediaId, recordedAt: p.live_ended_at ?? new Date().toISOString(), },);
    }
    return list;
}

export async function listVersions(postId: string,): Promise<LiveRecordingVersion[]> {
    const p = await loadPost(postId,);
    const list = versionsOf(p,);
    if (list.length === 0) return [];
    const r = await query<{ id: string; title: string | null; original_name: string; status: string; duration_ms: number | null; size: string | null; thumbnail_url: string | null; }>(
        `SELECT id, title, original_name, status, duration_ms, size, thumbnail_url FROM media WHERE id = ANY($1::uuid[])`,
        [list.map((v,) => v.mediaId),],
    );
    const byId = new Map(r.rows.map((m,) => [m.id, m,]),);
    const current = p.type_settings?.recordingMediaId ?? null;
    return list.map((v,) => {
        const m = byId.get(v.mediaId,);
        return {
            mediaId: v.mediaId,
            recordedAt: safeIso(v.recordedAt,),
            current: v.mediaId === current,
            title: m ? (m.title || m.original_name) : null,
            status: (m ? m.status : 'missing') as LiveRecordingVersion['status'],
            durationMs: m?.duration_ms ?? null,
            size: m?.size ? Number(m.size,) : null,
            posterUrl: m?.thumbnail_url ?? null,
        };
    },).reverse(); // newest first
}

function safeIso(v: unknown,): string {
    const d = new Date(String(v ?? '',),);
    return Number.isNaN(d.getTime(),) ? new Date(0,).toISOString() : d.toISOString();
}

async function writeSettings(postId: string, patch: Record<string, unknown>,): Promise<void> {
    await query(
        `UPDATE posts SET type_settings = COALESCE(type_settings, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
        [postId, JSON.stringify(patch,),],
    );
    await cache.invalidatePostCache(postId,);
}

/** Show this version as the post's replay. */
export async function selectVersion(postId: string, mediaId: string, ctx: AuditContext,): Promise<LiveRecordingVersion[]> {
    const p = await loadPost(postId,);
    if (!versionsOf(p,).some((v,) => v.mediaId === mediaId)) throw new NotFoundError('Recording',);
    await writeSettings(postId, { recordingMediaId: mediaId, recordingRemovedAt: null, },);
    await audit(ctx, postId, 'live_recording_select', { mediaId, },);
    return listVersions(postId,);
}

/**
 * Where else is each media item used — every usage EXCEPT this post's own
 * (its recording settings and its blocks). Shared "in use" scan
 * (`mediaUsage.findMediaUsage`): pages, other posts, gallery items, mail and
 * block templates, entity media fields, products, settings, …
 */
export async function usedElsewhere(mediaIds: string[], postId: string,): Promise<Set<string>> {
    const usage = await findMediaUsage(mediaIds,);
    const out = new Set<string>();
    for (const [id, list,] of Object.entries(usage,)) {
        if (list.some((u,) => !(u.kind === 'post' && u.id === postId))) out.add(id,);
    }
    return out;
}

/**
 * Delete one version. The post's list is updated under a row lock (so a
 * recording completing at the same moment — `liveRecordings.complete`, which
 * appends under the same lock — is never lost), THEN the media item and every
 * stored file of it (original, quick replay, HLS rungs, teaser, downloads,
 * poster) are removed — unless something else still uses it, in which case it
 * is only removed from this post. Removing the shown one leaves no replay.
 */
export async function deleteVersion(postId: string, mediaId: string, ctx: AuditContext,): Promise<LiveRecordingVersion[]> {
    const wasCurrent = await transaction(async (client,) => {
        const r = await client.query<Versioned>(
            `SELECT id, post_type, live_ended_at, type_settings FROM posts WHERE id = $1 FOR UPDATE`, [postId,],
        );
        const p = r.rows[0];
        if (!p) throw new NotFoundError('Post',);
        const list = versionsOf(p,);
        if (!list.some((v,) => v.mediaId === mediaId)) throw new NotFoundError('Recording',);
        const current = p.type_settings?.recordingMediaId === mediaId;
        const patch = {
            recordingVersions: list.filter((v,) => v.mediaId !== mediaId),
            ...(current ? { recordingMediaId: null, recordingRemovedAt: new Date().toISOString(), } : {}),
        };
        await client.query(
            `UPDATE posts SET type_settings = COALESCE(type_settings, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
            [postId, JSON.stringify(patch,),],
        );
        return current;
    },);
    await cache.invalidatePostCache(postId,);

    const keep = (await usedElsewhere([mediaId,], postId,).catch(() => new Set([mediaId,],))).has(mediaId,);
    if (!keep) {
        await media.remove(mediaId, ctx,).catch((e: unknown,) => {
            // Already gone from the library: the post no longer lists it either.
            if (!(e instanceof NotFoundError)) throw e;
        },);
    }
    await audit(ctx, postId, 'live_recording_delete', { mediaId, wasCurrent, fileKept: keep, },);
    return listVersions(postId,);
}

/**
 * Re-open an ENDED show so it can go live again and record a new version.
 * The saved recordings stay (the new one becomes the shown replay when it
 * completes); the provider input was deleted at the end, so a fresh one is
 * created on the next Go live.
 */
export async function restartShow(postId: string, ctx: AuditContext,): Promise<void> {
    const p = await loadPost(postId,);
    if (p.post_type !== 'live') throw new ConflictError('Only a Live Show can be restarted.',);
    if (!p.live_ended_at) throw new ConflictError('This show has not ended.',);
    await query(
        `UPDATE posts SET live_ended_at = NULL, live_started_at = NULL, live_status = 'idle',
                type_settings = COALESCE(type_settings, '{}'::jsonb) - 'providerInputId',
                updated_at = NOW()
          WHERE id = $1`,
        [postId,],
    );
    await cache.invalidatePostCache(postId,);
    await audit(ctx, postId, 'live_restart', {},);
}

/**
 * Permanent post deletion: remove the post's videos from storage + CDN —
 * every live recording version, every recording row's media, and the media of
 * its Video blocks — unless another post or page still uses that media item.
 * Never throws: a storage hiccup must not block deleting the post.
 */
export async function purgePostMedia(postId: string, ctx: AuditContext,): Promise<{ removed: string[]; kept: string[]; }> {
    const removed: string[] = [];
    const kept: string[] = [];
    try {
        const p = await loadPost(postId,).catch(() => null);
        const ids = new Set<string>(p ? versionsOf(p,).map((v,) => v.mediaId) : [],);
        const rec = await query<{ media_id: string; }>(
            `SELECT media_id FROM live_recordings WHERE post_id = $1 AND media_id IS NOT NULL`, [postId,],
        ).catch(() => ({ rows: [], }));
        for (const r of rec.rows) ids.add(r.media_id,);
        const blocks = await query<{ media_id: string; }>(
            `SELECT data->>'mediaId' AS media_id FROM post_content_blocks
              WHERE post_id = $1 AND type = 'video' AND COALESCE(data->>'mediaId', '') <> ''`, [postId,],
        );
        for (const r of blocks.rows) ids.add(r.media_id,);
        // Abort any open browser-recording upload (its parts are not media yet).
        const open = await query<{ id: string; }>(
            `SELECT id FROM live_recordings WHERE post_id = $1 AND status = 'recording'`, [postId,],
        ).catch(() => ({ rows: [], }));
        if (open.rows.length) {
            const { abort, } = await import('./liveRecordings.js');
            for (const r of open.rows) await abort(postId, r.id, ctx,).catch(() => undefined);
        }

        const valid = [...ids,].filter((id,) => /^[0-9a-f-]{36}$/i.test(id,),);
        // Kept when anything other than THIS post still uses it — the shared
        // scan covers galleries, templates, entity fields, other posts, pages…
        // A scan failure keeps everything (never delete on doubt).
        const shared = valid.length ? await usedElsewhere(valid, postId,).catch(() => new Set(valid,)) : new Set<string>();
        for (const id of valid) {
            if (shared.has(id,)) {
                kept.push(id,);
                continue;
            }
            await media.remove(id, ctx,).then(() => removed.push(id,),).catch((e: unknown,) => {
                if (!(e instanceof NotFoundError)) logger.warn('Post media purge failed', { postId, mediaId: id, error: (e as Error).message, },);
            },);
        }
    } catch (e) {
        logger.warn('Post media purge skipped', { postId, error: (e as Error).message, },);
    }
    return { removed, kept, };
}

async function audit(ctx: AuditContext, postId: string, action: string, values: Record<string, unknown>,) {
    await logAudit({
        userId: ctx.userId, action, entityType: 'post', entityId: postId, newValues: values,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
}
