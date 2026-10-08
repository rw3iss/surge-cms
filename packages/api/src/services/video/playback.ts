/**
 * The read side of video: what a player gets (`playback`), the master
 * playlists built from the DB (`masterPlaylist`), the key endpoint and
 * downloads.
 *
 * Masking: the full video's master URL — and with it the secret storage path —
 * is handed out only to viewers who may watch it. Everyone else gets the
 * teaser. The full master itself re-checks access on every request, so a
 * leaked API URL is worthless without the permission; segments of private
 * videos are encrypted anyway.
 */
import type { MediaAccessLevel, MediaPlayback, MediaStatus, VideoDownloadOption, VideoVariant, } from '@sitesurge/types';
import { query, } from '../../db';
import { ForbiddenError, NotFoundError, } from '../../core/errors';
import { cache, CACHE_KEYS, } from '../cache';
import * as repo from '../../repositories/video.repo';
import { resolveStorageProvider, isObjectStore, } from '../storage';
import { canWatchFull, type Viewer, } from './access';
import { keyBytes, } from './keys';
import { downloadUrl, masterUrl, teaserMasterUrl, watchUrl, } from './paths';
import { verifyShareToken, } from './share';
import { getVideoSettings, } from './settings';

interface MediaHead {
    id: string;
    title: string | null;
    originalName: string;
    mimeType: string;
    url: string;
    thumbnailUrl: string | null;
    status: MediaStatus;
    accessLevel: MediaAccessLevel;
    width: number | null;
    height: number | null;
    durationMs: number | null;
}

/** Only the public-safe columns — never SELECT *. */
export async function mediaHead(id: string,): Promise<MediaHead> {
    if (!/^[0-9a-f-]{36}$/i.test(id,)) throw new NotFoundError('Media',);
    const r = await query(
        `SELECT id, title, original_name, mime_type, url, thumbnail_url, status, access_level, width, height, duration_ms
           FROM media WHERE id = $1`,
        [id,],
    );
    const m = r.rows[0];
    if (!m) throw new NotFoundError('Media',);
    return {
        id: m.id, title: m.title ?? null, originalName: m.original_name, mimeType: m.mime_type, url: m.url,
        thumbnailUrl: m.thumbnail_url ?? null, status: m.status, accessLevel: m.access_level,
        width: m.width ?? null, height: m.height ?? null, durationMs: m.duration_ms ?? null,
    };
}

export async function playback(id: string, viewer: Viewer | null | undefined,): Promise<MediaPlayback> {
    const m = await mediaHead(id,);
    const video = await repo.getVideo(id,).catch(() => null);
    const base: MediaPlayback = {
        mediaId: m.id,
        status: m.status,
        accessLevel: m.accessLevel,
        title: m.title || m.originalName,
        posterUrl: m.thumbnailUrl,
        thumbnailsVtt: null,
        durationMs: m.durationMs,
        width: m.width,
        height: m.height,
        src: null,
        teaserSrc: null,
        teaserDurationMs: null,
        fileSrc: null,
        fileType: null,
        qualities: [],
        downloads: [],
        access: { full: false, reason: null, },
    };

    // Not an encoded video: a plain file (old-style MP4/WebM upload, audio…).
    if (!video) {
        const full = await canWatchFull(m.accessLevel, viewer,);
        return {
            ...base,
            fileSrc: full ? m.url : null,
            fileType: m.mimeType,
            access: { full, reason: full ? 'ok' : 'private', },
        };
    }

    const renditions = await repo.listRenditions(id,);
    const readyFull = renditions.filter((r,) => r.variant === 'full' && r.status === 'ready');
    const readyTeaser = renditions.filter((r,) => r.variant === 'teaser' && r.status === 'ready');
    const full = await canWatchFull(m.accessLevel, viewer,);
    const settings = await getVideoSettings();

    const downloads: VideoDownloadOption[] = full && settings.downloadsEnabled
        ? readyFull
            .filter((r,) => r.downloadPath)
            .sort((a, b,) => (b.height ?? 0) - (a.height ?? 0))
            .map((r,) => ({ quality: r.name, height: r.height, bytes: r.downloadBytes, url: downloadUrl(id, r.name,), }))
        : [];

    return {
        ...base,
        posterUrl: video.posterUrl ?? m.thumbnailUrl,
        thumbnailsVtt: full ? video.thumbnailsVtt : null,
        src: full && readyFull.length > 0 ? masterUrl(id,) : null,
        teaserSrc: video.teaserEnabled && readyTeaser.length > 0 ? teaserMasterUrl(id,) : null,
        teaserDurationMs: video.teaserEnabled && readyTeaser.length > 0
            ? Math.min(video.teaserDurationMs, Math.max(0, (m.durationMs ?? video.teaserDurationMs) - video.teaserStartMs,),)
            : null,
        qualities: full ? readyFull.sort((a, b,) => (b.height ?? 0) - (a.height ?? 0)).map((r,) => r.name) : [],
        downloads,
        access: { full, reason: !full ? 'private' : readyFull.length === 0 ? 'not_ready' : 'ok', },
    };
}

export interface MasterResult {
    body: string;
    /** Still encoding → short cache. */
    active: boolean;
    /** Private full video → never shared-cached. */
    personal: boolean;
}

/** Build (or read from Redis) a master playlist listing READY renditions. */
export async function masterPlaylist(id: string, variant: VideoVariant, viewer: Viewer | null | undefined,): Promise<MasterResult> {
    const m = await mediaHead(id,);
    const personal = variant === 'full' && m.accessLevel === 'private';
    if (variant === 'full' && !(await canWatchFull(m.accessLevel, viewer,))) {
        throw new ForbiddenError('This video is for subscribers.',);
    }
    const key = CACHE_KEYS.videoMaster(id, variant,);
    const cached = await cache.get<MasterResult>(key,);
    if (cached) return { ...cached, personal, };

    const video = await repo.getVideo(id,);
    if (!video) throw new NotFoundError('Video',);
    if (variant === 'teaser' && !video.teaserEnabled) throw new NotFoundError('Teaser',);
    const store = await resolveStorageProvider();
    if (!isObjectStore(store,)) throw new NotFoundError('Video',);

    const ready = (await repo.listRenditions(id, variant,))
        .filter((r,) => r.status === 'ready' && r.playlistPath)
        .sort((a, b,) => (b.height ?? 0) - (a.height ?? 0));
    if (ready.length === 0) {
        const err = new NotFoundError('Video',);
        (err as { code: string; }).code = 'VIDEO_NOT_READY';
        throw err;
    }
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS',];
    for (const r of ready) {
        const attrs = [`BANDWIDTH=${r.bandwidth ?? 1_000_000}`,];
        if (r.avgBandwidth) attrs.push(`AVERAGE-BANDWIDTH=${r.avgBandwidth}`,);
        if (r.width && r.height) attrs.push(`RESOLUTION=${r.width}x${r.height}`,);
        if (r.codecs) attrs.push(`CODECS="${r.codecs}"`,);
        attrs.push(`NAME="${r.name}"`,);
        lines.push(`#EXT-X-STREAM-INF:${attrs.join(',',)}`, store.publicUrl(r.playlistPath!,),);
    }
    const job = await repo.activeJob(id,);
    const result: MasterResult = { body: lines.join('\n',) + '\n', active: !!job, personal, };
    await cache.set(key, result, job ? 10 : 3600,);
    return result;
}

export function masterCacheControl(r: MasterResult,): string {
    if (r.personal) return 'private, no-store';
    return r.active ? 'public, max-age=10, s-maxage=10' : 'public, max-age=300, s-maxage=86400';
}

/** 16 raw key bytes for a permitted viewer. */
export async function hlsKey(version: number, viewer: Viewer | null | undefined,): Promise<Buffer> {
    if (!(await canWatchFull('private', viewer,))) throw new ForbiddenError('This video is for subscribers.',);
    const bytes = await keyBytes(version,);
    if (!bytes) throw new NotFoundError('Key',);
    return bytes;
}

/** Short-lived signed URL for a per-quality MP4 download. */
export async function downloadLink(id: string, quality: string | undefined, viewer: Viewer | null | undefined,): Promise<string> {
    const m = await mediaHead(id,);
    if (!(await canWatchFull(m.accessLevel, viewer,))) throw new ForbiddenError('This video is for subscribers.',);
    const settings = await getVideoSettings();
    if (!settings.downloadsEnabled) throw new NotFoundError('Download',);
    const ready = (await repo.listRenditions(id, 'full',))
        .filter((r,) => r.status === 'ready' && r.downloadPath)
        .sort((a, b,) => (b.height ?? 0) - (a.height ?? 0));
    const pick = quality ? ready.find((r,) => r.name === quality) : ready[0];
    if (!pick) throw new NotFoundError('Download',);
    const store = await resolveStorageProvider();
    if (!isObjectStore(store,)) throw new NotFoundError('Download',);
    const stem = (m.title || m.originalName.replace(/\.[^.]+$/, '',)).replace(/[^\w .-]+/g, '',).trim().slice(0, 80,) || 'video';
    return store.presignGet(pick.downloadPath!, 600, `${stem} (${pick.name}).mp4`,);
}

/** Browsers natively play these as a plain file (an original in another
 *  container — MOV/MKV/HEVC — may not, so it is never the default). */
const BROWSER_PLAYABLE = /^video\/(mp4|webm|ogg)$/i;

export type FileLink =
    | { kind: 'redirect'; url: string; cacheControl: string; }
    | { kind: 'watch'; url: string; };

/**
 * The direct link (`/video/:id/file`): a PLAIN video file, not a playlist.
 *
 *   quality  — omitted/`auto`/`highest` → the highest encoded MP4 (H.264,
 *              faststart: plays in every browser); `720p`/`480p`/… → that
 *              rung; `original` → the uploaded original when kept and
 *              browser-playable.
 *   access   — public → anyone; private → `media.private:view` (session
 *              cookie) OR a valid share token (`?t=`).
 *
 * Public videos redirect to the CDN (edge-cached). Private ones redirect to a
 * short-lived signed URL. A viewer without access is sent to the site's
 * player page (teaser + sign-in) — `watch`.
 */
export async function fileLink(
    id: string,
    opts: { quality?: string; token?: string | null; },
    viewer: Viewer | null | undefined,
): Promise<FileLink> {
    const m = await mediaHead(id,);
    const allowed = verifyShareToken(id, opts.token,) || await canWatchFull(m.accessLevel, viewer,);
    if (!allowed) return { kind: 'watch', url: watchUrl(id,), };

    const store = await resolveStorageProvider();
    const video = await repo.getVideo(id,).catch(() => null);
    const personal = m.accessLevel === 'private';
    const TTL = 6 * 3600;

    // Not an encoded video: the stored file itself.
    if (!video || !isObjectStore(store,)) {
        if (!m.url || m.url.includes('/api/v1/video/',)) throw new NotFoundError('Video file',);
        return { kind: 'redirect', url: m.url, cacheControl: 'private, max-age=60', };
    }

    const q = (opts.quality || 'auto').toLowerCase();
    const originalOk = !!video.sourceKey && BROWSER_PLAYABLE.test(m.mimeType,);
    let key: string | null = null;
    if (q === 'original') {
        if (!originalOk) throw new NotFoundError('Original file',);
        key = video.sourceKey;
    } else {
        const ready = (await repo.listRenditions(id, 'full',))
            .filter((r,) => r.status === 'ready' && r.downloadPath)
            .sort((a, b,) => (b.height ?? 0) - (a.height ?? 0));
        const pick = q === 'auto' || q === 'highest' ? ready[0] : ready.find((r,) => r.name.toLowerCase() === q);
        if (pick) key = pick.downloadPath;
        // Still encoding: a browser-playable original is better than nothing.
        else if (!ready.length && originalOk) key = video.sourceKey;
        else if (!ready.length) return { kind: 'watch', url: watchUrl(id,), };
        else throw new NotFoundError(`Quality ${q}`,);
    }
    if (!personal) {
        return { kind: 'redirect', url: store.publicUrl(key!,), cacheControl: 'public, max-age=300, s-maxage=300', };
    }
    return { kind: 'redirect', url: await store.presignGet(key!, TTL,), cacheControl: 'private, no-store', };
}
