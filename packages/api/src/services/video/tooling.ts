/**
 * Encoder tooling: is ffmpeg/ffprobe (with libx264) installed, where do temp
 * files go, how much disk is free, can the storage take video — plus the
 * one process runner every ffmpeg call goes through.
 *
 * Binary detection is cached (it shells out); disk and storage are read fresh
 * on each call (cheap). Env: `FFMPEG_PATH`, `FFPROBE_PATH`, `VIDEO_TEMP_DIR`,
 * `VIDEO_ENCODER_ENABLED=false`.
 */
import { spawn, } from 'child_process';
import { mkdir, statfs, } from 'fs/promises';
import type { VideoToolingStatus, } from '@sitesurge/types';
import { logger, } from '../../utils/logger';
import { isObjectStore, resolveStorageProvider, } from '../storage';
import type { LowPriority, } from './ffmpegArgs';
import { threadsMax, } from './settings';

export const ffmpegBin = (): string => process.env.FFMPEG_PATH || 'ffmpeg';
export const ffprobeBin = (): string => process.env.FFPROBE_PATH || 'ffprobe';
export const videoTempDir = (): string => process.env.VIDEO_TEMP_DIR || '/var/tmp/sitesurge-video';
export const encoderEnabled = (): boolean => process.env.VIDEO_ENCODER_ENABLED !== 'false';

/** Thrown when a run is stopped through its AbortSignal (cancel / lease / shutdown). */
export class ProcessAbortedError extends Error {
    constructor(bin: string,) {
        super(`${bin} was stopped`,);
        this.name = 'ProcessAbortedError';
    }
}

export interface RunResult {
    code: number;
    stdout: string;
    /** Last 4 KB of stderr. */
    stderrTail: string;
}

export interface RunOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
    captureStdout?: boolean;
    onStdout?: (chunk: string,) => void;
}

const TAIL = 4096;

/**
 * Spawn without a shell. Abort → SIGTERM, then SIGKILL after 5 s, and the
 * promise rejects with `ProcessAbortedError`. A missing binary → `code: 127`.
 */
export function runProcess(bin: string, args: string[], opts: RunOptions = {},): Promise<RunResult> {
    return new Promise((resolve, reject,) => {
        if (opts.signal?.aborted) return reject(new ProcessAbortedError(bin,),);
        const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe',], },);
        let stdout = '';
        let stderr = '';
        let settled = false;
        let aborted = false;
        let killTimer: NodeJS.Timeout | null = null;

        const stop = () => {
            aborted = true;
            child.kill('SIGTERM',);
            killTimer = setTimeout(() => child.kill('SIGKILL',), 5000,);
            killTimer.unref();
        };
        const timer = opts.timeoutMs ? setTimeout(stop, opts.timeoutMs,) : null;
        opts.signal?.addEventListener('abort', stop, { once: true, },);

        child.stdout.setEncoding('utf8',);
        child.stdout.on('data', (d: string,) => {
            if (opts.captureStdout && stdout.length < 16_000_000) stdout += d;
            opts.onStdout?.(d,);
        },);
        child.stderr.setEncoding('utf8',);
        child.stderr.on('data', (d: string,) => {
            stderr = (stderr + d).slice(-TAIL,);
        },);
        const done = () => {
            if (timer) clearTimeout(timer,);
            if (killTimer) clearTimeout(killTimer,);
            opts.signal?.removeEventListener('abort', stop,);
        };
        child.on('error', (err: NodeJS.ErrnoException,) => {
            if (settled) return;
            settled = true;
            done();
            if (err.code === 'ENOENT') resolve({ code: 127, stdout, stderrTail: `${bin}: not found`, },);
            else reject(err,);
        },);
        child.on('close', (code,) => {
            if (settled) return;
            settled = true;
            done();
            if (aborted && opts.signal?.aborted) return reject(new ProcessAbortedError(bin,),);
            if (aborted) return resolve({ code: code ?? -1, stdout, stderrTail: `${stderr}\n${bin} timed out`.slice(-TAIL,), },);
            resolve({ code: code ?? -1, stdout, stderrTail: stderr, },);
        },);
    },);
}

interface Binaries {
    ffmpeg: boolean;
    ffprobe: boolean;
    libx264: boolean;
    version: string | null;
    lowPriority: LowPriority;
}

let cached: Binaries | null = null;
let warned = false;

async function detect(): Promise<Binaries> {
    const t = { timeoutMs: 15_000, captureStdout: true, };
    const [enc, ver, probe, nice, ionice,] = await Promise.all([
        runProcess(ffmpegBin(), ['-hide_banner', '-encoders',], t,).catch(() => null),
        runProcess(ffmpegBin(), ['-version',], t,).catch(() => null),
        runProcess(ffprobeBin(), ['-version',], t,).catch(() => null),
        runProcess('nice', ['-n', '19', 'true',], t,).catch(() => null),
        runProcess('ionice', ['-c3', 'true',], t,).catch(() => null),
    ],);
    const ffmpeg = enc?.code === 0;
    const b: Binaries = {
        ffmpeg,
        ffprobe: probe?.code === 0,
        libx264: ffmpeg && /\blibx264\b/.test(enc!.stdout,),
        version: ver?.code === 0 ? (/ffmpeg version (\S+)/.exec(ver.stdout,)?.[1] ?? null) : null,
        lowPriority: { nice: nice?.code === 0, ionice: ionice?.code === 0, },
    };
    if ((!b.ffmpeg || !b.ffprobe || !b.libx264) && !warned) {
        warned = true;
        logger.warn('Video encoder: ffmpeg/ffprobe with libx264 not found — video jobs will wait in the queue', {
            ffmpeg: b.ffmpeg, ffprobe: b.ffprobe, libx264: b.libx264,
        },);
    }
    return b;
}

export async function binaries(refresh = false,): Promise<Binaries> {
    if (!cached || refresh) cached = await detect();
    return cached;
}

/** Free bytes on the temp dir's filesystem (creates the dir), null when unreadable. */
export async function diskFreeBytes(): Promise<number | null> {
    try {
        await mkdir(videoTempDir(), { recursive: true, },);
        const s = await statfs(videoTempDir(),);
        return Number(s.bavail,) * Number(s.bsize,);
    } catch {
        return null;
    }
}

export async function videoToolingStatus(opts: { refresh?: boolean; } = {},): Promise<VideoToolingStatus> {
    const b = await binaries(opts.refresh === true,);
    let storageReady = false;
    let storageProblem: string | null = null;
    try {
        storageReady = isObjectStore(await resolveStorageProvider(),);
        if (!storageReady) storageProblem = 'Video needs S3-compatible object storage (Settings → Media → Storage).';
    } catch (e) {
        storageProblem = (e as Error).message;
    }
    return {
        ffmpeg: b.ffmpeg,
        ffprobe: b.ffprobe,
        libx264: b.libx264,
        version: b.version,
        encoderEnabled: encoderEnabled(),
        tempDir: videoTempDir(),
        diskFreeBytes: await diskFreeBytes(),
        storageReady,
        storageProblem,
        threadsMax: threadsMax(),
    };
}
