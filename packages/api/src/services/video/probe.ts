/**
 * ffprobe: run it, and turn its JSON into the few facts the encoder needs.
 *
 * `parseProbe` is pure (unit-tested). DISPLAY dimensions are what matter for
 * the ladder: ffmpeg auto-rotates on decode, so a phone clip stored as
 * 1920×1080 with a 90° rotation encodes as 1080×1920 — and a non-square
 * sample aspect ratio is folded into the width.
 */
import { runProcess, } from './tooling';

export interface ProbeInfo {
    durationMs: number;
    /** Coded size, as stored. */
    width: number;
    height: number;
    /** Size after rotation + sample aspect ratio (what the viewer sees). */
    displayWidth: number;
    displayHeight: number;
    rotation: number;
    fps: number | null;
    videoCodec: string | null;
    audioCodec: string | null;
    hasAudio: boolean;
    bitrate: number | null;
}

export class NoVideoStreamError extends Error {
    constructor() {
        super('The uploaded file has no video stream (is it an audio file or a damaged upload?).',);
        this.name = 'NoVideoStreamError';
    }
}

interface FfStream {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    sample_aspect_ratio?: string;
    duration?: string;
    tags?: Record<string, string>;
    side_data_list?: Array<{ rotation?: number | string; }>;
    disposition?: { attached_pic?: number; };
}

const rate = (s?: string,): number | null => {
    if (!s) return null;
    const [a, b,] = s.split('/',).map(Number,);
    if (!Number.isFinite(a,) || !b) return null;
    const v = a / b;
    return v > 0 && v < 1000 ? Math.round(v * 1000,) / 1000 : null;
};

const even = (n: number,): number => Math.max(2, Math.round(n / 2,) * 2,);

/** Pure: ffprobe `-show_format -show_streams` JSON → ProbeInfo. */
export function parseProbe(json: unknown,): ProbeInfo {
    const j = (json ?? {}) as { streams?: FfStream[]; format?: { duration?: string; bit_rate?: string; }; };
    const streams = j.streams ?? [];
    // Cover art in an audio file is a "video" stream with attached_pic.
    const v = streams.find((s,) => s.codec_type === 'video' && !s.disposition?.attached_pic && s.width && s.height);
    if (!v) throw new NoVideoStreamError();
    const a = streams.find((s,) => s.codec_type === 'audio');

    let rotation = 0;
    for (const sd of v.side_data_list ?? []) {
        if (sd.rotation !== undefined && Number.isFinite(Number(sd.rotation,),)) rotation = Number(sd.rotation,);
    }
    if (!rotation && v.tags?.rotate) rotation = Number(v.tags.rotate,) || 0;
    rotation = ((Math.round(rotation,) % 360) + 360) % 360;

    const width = v.width!;
    const height = v.height!;
    let dispW = width;
    const sar = /^(\d+):(\d+)$/.exec(v.sample_aspect_ratio ?? '',);
    if (sar && Number(sar[1],) > 0 && Number(sar[2],) > 0 && sar[1] !== sar[2]) {
        dispW = even(width * Number(sar[1],) / Number(sar[2],),);
    }
    let dispH = height;
    if (rotation === 90 || rotation === 270) [dispW, dispH,] = [dispH, dispW,];

    const durSec = Number(j.format?.duration ?? v.duration ?? 0,);
    const br = Number(j.format?.bit_rate,);
    return {
        durationMs: Number.isFinite(durSec,) && durSec > 0 ? Math.round(durSec * 1000,) : 0,
        width,
        height,
        displayWidth: dispW,
        displayHeight: dispH,
        rotation,
        fps: rate(v.avg_frame_rate,) ?? rate(v.r_frame_rate,),
        videoCodec: v.codec_name ?? null,
        audioCodec: a?.codec_name ?? null,
        hasAudio: Boolean(a,),
        bitrate: Number.isFinite(br,) && br > 0 ? br : null,
    };
}

/** Run ffprobe on a local file. */
export async function probeFile(ffprobe: string, file: string, signal?: AbortSignal,): Promise<ProbeInfo> {
    const r = await runProcess(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,], {
        timeoutMs: 120_000,
        signal,
        captureStdout: true,
    },);
    if (r.code !== 0) throw new Error(`ffprobe failed: ${r.stderrTail || `exit ${r.code}`}`,);
    let json: unknown;
    try {
        json = JSON.parse(r.stdout,);
    } catch {
        throw new Error('ffprobe returned unreadable output — the file is probably not a video.',);
    }
    return parseProbe(json,);
}
