/**
 * The REPACKAGE job: no re-encode. Used after a key rotation or an access
 * level change (full renditions re-segmented from their stored MP4s, with or
 * without AES-128), and after the teaser window changes (missing teaser rungs
 * cut again from the stored MP4s).
 *
 * The full video moves to a NEW prefix (new encodeId + secret): object keys
 * are written once and cached immutably, so re-using a key would serve stale
 * segments from the CDN. The switch is one DB transaction; the old rung dirs
 * and downloads are deleted after. Poster + sprites are left where they are.
 */
import { shortSide, } from './ladder';
import { mkdir, rm, stat, } from 'fs/promises';
import path from 'path';
import { transaction, } from '../../db';
import * as repo from '../../repositories/video.repo';
import * as wrepo from '../../repositories/videoWorker.repo';
import { logger, } from '../../utils/logger';
import * as cache from '../cache';
import { hlsPackageArgs, } from './ffmpegArgs';
import { currentKey, newIvHex, } from './keys';
import { codecsFor, } from './ladder';
import { downloadKey, fullPrefix, newEncodeId, renditionDir, renditionPlaylistKey, teaserPrefix, } from './paths';
import {
    buildTeaser,
    deleteRungObjects,
    downloadObject,
    type Encryption,
    ffmpeg,
    jobDir,
    type JobRun,
    PermanentJobError,
    removeJobDir,
    requireStore,
    requireTools,
    runEncodeJob,
    teaserWindow,
    uploadHlsDir,
    writeKeyInfo,
} from './pipeline';
import { getVideoSettings, } from './settings';

const NO_SOURCE = 'No stored MP4 or original to re-package from — re-upload the video.';

export async function runRepackageJob(run: JobRun,): Promise<void> {
    const { job, ctl, } = run;
    const mediaId = job.mediaId;
    const store = await requireStore();
    const lp = await requireTools();
    const s = await getVideoSettings();
    let video = await repo.getVideo(mediaId,);
    const media = await wrepo.getMediaFacts(mediaId,);
    if (!video || !media) throw new PermanentJobError('This media item has no video record.',);

    const all = await repo.listRenditions(mediaId,);
    const fullReady = all.filter((r,) => r.variant === 'full' && r.status === 'ready');
    const wantEnc = media.accessLevel === 'private';
    const cur = wantEnc ? await currentKey() : null;
    const fullOk = video.encrypted === wantEnc && (!wantEnc || video.keyVersion === cur!.version);
    const missingMp4 = fullReady.some((r,) => !r.downloadPath);

    // Nothing to re-segment from → a full encode, when the original exists.
    // (The encode pipeline rebuilds mismatched renditions under a new prefix.)
    if (fullReady.length === 0 || (!fullOk && missingMp4)) {
        if (video.sourceKey) return runEncodeJob(run,);
        throw new PermanentJobError(NO_SOURCE,);
    }

    const work = jobDir(job.id,);
    await rm(work, { recursive: true, force: true, },);
    await mkdir(work, { recursive: true, },);
    const durationMs = media.durationMs ?? Number((video.probe as { durationMs?: number; } | null)?.durationMs ?? 0,);

    // Teaser rungs to (re)build: ≤ teaserMaxHeight, at least the lowest.
    const byHeightDesc = [...fullReady,].sort((a, b,) => (b.height ?? 0) - (a.height ?? 0));
    const teaserFrom = video.teaserEnabled
        ? (() => {
            const fit = byHeightDesc.filter((r,) => shortSide(r,) <= s.teaserMaxHeight);
            return fit.length > 0 ? fit : byHeightDesc.slice(-1,);
        })()
        : [];
    const teaserRows = all.filter((r,) => r.variant === 'teaser');
    const teaserTodo = teaserFrom.filter((f,) => !teaserRows.some((t,) => t.name === f.name && t.status === 'ready'));

    const steps = (fullOk ? 0 : fullReady.length) + teaserTodo.length;
    let doneSteps = 0;
    const tick = () => {
        doneSteps++;
        ctl.progress = Math.round(9500 * doneSteps / Math.max(1, steps,),) / 100;
        void ctl.beat();
    };
    const localMp4 = (name: string,) => path.join(work, `${name}.mp4`,);

    // 1. Full renditions → new prefix.
    if (!fullOk) {
        await ctl.setStatus('encoding',);
        const oldPrefix = video.storagePrefix;
        const encodeId = newEncodeId();
        const prefix = fullPrefix(mediaId, encodeId,);
        let enc: Encryption | null = null;
        if (cur) enc = await writeKeyInfo(work, cur.version, cur.key, newIvHex(), s,);
        const updates: Array<{ id: string; playlistPath: string; downloadPath: string; bytes: number; }> = [];
        for (const r of fullReady) {
            ctl.throwIfAborted();
            const mp4 = localMp4(r.name,);
            await downloadObject(store, r.downloadPath!, mp4, ctl,);
            const dir = path.join(work, r.name,);
            await rm(dir, { recursive: true, force: true, },);
            await mkdir(dir, { recursive: true, },);
            await ffmpeg(hlsPackageArgs({ input: mp4, dir, segmentSeconds: s.segmentSeconds, keyInfoFile: enc?.keyInfoFile ?? null, },), `repackage ${r.name}`, { lp, ctl, },);
            await ctl.setStatus('uploading',);
            const bytes = await uploadHlsDir(store, dir, renditionDir(prefix, r.name,), ctl,);
            await store.copyObject(r.downloadPath!, downloadKey(prefix, r.name,),);
            await rm(dir, { recursive: true, force: true, },);
            // Keep the MP4 only if a teaser is about to be cut from it.
            if (!teaserTodo.some((t,) => t.name === r.name)) await rm(mp4, { force: true, },);
            updates.push({ id: r.id, playlistPath: renditionPlaylistKey(prefix, r.name,), downloadPath: downloadKey(prefix, r.name,), bytes, },);
            tick();
        }
        ctl.throwIfAborted();
        await ctl.setStatus('finalizing',);
        await transaction(async (c,) => {
            await repo.updateVideo(mediaId, {
                encodeId, storagePrefix: prefix, encrypted: enc !== null, keyVersion: enc?.version ?? null, ivHex: enc?.ivHex ?? null,
            }, c,);
            for (const u of updates) {
                await repo.updateRendition(u.id, { playlistPath: u.playlistPath, downloadPath: u.downloadPath, bytes: u.bytes, }, c,);
            }
            // Non-ready full rows pointed at the old prefix: a later encode redoes them.
            await repo.bumpHlsVersion(mediaId, c,);
        },);
        await cache.invalidateVideoCache(mediaId,);
        await deleteRungObjects(store, oldPrefix, all.filter((r,) => r.variant === 'full').map((r,) => r.name),);
        video = (await repo.getVideo(mediaId,))!;
    }

    // 2. Teaser rungs (never encrypted).
    if (teaserTodo.length > 0) {
        if (!durationMs) throw new PermanentJobError('The video duration is unknown — re-encode the video.',);
        await ctl.setStatus('encoding',);
        // No ready teaser left (the window changed) → a fresh prefix, so the
        // CDN can never serve a cached segment of the old cut.
        const anyTeaserReady = teaserRows.some((t,) => t.status === 'ready');
        const oldTeaser = video.teaserPrefix;
        const tPrefix = anyTeaserReady && oldTeaser ? oldTeaser : teaserPrefix(mediaId, newEncodeId(),);

        // Plan = every full row as it is + the teaser rows we want.
        const fulls = all.filter((r,) => r.variant === 'full');
        const plan: repo.RenditionPlan[] = [
            ...fulls.map((r,) => ({
                variant: 'full' as const, name: r.name, sortOrder: r.sortOrder, width: r.width, height: r.height,
                bandwidth: r.bandwidth, avgBandwidth: r.avgBandwidth, codecs: r.codecs,
            })),
            ...teaserFrom.map((r,) => ({
                variant: 'teaser' as const, name: r.name, sortOrder: r.sortOrder, width: r.width, height: r.height,
                bandwidth: r.bandwidth, avgBandwidth: r.avgBandwidth, codecs: r.codecs ?? codecsFor(31,),
            })),
        ];
        const synced = await repo.syncRenditions(mediaId, job.id, plan,);
        if (tPrefix !== oldTeaser) await repo.updateVideo(mediaId, { teaserPrefix: tPrefix, },);
        const tw = teaserWindow(video, durationMs,);
        const fullsNow = await repo.listRenditions(mediaId, 'full',);
        for (const t of teaserTodo) {
            ctl.throwIfAborted();
            const row = synced.find((x,) => x.variant === 'teaser' && x.name === t.name)!;
            const src = fullsNow.find((x,) => x.name === t.name);
            if (!src?.downloadPath) throw new PermanentJobError(NO_SOURCE,);
            const mp4 = localMp4(t.name,);
            const have = await stat(mp4,).then(() => true, () => false,);
            if (!have) await downloadObject(store, src.downloadPath, mp4, ctl,);
            await buildTeaser({
                store, ctl, lp, work, mp4, row, teaserPrefix: tPrefix, startSec: tw.startSec, durationSec: tw.durationSec,
                segmentSeconds: s.segmentSeconds, jobId: job.id,
            },);
            await rm(mp4, { force: true, },);
            tick();
        }
        if (tPrefix !== oldTeaser) {
            await cache.invalidateVideoCache(mediaId,);
            if (oldTeaser) {
                await store.deletePrefix(`${oldTeaser}/`,).catch((e: Error,) =>
                    logger.warn('Video: old teaser cleanup failed', { prefix: oldTeaser, error: e.message, },)
                );
            }
        }
    }

    await repo.finishJob(job.id, 'ready',);
    await removeJobDir(job.id,);
    await cache.invalidateVideoCache(mediaId,);
}
