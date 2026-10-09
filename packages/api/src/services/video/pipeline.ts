/**
 * One ENCODE job end to end (docs/plans/2026-10-08-self-hosted-video.md §2.2):
 * download the original → probe → poster → per rung: encode MP4 → package
 * HLS (AES-128 when private) → upload → ready, + its teaser cut and the
 * scrub-bar sprites → finalize (keep or drop the original).
 *
 * Resumable by construction: where to start is read from the rendition rows
 * (`ready` → skip), so a crash, a lease loss or a restart redoes at most the
 * rung that was in flight. The worker owns the lease and the terminal job
 * state for failures; this module throws typed errors.
 *
 * Layout: rung playlists/segments + downloadable MP4s live under the SECRET
 * full prefix. The poster and sprites are PUBLIC (every viewer sees them), so
 * they live under `<encodeId>-public` — a poster URL under the full prefix
 * would reveal the path to the unencrypted download MP4s.
 */
import { createWriteStream, } from 'fs';
import { chmod, mkdir, readdir, rm, stat, truncate, writeFile, } from 'fs/promises';
import path from 'path';
import { Transform, } from 'stream';
import { pipeline as streamPipeline, } from 'stream/promises';
import sharp from 'sharp';
import type { MediaAccessLevel, VideoJobStatus, VideoSettings, } from '@sitesurge/types';
import * as repo from '../../repositories/video.repo';
import * as wrepo from '../../repositories/videoWorker.repo';
import { logger, } from '../../utils/logger';
import * as cache from '../cache';
import { IMMUTABLE_CACHE, isObjectStore, type ObjectStore, resolveStorageProvider, } from '../storage';
import {
    encodeArgs,
    hlsPackageArgs,
    type LowPriority,
    lowPriority,
    posterArgs,
    quickReplayArgs,
    remuxArgs,
    SPRITE_COLS,
    SPRITE_ROWS,
    spriteArgs,
    spriteVtt,
    teaserCutArgs,
} from './ffmpegArgs';
import { currentKey, keyBytes, newIvHex, } from './keys';
import { encodeOrder, type PlannedRung, renditionPlan, selectRungs, teaserRungs, } from './ladder';
import {
    downloadKey,
    fullPrefix,
    keyUri,
    mediaVideoRoot,
    newEncodeId,
    originalKey,
    posterKey,
    posterThumbKey,
    renditionDir,
    renditionPlaylistKey,
    spriteImageKey,
    spritesVttKey,
    teaserPrefix,
} from './paths';
import { NoVideoStreamError, type ProbeInfo, probeFile, } from './probe';
import { fractionDone, overallProgress, type ProgressItem, ProgressParser, } from './progress';
import { getVideoSettings, } from './settings';
import { binaries, diskFreeBytes, ffmpegBin, ffprobeBin, ProcessAbortedError, runProcess, videoTempDir, } from './tooling';

// ─── Job control + errors ─────────────────────────────────────────────

export type AbortReason = 'cancel' | 'lease' | 'shutdown';

/** Shared between the worker (lease, cancel, shutdown) and a running job. */
export class JobControl {
    private ac = new AbortController();
    reason: AbortReason | null = null;
    status: VideoJobStatus = 'downloading';
    progress = 0;

    /** `beat` writes status/progress + extends the lease (set by the worker). */
    constructor(public beat: () => Promise<void> = async () => {},) {}

    get signal(): AbortSignal {
        return this.ac.signal;
    }

    abort(reason: AbortReason,): void {
        if (this.reason) return;
        this.reason = reason;
        this.ac.abort();
    }

    throwIfAborted(): void {
        if (this.reason) throw new JobAbortedError(this.reason,);
    }

    async setStatus(status: VideoJobStatus,): Promise<void> {
        if (this.status === status) return;
        this.status = status;
        await this.beat();
    }
}

export class JobAbortedError extends Error {
    constructor(public reason: AbortReason,) {
        super(`Job stopped (${reason})`,);
        this.name = 'JobAbortedError';
    }
}

/** Not runnable yet — wait without spending an attempt. */
export class BlockedError extends Error {
    constructor(public reason: 'ffmpeg_missing' | 'disk' | 'storage', public retrySeconds: number, message: string,) {
        super(message,);
        this.name = 'BlockedError';
    }
}

/** Retrying cannot help (no video stream, original gone). */
export class PermanentJobError extends Error {
    constructor(message: string,) {
        super(message,);
        this.name = 'PermanentJobError';
    }
}

export class FfmpegError extends Error {
    constructor(public code: number, public stderrTail: string, step: string,) {
        super(`ffmpeg ${step} failed (exit ${code}): ${stderrTail.trim().slice(-1500,) || 'no output'}`,);
        this.name = 'FfmpegError';
    }
}

export interface JobRun {
    job: repo.ClaimedJob;
    ctl: JobControl;
}

// ─── Shared helpers (also used by repackage.ts) ───────────────────────

export const jobDir = (jobId: string,): string => path.join(videoTempDir(), jobId,);

export async function removeJobDir(jobId: string,): Promise<void> {
    await rm(jobDir(jobId,), { recursive: true, force: true, },).catch(() => {},);
}

/** Public (non-secret) prefix for the poster + sprites. */
export const publicAssetsPrefix = (mediaId: string, encodeId: string,): string => `${mediaVideoRoot(mediaId,)}${encodeId}-public`;

export async function requireStore(): Promise<ObjectStore> {
    const p = await resolveStorageProvider();
    if (!isObjectStore(p,)) throw new BlockedError('storage', 600, 'Video needs S3-compatible object storage',);
    return p;
}

export async function requireTools(): Promise<LowPriority> {
    let b = await binaries();
    // Re-detect when missing: an operator may have installed ffmpeg since.
    if (!b.ffmpeg || !b.ffprobe || !b.libx264) b = await binaries(true,);
    if (!b.ffmpeg || !b.ffprobe || !b.libx264) {
        throw new BlockedError('ffmpeg_missing', 600, 'ffmpeg/ffprobe with libx264 is not installed',);
    }
    return b.lowPriority;
}

const isAbort = (e: unknown,): boolean => e instanceof JobAbortedError || e instanceof ProcessAbortedError;

/** Run ffmpeg (low priority); report 0–1 progress against `durationUs`. */
export async function ffmpeg(
    args: string[],
    step: string,
    o: { lp: LowPriority; ctl: JobControl; durationUs?: number; onFraction?: (f: number,) => void; },
): Promise<void> {
    o.ctl.throwIfAborted();
    const w = lowPriority(ffmpegBin(), args, o.lp,);
    const parser = new ProgressParser();
    try {
        const r = await runProcess(w.cmd, w.args, {
            signal: o.ctl.signal,
            onStdout: o.onFraction
                ? (s,) => {
                    for (const t of parser.feed(s,)) o.onFraction!(t.done ? 1 : fractionDone(t.outTimeUs, o.durationUs ?? 0,),);
                }
                : undefined,
        },);
        if (r.code !== 0) throw new FfmpegError(r.code, r.stderrTail, step,);
    } catch (e) {
        if (e instanceof ProcessAbortedError) throw new JobAbortedError(o.ctl.reason ?? 'shutdown',);
        throw e;
    }
}

/** Run `fn` over `items` with at most `n` in flight. */
async function pool<T,>(items: T[], n: number, fn: (x: T,) => Promise<void>,): Promise<void> {
    let i = 0;
    const lanes = Array.from({ length: Math.min(n, items.length,), }, async () => {
        while (i < items.length) await fn(items[i++],);
    },);
    await Promise.all(lanes,);
}

/** Upload an HLS output dir: segments (4 in parallel), the playlist LAST. Returns total bytes. */
export async function uploadHlsDir(store: ObjectStore, dir: string, keyDir: string, ctl: JobControl,): Promise<number> {
    const files = (await readdir(dir,)).sort();
    const segs = files.filter((f,) => f.endsWith('.ts',));
    const lists = files.filter((f,) => f.endsWith('.m3u8',));
    let bytes = 0;
    const put = async (f: string, contentType: string,) => {
        ctl.throwIfAborted();
        const p = path.join(dir, f,);
        const size = (await stat(p,)).size;
        await store.putFile(`${keyDir}/${f}`, p, { contentType, cacheControl: IMMUTABLE_CACHE, contentLength: size, },);
        bytes += size;
    };
    await pool(segs, 4, (f,) => put(f, 'video/mp2t',),);
    for (const f of lists) await put(f, 'application/vnd.apple.mpegurl',);
    return bytes;
}

/** Stream an object to a local file, resuming a partial one with a Range read. */
export async function downloadObject(
    store: ObjectStore,
    key: string,
    dest: string,
    ctl: JobControl,
    onBytes?: (done: number, total: number,) => void,
): Promise<number> {
    const head = await store.head(key,);
    if (!head) throw new PermanentJobError(`The stored file is missing (${path.basename(key,)}).`,);
    let have = await stat(dest,).then((s,) => s.size, () => 0,);
    if (have > head.size) {
        await truncate(dest, 0,);
        have = 0;
    }
    if (have < head.size) {
        const src = await store.getObjectStream(key, have > 0 ? { start: have, } : undefined,);
        let done = have;
        const counter = new Transform({
            transform(chunk: Buffer, _enc, cb,) {
                done += chunk.length;
                onBytes?.(done, head.size,);
                cb(null, chunk,);
            },
        },);
        await streamPipeline(src as NodeJS.ReadableStream, counter, createWriteStream(dest, { flags: have > 0 ? 'a' : 'w', },), {
            signal: ctl.signal,
        },).catch((e,) => {
            if (ctl.reason) throw new JobAbortedError(ctl.reason,);
            throw e;
        },);
    }
    const got = (await stat(dest,)).size;
    if (got !== head.size) throw new Error(`Download incomplete: ${got} of ${head.size} bytes`,);
    return got;
}

export interface Encryption {
    keyInfoFile: string;
    version: number;
    ivHex: string;
}

/** key file + key.info (0600) in the job dir: URI, key path, IV. */
export async function writeKeyInfo(work: string, version: number, key: Buffer, ivHex: string, s: VideoSettings,): Promise<Encryption> {
    const keyFile = path.join(work, 'enc.key',);
    const keyInfoFile = path.join(work, 'key.info',);
    await writeFile(keyFile, key, { mode: 0o600, },);
    await chmod(keyFile, 0o600,);
    await writeFile(keyInfoFile, `${keyUri(version, s.keyBaseUrl,)}\n${keyFile}\n${ivHex}\n`, { mode: 0o600, },);
    await chmod(keyInfoFile, 0o600,);
    return { keyInfoFile, version, ivHex, };
}

/**
 * Teaser window in seconds (start falls back to 0 when past the end). The
 * teaser is never encrypted, so it is capped at HALF the video — otherwise a
 * long teaser on a short private video would publish the whole thing.
 */
export function teaserWindow(video: repo.VideoRow, durationMs: number,): { startSec: number; durationSec: number; } {
    const start = video.teaserStartMs < durationMs - 1000 ? video.teaserStartMs : 0;
    const cap = durationMs > 0 ? Math.max(1000, Math.floor(durationMs / 2,),) : video.teaserDurationMs;
    return { startSec: start / 1000, durationSec: Math.min(video.teaserDurationMs, cap,) / 1000, };
}

/**
 * Cut + package + upload one TEASER rung (never encrypted) from a local rung
 * MP4, then mark it ready.
 */
export async function buildTeaser(o: {
    store: ObjectStore;
    ctl: JobControl;
    lp: LowPriority;
    work: string;
    mp4: string;
    row: repo.RenditionRow;
    teaserPrefix: string;
    startSec: number;
    durationSec: number;
    segmentSeconds: number;
    jobId: string;
},): Promise<void> {
    const { row, } = o;
    await repo.updateRendition(row.id, { status: 'encoding', progress: 0, error: null, startedAt: new Date().toISOString(), jobId: o.jobId, },);
    const cut = path.join(o.work, `teaser_${row.name}.mp4`,);
    const dir = path.join(o.work, `teaser_${row.name}`,);
    try {
        await rm(dir, { recursive: true, force: true, },);
        await mkdir(dir, { recursive: true, },);
        await ffmpeg(teaserCutArgs({ input: o.mp4, output: cut, startSec: o.startSec, durationSec: o.durationSec, },), 'teaser cut', o,);
        await ffmpeg(hlsPackageArgs({ input: cut, dir, segmentSeconds: o.segmentSeconds, },), 'teaser package', o,);
        await repo.updateRendition(row.id, { status: 'uploading', progress: 50, },);
        const bytes = await uploadHlsDir(o.store, dir, renditionDir(o.teaserPrefix, row.name,), o.ctl,);
        await repo.updateRendition(row.id, {
            status: 'ready', progress: 100, playlistPath: renditionPlaylistKey(o.teaserPrefix, row.name,), bytes,
            finishedAt: new Date().toISOString(), error: null,
        },);
        await repo.bumpHlsVersion(row.mediaId,);
        await cache.invalidateVideoCache(row.mediaId,);
    } catch (e) {
        if (!isAbort(e,)) await repo.updateRendition(row.id, { status: 'failed', error: errText(e,), },).catch(() => {},);
        throw e;
    } finally {
        await rm(dir, { recursive: true, force: true, },).catch(() => {},);
        await rm(cut, { force: true, },).catch(() => {},);
    }
}

const errText = (e: unknown,): string => (e instanceof FfmpegError ? e.stderrTail : (e as Error)?.message ?? String(e,)).slice(-4096,);

export const backoffSeconds = (attempts: number,): number => [60, 600, 3600,][Math.min(Math.max(attempts, 1,), 3,) - 1];

// ─── Encode ───────────────────────────────────────────────────────────

/**
 * The encode job. Returns after the job is finished `ready`; throws
 * `BlockedError` / `PermanentJobError` / `JobAbortedError` / anything else
 * (a retryable failure) for the worker to record.
 */
export async function runEncodeJob(run: JobRun,): Promise<void> {
    const { job, ctl, } = run;
    const mediaId = job.mediaId;
    const store = await requireStore();
    const lp = await requireTools();
    const s = await getVideoSettings();
    let video = await repo.getVideo(mediaId,);
    const media = await wrepo.getMediaFacts(mediaId,);
    if (!video || !media) throw new PermanentJobError('This media item has no video record.',);
    if (!video.sourceKey) throw new PermanentJobError('The original was deleted — re-upload the video to encode it again.',);

    const work = jobDir(job.id,);
    await mkdir(work, { recursive: true, },);

    // 1. Disk budget, then download.
    const head = await store.head(video.sourceKey,);
    if (!head) throw new PermanentJobError('The uploaded original is missing from storage — re-upload the video.',);
    const ext = /\.[A-Za-z0-9]{1,8}$/.exec(video.sourceKey,)?.[0].toLowerCase() ?? '';
    const downloaded = path.join(work, `source${ext}`,);
    let src = downloaded;
    const have = await stat(downloaded,).then((x,) => x.size, () => 0,);
    const free = await diskFreeBytes();
    if (free !== null) {
        const priorMs = Number((video.probe as { durationMs?: number; } | null)?.durationMs ?? 0,);
        const topKbps = Math.max(...s.ladder.map((r,) => r.maxrateKbps + r.audioKbps),);
        const rung = priorMs > 0 ? topKbps * 125 * (priorMs / 1000) * 1.3 : head.size;
        const need = Math.max(0, head.size - have,) + 2 * rung + s.minFreeDiskGb * 1e9;
        if (free < need) {
            throw new BlockedError('disk', 600, `Not enough free disk in ${videoTempDir()}: ${fmtGb(free,)} free, ${fmtGb(need,)} needed`,);
        }
    }
    await ctl.setStatus('downloading',);
    let lastDl = 0;
    await downloadObject(store, video.sourceKey, downloaded, ctl, (done, total,) => {
        ctl.progress = Math.round(500 * done / total,) / 100;
        if (Date.now() - lastDl > 5000) {
            lastDl = Date.now();
            void ctl.beat();
        }
    },);

    // 1b. Live recordings: quick replay (H.264 → seekable MP4 served at once)
    //     or a container repair (VP8/VP9) — a MediaRecorder file has no
    //     duration, and every later step needs one. Encode from the result.
    if (video.quickReplay) {
        src = await prepareLiveRecording({ store, src: downloaded, work, video, mediaId, lp, ctl, },);
        video = (await repo.getVideo(mediaId,))!;
    }

    // 2. Probe.
    await ctl.setStatus('probing',);
    let probe: ProbeInfo;
    try {
        probe = await probeFile(ffprobeBin(), src, ctl.signal,);
    } catch (e) {
        if (e instanceof NoVideoStreamError) throw new PermanentJobError(e.message,);
        if (e instanceof ProcessAbortedError) throw new JobAbortedError(ctl.reason ?? 'shutdown',);
        throw e;
    }
    if (!probe.durationMs) throw new PermanentJobError('Could not read the video duration — the file may be damaged.',);
    await wrepo.setMediaProbe(mediaId, { width: probe.displayWidth, height: probe.displayHeight, durationMs: probe.durationMs, },);
    video = (await repo.updateVideo(mediaId, { probe: probe as unknown as Record<string, unknown>, },))!;

    // 3. Encryption — decided from the CURRENT access level. Ready full
    //    renditions in the wrong state (or on an old key) are rebuilt under a
    //    NEW prefix: rewriting the same object keys would defeat immutable caching.
    const before = await repo.listRenditions(mediaId,);
    const readyFull = before.filter((r,) => r.variant === 'full' && r.status === 'ready');
    const enc = await decideEncryption(work, media.accessLevel, video, readyFull.length > 0, s,);
    let oldPrefix: string | null = null;
    if (enc.rebuild && readyFull.length > 0) {
        oldPrefix = video.storagePrefix;
        const encodeId = newEncodeId();
        await wrepo.resetRenditions(mediaId, 'full',);
        video = (await repo.updateVideo(mediaId, { encodeId, storagePrefix: fullPrefix(mediaId, encodeId,), },))!;
    }
    video = (await repo.updateVideo(mediaId, {
        encrypted: enc.enc !== null, keyVersion: enc.enc?.version ?? null, ivHex: enc.enc?.ivHex ?? null,
    },))!;

    // 4. Poster (before the renditions, so the library shows a picture at once).
    const assets = publicAssetsPrefix(mediaId, video.encodeId,);
    if (!video.posterUrl) {
        const poster = path.join(work, 'poster.jpg',);
        const thumb = path.join(work, 'poster_thumb.jpg',);
        try {
            await ffmpeg(posterArgs({ input: src, output: poster, atSec: (probe.durationMs / 1000) * s.posterAtPercent / 100, },), 'poster', { lp, ctl, },);
            await sharp(poster,).resize(300, null, { withoutEnlargement: true, },).jpeg({ quality: 80, },).toFile(thumb,);
            await store.putFile(posterKey(assets,), poster, { contentType: 'image/jpeg', cacheControl: IMMUTABLE_CACHE, },);
            await store.putFile(posterThumbKey(assets,), thumb, { contentType: 'image/jpeg', cacheControl: IMMUTABLE_CACHE, },);
            video = (await repo.updateVideo(mediaId, { posterUrl: store.publicUrl(posterKey(assets,),), },))!;
            await wrepo.setMediaThumbnail(mediaId, store.publicUrl(posterThumbKey(assets,),),);
        } catch (e) {
            if (isAbort(e,)) throw e;
            // A poster is nice to have; never fail an encode over it.
            logger.warn('Video poster failed', { mediaId, error: errText(e,).slice(-500,), },);
        }
    }

    // 5. Ladder → rendition rows.
    const full = selectRungs(s.ladder, probe.displayWidth, probe.displayHeight, probe.fps,);
    const teaser = video.teaserEnabled ? teaserRungs(full, s.teaserMaxHeight,) : [];
    if (video.teaserEnabled && !video.teaserPrefix) {
        video = (await repo.updateVideo(mediaId, { teaserPrefix: teaserPrefix(mediaId, video.encodeId,), },))!;
    }
    const rowsList = await repo.syncRenditions(mediaId, job.id, renditionPlan(full, teaser,),);
    const rows = new Map(rowsList.map((r,) => [`${r.variant}:${r.name}`, r,]),);

    const prog = new Map<string, ProgressItem>(rowsList.map((r,) => [
        `${r.variant}:${r.name}`,
        { variant: r.variant, width: r.width, height: r.height, progress: r.status === 'ready' ? 100 : 0, },
    ]),);
    const setProg = (key: string, p: number,) => {
        const it = prog.get(key,);
        if (it) it.progress = p;
        ctl.progress = overallProgress([...prog.values(),], { downloaded: true, finalized: false, },);
    };
    ctl.progress = overallProgress([...prog.values(),], { downloaded: true, finalized: false, },);
    let spritesTried = Boolean(video.thumbnailsVtt,) || !s.sprites;

    const durationUs = probe.durationMs * 1000;
    const tw = teaserWindow(video, probe.durationMs,);
    let anyReady = rowsList.some((r,) => r.variant === 'full' && r.status === 'ready');
    if (anyReady) await wrepo.setMediaStatus(mediaId, 'ready',);

    // 6. One rung at a time.
    for (const rung of encodeOrder(full, s.encodeOrder,)) {
        ctl.throwIfAborted();
        const fKey = `full:${rung.name}`;
        let row = rows.get(fKey,)!;
        const localMp4 = path.join(work, `${rung.name}.mp4`,);
        let haveMp4 = false;

        if (row.status !== 'ready') {
            await encodeFullRung({ run, store, lp, s, work, src, rung, row, prefix: video.storagePrefix, enc: enc.enc, durationUs, setProg, fKey, },);
            haveMp4 = true;
            row = (await repo.listRenditions(mediaId, 'full',)).find((r,) => r.name === rung.name) ?? row;
            if (!anyReady) {
                anyReady = true;
                await wrepo.setMediaStatus(mediaId, 'ready',);
            }
        }

        const ensureMp4 = async (): Promise<string> => {
            if (!haveMp4) {
                if (!row.downloadPath) throw new Error(`Rendition ${rung.name} has no stored MP4`,);
                await downloadObject(store, row.downloadPath, localMp4, ctl,);
                haveMp4 = true;
            }
            return localMp4;
        };

        const tRow = rows.get(`teaser:${rung.name}`,);
        if (tRow && tRow.status !== 'ready' && video.teaserPrefix) {
            await ctl.setStatus('encoding',);
            await buildTeaser({
                store, ctl, lp, work, mp4: await ensureMp4(), row: tRow, teaserPrefix: video.teaserPrefix,
                startSec: tw.startSec, durationSec: tw.durationSec, segmentSeconds: s.segmentSeconds, jobId: job.id,
            },);
            setProg(`teaser:${rung.name}`, 100,);
        }

        if (!spritesTried) {
            spritesTried = true; // once per job, from the first finished rung
            try {
                const vtt = await buildSprites({ store, ctl, lp, work, mp4: await ensureMp4(), assets, durationSec: probe.durationMs / 1000, },);
                video = (await repo.updateVideo(mediaId, { thumbnailsVtt: vtt, },))!;
            } catch (e) {
                if (isAbort(e,)) throw e;
                logger.warn('Video sprites failed', { mediaId, error: errText(e,).slice(-500,), },);
            }
        }
        await rm(localMp4, { force: true, },).catch(() => {},);
    }

    // 7. Finalize.
    await ctl.setStatus('finalizing',);
    await handleOriginal(store, video, media, s,);
    await wrepo.setMediaStatus(mediaId, 'ready',);
    await repo.finishJob(job.id, 'ready',);
    await removeJobDir(job.id,);
    await cache.invalidateVideoCache(mediaId,);
    if (oldPrefix) await deleteRungObjects(store, oldPrefix, before.filter((r,) => r.variant === 'full').map((r,) => r.name),);

    // The access level may have changed while we encoded: re-package now.
    const [m2, v2,] = await Promise.all([wrepo.getMediaFacts(mediaId,), repo.getVideo(mediaId,),],);
    if (m2 && v2 && (m2.accessLevel === 'private') !== v2.encrypted) {
        await repo.enqueueJob(mediaId, { kind: 'repackage', },);
    }
}

const fmtGb = (b: number,): string => `${(b / 1e9).toFixed(1,)} GB`;

/** Delete a full prefix's rung dirs + downloads (NOT poster/sprites). */
/**
 * Live recording → playable source. H.264 (what the live console records when
 * the browser can): copy into a faststart MP4 (video untouched, audio → AAC),
 * upload it as the QUICK REPLAY and mark the media playable — viewers get the
 * replay at camera quality within a minute or two, while the HLS ladder is
 * encoded from the same file afterwards. Anything else (VP8/VP9): a stream
 * copy into Matroska, which only repairs the duration for the encode.
 */
async function prepareLiveRecording(o: {
    store: ObjectStore; src: string; work: string; video: repo.VideoRow; mediaId: string; lp: LowPriority; ctl: JobControl;
},): Promise<string> {
    const { store, src, work, video, mediaId, lp, ctl, } = o;
    await ctl.setStatus('probing',);
    let raw: ProbeInfo | null = null;
    try {
        raw = await probeFile(ffprobeBin(), src, ctl.signal,);
    } catch (e) {
        if (e instanceof NoVideoStreamError) throw new PermanentJobError(e.message,);
        if (e instanceof ProcessAbortedError) throw new JobAbortedError(ctl.reason ?? 'shutdown',);
        raw = null; // unreadable header: the remux below may still fix it
    }
    await ctl.setStatus('encoding',);
    if (raw?.videoCodec === 'h264') {
        const out = path.join(work, 'replay.mp4',);
        await ffmpeg(quickReplayArgs({ input: src, output: out, hasAudio: raw.hasAudio, },), 'quick-replay', { lp, ctl, },);
        if (!video.quickReplayPath) {
            const key = `${video.storagePrefix}/quick/replay.mp4`;
            await ctl.setStatus('uploading',);
            await store.putFile(key, out, { contentType: 'video/mp4', cacheControl: IMMUTABLE_CACHE, },);
            const size = (await stat(out,)).size;
            await repo.updateVideo(mediaId, { quickReplayPath: key, quickReplayBytes: size, },);
            await wrepo.setMediaStatus(mediaId, 'ready',);
            await cache.invalidateVideoCache(mediaId,);
            logger.info('Quick replay ready', { mediaId, bytes: size, },);
        }
        return out;
    }
    const out = path.join(work, 'source.mkv',);
    await ffmpeg(remuxArgs({ input: src, output: out, },), 'remux', { lp, ctl, },);
    logger.info('Live recording is not H.264 — no quick replay; encoding from a remuxed copy', {
        mediaId, codec: raw?.videoCodec ?? 'unknown',
    },);
    return out;
}

export async function deleteRungObjects(store: ObjectStore, prefix: string, rungNames: string[],): Promise<void> {
    try {
        for (const n of new Set(rungNames,)) await store.deletePrefix(`${renditionDir(prefix, n,)}/`,);
        await store.deletePrefix(`${prefix}/downloads/`,);
    } catch (e) {
        logger.warn('Video: old rendition cleanup failed', { prefix, error: (e as Error).message, },);
    }
}

async function decideEncryption(
    work: string,
    access: MediaAccessLevel,
    video: repo.VideoRow,
    hasReady: boolean,
    s: VideoSettings,
): Promise<{ enc: Encryption | null; rebuild: boolean; }> {
    if (access !== 'private') return { enc: null, rebuild: video.encrypted, };
    const cur = await currentKey();
    // Resume: keep the key + IV the ready renditions were packaged with.
    if (hasReady && video.encrypted && video.keyVersion === cur.version && video.ivHex) {
        const key = await keyBytes(video.keyVersion,);
        if (key) return { enc: await writeKeyInfo(work, video.keyVersion, key, video.ivHex, s,), rebuild: false, };
    }
    return { enc: await writeKeyInfo(work, cur.version, cur.key, newIvHex(), s,), rebuild: true, };
}

async function encodeFullRung(o: {
    run: JobRun;
    store: ObjectStore;
    lp: LowPriority;
    s: VideoSettings;
    work: string;
    src: string;
    rung: PlannedRung;
    row: repo.RenditionRow;
    prefix: string;
    enc: Encryption | null;
    durationUs: number;
    fKey: string;
    setProg: (key: string, p: number,) => void;
},): Promise<void> {
    const { ctl, job, } = o.run;
    const { rung, row, } = o;
    const out = path.join(o.work, `${rung.name}.mp4`,);
    const dir = path.join(o.work, rung.name,);
    await repo.updateRendition(row.id, {
        status: 'encoding', progress: 0, error: null, startedAt: new Date().toISOString(), jobId: job.id, attempts: row.attempts + 1,
    },);
    await ctl.setStatus('encoding',);
    let lastWrite = 0;
    try {
        await ffmpeg(
            encodeArgs({ input: o.src, output: out, rung, threads: o.s.encodeThreads, preset: o.s.preset, crf: o.s.crf, segmentSeconds: o.s.segmentSeconds, },),
            `encode ${rung.name}`,
            {
                lp: o.lp,
                ctl,
                durationUs: o.durationUs,
                onFraction: (f,) => {
                    const p = Math.round(f * 9000,) / 100; // encode = 0–90 %
                    o.setProg(o.fKey, p,);
                    if (Date.now() - lastWrite >= 5000) {
                        lastWrite = Date.now();
                        void repo.updateRendition(row.id, { progress: p, },).catch(() => {},);
                        void ctl.beat();
                    }
                },
            },
        );
        await rm(dir, { recursive: true, force: true, },);
        await mkdir(dir, { recursive: true, },);
        await ffmpeg(
            hlsPackageArgs({ input: out, dir, segmentSeconds: o.s.segmentSeconds, keyInfoFile: o.enc?.keyInfoFile ?? null, },),
            `package ${rung.name}`,
            { lp: o.lp, ctl, },
        );
        await repo.updateRendition(row.id, { status: 'uploading', progress: 92, },);
        o.setProg(o.fKey, 92,);
        await ctl.setStatus('uploading',);
        const bytes = await uploadHlsDir(o.store, dir, renditionDir(o.prefix, rung.name,), ctl,);
        const mp4Bytes = (await stat(out,)).size;
        ctl.throwIfAborted();
        await o.store.putFile(downloadKey(o.prefix, rung.name,), out, {
            contentType: 'video/mp4', cacheControl: IMMUTABLE_CACHE, contentLength: mp4Bytes,
        },);
        await repo.updateRendition(row.id, {
            status: 'ready', progress: 100, error: null,
            playlistPath: renditionPlaylistKey(o.prefix, rung.name,), bytes,
            downloadPath: downloadKey(o.prefix, rung.name,), downloadBytes: mp4Bytes,
            width: rung.width, height: rung.height, finishedAt: new Date().toISOString(),
        },);
        o.setProg(o.fKey, 100,);
        await repo.bumpHlsVersion(row.mediaId,);
        await cache.invalidateVideoCache(row.mediaId,);
    } catch (e) {
        if (!isAbort(e,)) await repo.updateRendition(row.id, { status: 'failed', error: errText(e,), },).catch(() => {},);
        throw e;
    } finally {
        await rm(dir, { recursive: true, force: true, },).catch(() => {},);
    }
}

/** Sprite sheets + WebVTT from a (small) rung MP4. Returns the VTT's public URL. */
async function buildSprites(o: {
    store: ObjectStore;
    ctl: JobControl;
    lp: LowPriority;
    work: string;
    mp4: string;
    assets: string;
    durationSec: number;
},): Promise<string> {
    const dir = path.join(o.work, 'sprites',);
    await rm(dir, { recursive: true, force: true, },);
    await mkdir(dir, { recursive: true, },);
    try {
        await ffmpeg(spriteArgs({ input: o.mp4, dir, },), 'sprites', o,);
        const sheets = (await readdir(dir,)).filter((f,) => /^sprite_\d+\.jpg$/.test(f,))
            .sort((a, b,) => Number(a.match(/\d+/,)![0],) - Number(b.match(/\d+/,)![0],));
        if (sheets.length === 0) throw new Error('ffmpeg produced no sprite sheets',);
        const meta = await sharp(path.join(dir, sheets[0],),).metadata();
        const tileWidth = Math.floor((meta.width ?? 0) / SPRITE_COLS,);
        const tileHeight = Math.floor((meta.height ?? 0) / SPRITE_ROWS,);
        if (!tileWidth || !tileHeight) throw new Error('Unreadable sprite sheet',);
        await pool(sheets, 4, async (f,) => {
            const n = Number(f.match(/\d+/,)![0],);
            await o.store.putFile(spriteImageKey(o.assets, n,), path.join(dir, f,), { contentType: 'image/jpeg', cacheControl: IMMUTABLE_CACHE, },);
        },);
        const vtt = spriteVtt({
            durationSec: o.durationSec, tileWidth, tileHeight,
            spriteUrl: (n,) => o.store.publicUrl(spriteImageKey(o.assets, n,),),
        },);
        const vttFile = path.join(dir, 'thumbnails.vtt',);
        await writeFile(vttFile, vtt,);
        await o.store.putFile(spritesVttKey(o.assets,), vttFile, { contentType: 'text/vtt; charset=utf-8', cacheControl: IMMUTABLE_CACHE, },);
        return o.store.publicUrl(spritesVttKey(o.assets,),);
    } finally {
        await rm(dir, { recursive: true, force: true, },).catch(() => {},);
    }
}

/** Keep the original under originals/ with an expiry, or delete it. */
async function handleOriginal(store: ObjectStore, video: repo.VideoRow, media: wrepo.MediaVideoFacts, s: VideoSettings,): Promise<void> {
    const src = video.sourceKey;
    if (!src) return;
    if (!video.keepOriginal) {
        await store.deleteObject(src,);
        await repo.updateVideo(video.mediaId, { sourceKey: null, originalExpiresAt: null, },);
        return;
    }
    if (src.startsWith('originals/',)) return; // already kept (a re-encode)
    const expires = s.originalRetentionDays > 0 ? new Date(Date.now() + s.originalRetentionDays * 86_400_000,).toISOString() : null;
    const dest = originalKey(video.mediaId, media.originalName || path.basename(src,),);
    try {
        await store.copyObject(src, dest,);
        await store.deleteObject(src,);
        await repo.updateVideo(video.mediaId, { sourceKey: dest, originalExpiresAt: expires, },);
    } catch (e) {
        // e.g. a single-request copy limit on a very large object: keep it
        // where it is (still kept, still expires) rather than fail the encode.
        logger.warn('Video: could not move the original; keeping it in place', { mediaId: video.mediaId, error: (e as Error).message, },);
        await repo.updateVideo(video.mediaId, { originalExpiresAt: expires, },);
    }
}
