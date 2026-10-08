/**
 * The video encoder loop. Runs on the cluster PRIMARY only (wired in lib.ts).
 *
 * One job at a time: poll every 10 s when idle, claim under a 90 s LEASE,
 * heartbeat every 20 s (and on every progress write). A lost lease kills
 * ffmpeg and walks away (another process owns the job); a cancel request
 * kills ffmpeg, cleans up and finishes `cancelled`; shutdown kills ffmpeg
 * and gives the job back so the next boot takes it at once.
 *
 * Off when the `video` feature is disabled (checked every poll) or when
 * `VIDEO_ENCODER_ENABLED=false` on this host.
 */
import os from 'os';
import crypto from 'crypto';
import * as repo from '../../repositories/video.repo';
import * as wrepo from '../../repositories/videoWorker.repo';
import { logger, } from '../../utils/logger';
import * as cache from '../cache';
import { isFeatureEnabledServer, } from '../settings';
import {
    backoffSeconds,
    BlockedError,
    JobAbortedError,
    JobControl,
    type JobRun,
    PermanentJobError,
    removeJobDir,
    runEncodeJob,
} from './pipeline';
import { runRepackageJob, } from './repackage';
import { encoderEnabled, } from './tooling';

const POLL_MS = 10_000;
const LEASE_SECONDS = 90;
const HEARTBEAT_MS = 20_000;
const CANCEL_CHECK_MS = 5_000;
const SHUTDOWN_WAIT_MS = 10_000;

const owner = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3,).toString('hex',)}`;

let started = false;
let stopping = false;
let timer: NodeJS.Timeout | null = null;
let current: { ctl: JobControl; done: Promise<void>; } | null = null;

export function startVideoWorker(): void {
    if (started) return;
    if (!encoderEnabled()) {
        logger.info('Video encoder disabled on this host (VIDEO_ENCODER_ENABLED=false)',);
        return;
    }
    started = true;
    stopping = false;
    schedule(5_000,);
    logger.info('Video encoder worker started', { owner, },);
}

export async function stopVideoWorker(): Promise<void> {
    stopping = true;
    started = false;
    if (timer) clearTimeout(timer,);
    timer = null;
    const c = current;
    if (!c) return;
    c.ctl.abort('shutdown',);
    await Promise.race([c.done, new Promise((r,) => setTimeout(r, SHUTDOWN_WAIT_MS,).unref()),],);
}

function schedule(ms: number,): void {
    if (stopping) return;
    if (timer) clearTimeout(timer,);
    timer = setTimeout(() => void tick(), ms,);
    timer.unref();
}

async function tick(): Promise<void> {
    timer = null;
    if (stopping) return;
    let next = POLL_MS;
    try {
        if (await isFeatureEnabledServer('video',)) {
            const job = await repo.claimJob(owner, LEASE_SECONDS,);
            if (job && stopping) {
                await repo.releaseJob(job.id, owner,);
                return;
            }
            if (job) {
                const ctl = new JobControl();
                const done = runJob(job, ctl,);
                current = { ctl, done, };
                await done;
                current = null;
                next = 0; // more may be waiting
            }
        }
    } catch (err) {
        current = null;
        logger.error('Video worker poll failed', { error: (err as Error).message, },);
    }
    schedule(next,);
}

async function runJob(job: repo.ClaimedJob, ctl: JobControl,): Promise<void> {
    let beating: Promise<void> | null = null;
    const beatOnce = async (): Promise<void> => {
        try {
            const ok = await repo.heartbeat(job.id, owner, { progress: ctl.progress, status: ctl.status, }, LEASE_SECONDS,);
            if (!ok) {
                logger.warn('Video job lease lost — stopping', { jobId: job.id, },);
                ctl.abort('lease',);
            }
        } catch (e) {
            logger.warn('Video heartbeat failed', { jobId: job.id, error: (e as Error).message, },);
        } finally {
            beating = null;
        }
    };
    ctl.beat = (): Promise<void> => {
        if (ctl.reason === 'lease') return Promise.resolve();
        beating ??= beatOnce();
        return beating;
    };
    const hb = setInterval(() => void ctl.beat(), HEARTBEAT_MS,);
    const cc = setInterval(() => {
        void repo.isCancelRequested(job.id,).then((yes,) => {
            if (yes) ctl.abort('cancel',);
        }, () => {},);
    }, CANCEL_CHECK_MS,);
    const run: JobRun = { job, ctl, };
    logger.info('Video job started', { jobId: job.id, mediaId: job.mediaId, kind: job.kind, attempt: job.attempts, },);
    try {
        if (job.kind === 'repackage') await runRepackageJob(run,);
        else await runEncodeJob(run,);
        logger.info('Video job finished', { jobId: job.id, mediaId: job.mediaId, },);
    } catch (err) {
        await onError(job, ctl, err,).catch((e: Error,) => logger.error('Video job error handling failed', { jobId: job.id, error: e.message, },));
    } finally {
        clearInterval(hb,);
        clearInterval(cc,);
    }
}

async function onError(job: repo.ClaimedJob, ctl: JobControl, err: unknown,): Promise<void> {
    const reason = ctl.reason ?? (err instanceof JobAbortedError ? err.reason : null);
    if (reason === 'lease') return; // someone else owns it now
    if (reason === 'shutdown') {
        await repo.releaseJob(job.id, owner,);
        logger.info('Video job released for the next boot', { jobId: job.id, },);
        return;
    }
    if (reason === 'cancel') {
        await wrepo.resetInFlightRenditions(job.mediaId,);
        await repo.finishJob(job.id, 'cancelled',);
        await removeJobDir(job.id,);
        if (!(await wrepo.hasReadyFull(job.mediaId,))) await wrepo.setMediaStatus(job.mediaId, 'failed',);
        await cache.invalidateVideoCache(job.mediaId,);
        logger.info('Video job cancelled', { jobId: job.id, },);
        return;
    }
    if (err instanceof BlockedError) {
        await repo.blockJob(job.id, err.reason, err.retrySeconds,);
        logger.warn('Video job blocked', { jobId: job.id, reason: err.reason, detail: err.message, },);
        return;
    }
    const msg = (err as Error)?.message ?? String(err,);
    if (err instanceof PermanentJobError) {
        await repo.finishJob(job.id, 'failed', msg,);
        await failedCleanup(job.mediaId, job.id,);
        logger.warn('Video job failed (not retryable)', { jobId: job.id, error: msg, },);
        return;
    }
    const outcome = await repo.failAttempt(job.id, msg, backoffSeconds(job.attempts,),);
    logger.error('Video job attempt failed', { jobId: job.id, attempt: job.attempts, outcome, error: msg.slice(-1000,), },);
    if (outcome === 'failed') await failedCleanup(job.mediaId, job.id,);
}

async function failedCleanup(mediaId: string, jobId: string,): Promise<void> {
    await removeJobDir(jobId,);
    if (!(await wrepo.hasReadyFull(mediaId,))) await wrepo.setMediaStatus(mediaId, 'failed',);
    await cache.invalidateVideoCache(mediaId,);
}
