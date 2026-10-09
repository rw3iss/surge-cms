/**
 * ffmpeg argument builders (pure). Every command the encoder runs is built
 * here so it can be unit-tested and smoke-tested apart from the pipeline.
 */
import type { PlannedRung, } from './ladder';

export interface LowPriority {
    /** `nice` is available. */
    nice: boolean;
    /** `ionice` is available (Linux util-linux). */
    ionice: boolean;
}

/** Wrap a command in `nice -n 19 ionice -c3` where available. Both exec the
 *  target, so the child pid IS ffmpeg's and a kill reaches it. */
export function lowPriority(bin: string, args: string[], lp: LowPriority,): { cmd: string; args: string[]; } {
    const prefix: string[] = [];
    if (lp.nice) prefix.push('nice', '-n', '19',);
    if (lp.ionice) prefix.push('ionice', '-c3',);
    if (prefix.length === 0) return { cmd: bin, args, };
    return { cmd: prefix[0], args: [...prefix.slice(1,), bin, ...args,], };
}

const COMMON = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'warning',];

export interface EncodeArgsInput {
    input: string;
    output: string;
    rung: PlannedRung;
    threads: number;
    preset: string;
    crf: number;
    segmentSeconds: number;
}

/** Source → one rung's H.264/AAC MP4 (faststart), keyframes on the segment grid. */
export function encodeArgs(i: EncodeArgsInput,): string[] {
    const r = i.rung;
    const seg = i.segmentSeconds;
    return [
        ...COMMON,
        '-i', i.input,
        '-threads', String(i.threads,), '-filter_threads', '1',
        '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', `scale=${r.width}:${r.height}:flags=bicubic,setsar=1,format=yuv420p`,
        '-c:v', 'libx264', '-preset', i.preset, '-profile:v', 'high', '-level:v', r.level,
        '-crf', String(i.crf,), '-maxrate', `${r.maxrateKbps}k`, '-bufsize', `${r.bufsizeKbps}k`,
        // Keyframes by TIME, identical in every rung → seamless switching and
        // segment cuts exactly every `seg` seconds when re-packaging by copy.
        '-force_key_frames', `expr:gte(t,n_forced*${seg})`, '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', `${r.audioKbps}k`, '-ac', '2', '-ar', '48000',
        '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats',
        '-f', 'mp4', i.output,
    ];
}

export interface HlsArgsInput {
    input: string;
    /** Output directory (no trailing slash). */
    dir: string;
    segmentSeconds: number;
    /** `-hls_key_info_file` — ONLY for an encrypted (private) full rendition. */
    keyInfoFile?: string | null;
}

/** A rung MP4 → HLS VOD (MPEG-TS segments), stream copy — no re-encode. */
export function hlsPackageArgs(i: HlsArgsInput,): string[] {
    return [
        ...COMMON,
        '-i', i.input,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-c', 'copy',
        '-f', 'hls', '-hls_time', String(i.segmentSeconds,), '-hls_playlist_type', 'vod',
        '-hls_segment_type', 'mpegts', '-hls_flags', 'independent_segments',
        '-hls_segment_filename', `${i.dir}/seg_%05d.ts`,
        ...(i.keyInfoFile ? ['-hls_key_info_file', i.keyInfoFile,] : []),
        `${i.dir}/index.m3u8`,
    ];
}

/** Cut the teaser out of a rung MP4 by stream copy. The rung has a keyframe
 *  every segment, so input-seeking lands within one segment of `startSec`. */
export function teaserCutArgs(i: { input: string; output: string; startSec: number; durationSec: number; },): string[] {
    return [
        ...COMMON,
        '-ss', String(i.startSec,),
        '-i', i.input,
        '-t', String(i.durationSec,),
        '-map', '0:v:0', '-map', '0:a:0?',
        '-c', 'copy', '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        '-f', 'mp4', i.output,
    ];
}

/** One frame at `atSec`, ≤ 1280 wide. */
export function posterArgs(i: { input: string; output: string; atSec: number; },): string[] {
    return [
        ...COMMON,
        '-ss', String(Math.max(0, i.atSec,),),
        '-i', i.input,
        '-frames:v', '1',
        '-vf', `scale='min(1280,iw)':-2`,
        '-q:v', '3', '-update', '1',
        i.output,
    ];
}

/**
 * Quick replay: copy an H.264 recording into a seekable, faststart MP4 —
 * the video stream untouched (no quality loss, little CPU), audio → AAC (the
 * one universally playable audio codec; a browser often records Opus). The
 * MP4 plays in every browser and carries the duration/seek index a
 * MediaRecorder file lacks.
 */
export function quickReplayArgs(i: { input: string; output: string; hasAudio: boolean; },): string[] {
    return [
        ...COMMON,
        // MediaRecorder output can have unset/odd timestamps.
        '-fflags', '+genpts',
        '-i', i.input,
        '-map', '0:v:0',
        ...(i.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',] : []),
        '-c:v', 'copy',
        '-movflags', '+faststart',
        '-f', 'mp4',
        i.output,
    ];
}

/**
 * Container repair for a recording that cannot be quick-replayed (VP8/VP9):
 * a stream copy into Matroska writes the duration + cues a MediaRecorder WebM
 * lacks, so the encode (which needs a duration) can proceed.
 */
export function remuxArgs(i: { input: string; output: string; },): string[] {
    return [...COMMON, '-fflags', '+genpts', '-i', i.input, '-map', '0', '-c', 'copy', '-f', 'matroska', i.output,];
}

export const SPRITE_INTERVAL_SEC = 10;
export const SPRITE_COLS = 10;
export const SPRITE_ROWS = 10;
export const SPRITE_THUMB_WIDTH = 160;

/** Scrub-bar sprite sheets: one 160px frame every 10 s, 10×10 per sheet,
 *  written as `<dir>/sprite_1.jpg`, `sprite_2.jpg`, … */
export function spriteArgs(i: { input: string; dir: string; },): string[] {
    return [
        ...COMMON,
        '-i', i.input,
        '-an',
        '-vf', `fps=1/${SPRITE_INTERVAL_SEC},scale=${SPRITE_THUMB_WIDTH}:-2,tile=${SPRITE_COLS}x${SPRITE_ROWS}`,
        '-q:v', '5',
        '-start_number', '1',
        `${i.dir}/sprite_%d.jpg`,
    ];
}

const vttTime = (sec: number,): string => {
    const ms = Math.round(sec * 1000,);
    const h = Math.floor(ms / 3_600_000,);
    const m = Math.floor((ms % 3_600_000) / 60_000,);
    const s = Math.floor((ms % 60_000) / 1000,);
    const f = ms % 1000;
    const p = (n: number, w = 2,) => String(n,).padStart(w, '0',);
    return `${p(h,)}:${p(m,)}:${p(s,)}.${p(f, 3,)}`;
};

/**
 * The WebVTT index for the sprite sheets: one cue per thumbnail with an
 * absolute sprite URL + `#xywh=` crop (Plyr `previewThumbnails`).
 */
export function spriteVtt(i: {
    durationSec: number;
    tileWidth: number;
    tileHeight: number;
    spriteUrl: (n: number,) => string;
    intervalSec?: number;
    cols?: number;
    rows?: number;
},): string {
    const interval = i.intervalSec ?? SPRITE_INTERVAL_SEC;
    const cols = i.cols ?? SPRITE_COLS;
    const perSheet = cols * (i.rows ?? SPRITE_ROWS);
    const count = Math.max(1, Math.ceil(i.durationSec / interval,),);
    const out = ['WEBVTT', '',];
    for (let k = 0; k < count; k++) {
        const start = k * interval;
        const end = Math.min(i.durationSec, (k + 1) * interval,);
        const sheet = Math.floor(k / perSheet,) + 1;
        const pos = k % perSheet;
        const x = (pos % cols) * i.tileWidth;
        const y = Math.floor(pos / cols,) * i.tileHeight;
        out.push(`${vttTime(start,)} --> ${vttTime(Math.max(end, start + 0.001,),)}`,);
        out.push(`${i.spriteUrl(sheet,)}#xywh=${x},${y},${i.tileWidth},${i.tileHeight}`,);
        out.push('',);
    }
    return out.join('\n',);
}

/** How many sprite sheets a duration produces. */
export const spriteSheetCount = (durationSec: number,): number =>
    Math.max(1, Math.ceil(Math.max(1, Math.ceil(durationSec / SPRITE_INTERVAL_SEC,),) / (SPRITE_COLS * SPRITE_ROWS),),);
