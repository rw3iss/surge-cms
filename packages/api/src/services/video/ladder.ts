/**
 * The encode ladder (pure): which renditions a source gets, their sizes, the
 * order to encode them in, and the rendition rows to plan.
 */
import type { VideoLadderRung, VideoSettings, } from '@sitesurge/types';
import type { RenditionPlan, } from '../../repositories/video.repo';

export interface PlannedRung {
    name: string;
    width: number;
    height: number;
    maxrateKbps: number;
    bufsizeKbps: number;
    audioKbps: number;
    /** x264 `-level` (e.g. `3.1`) — matches the `codecs` string. */
    level: string;
    /** `avc1.6400xx,mp4a.40.2` for `#EXT-X-STREAM-INF:CODECS`. */
    codecs: string;
    /** Peak bits/s (BANDWIDTH). */
    bandwidth: number;
    /** Estimated average bits/s (AVERAGE-BANDWIDTH). */
    avgBandwidth: number;
    /** 0 = the highest quality. */
    sortOrder: number;
}

const even = (n: number,): number => Math.max(2, Math.round(n / 2,) * 2,);

/** H.264 levels: [level, max frame size in macroblocks, max macroblocks/s]. */
const LEVELS: Array<[number, number, number,]> = [
    [30, 1620, 40500,],
    [31, 3600, 108000,],
    [32, 5120, 216000,],
    [40, 8192, 245760,],
    [42, 8704, 522240,],
    [50, 22080, 589824,],
    [51, 36864, 983040,],
    [52, 36864, 2073600,],
];

/** Smallest H.264 level that fits a size + frame rate (High profile). */
export function avcLevel(width: number, height: number, fps: number | null,): number {
    const fs = Math.ceil(width / 16,) * Math.ceil(height / 16,);
    const mbps = fs * Math.min(Math.max(fps ?? 30, 1,), 240,);
    for (const [lvl, maxFs, maxMbps,] of LEVELS) {
        if (fs <= maxFs && mbps <= maxMbps) return lvl;
    }
    return 52;
}

export function codecsFor(level: number,): string {
    // profile_idc 0x64 (High), constraint flags 0x00, level_idc.
    return `avc1.6400${level.toString(16,).padStart(2, '0',)},mp4a.40.2`;
}

/**
 * Pick the rungs for a source of display size `srcW`×`srcH`: every enabled
 * rung no taller than the source; at least one (the source height itself
 * when the source is below the lowest rung). Returned highest-first.
 */
export function selectRungs(ladder: VideoLadderRung[], srcW: number, srcH: number, fps: number | null,): PlannedRung[] {
    const enabled = ladder.filter((r,) => r.enabled).sort((a, b,) => b.height - a.height);
    const pool = enabled.length > 0 ? enabled : [...ladder,].sort((a, b,) => b.height - a.height);
    let picked = pool.filter((r,) => r.height <= srcH);
    if (picked.length === 0) {
        const lowest = pool[pool.length - 1];
        const h = even(srcH,);
        picked = [{ ...lowest, name: `${h}p`, height: h, },];
    }
    return picked.map((r, i,) => {
        const height = even(r.height,);
        const width = even(srcW * height / srcH,);
        const lvl = avcLevel(width, height, fps,);
        const peak = Math.round((r.maxrateKbps + r.audioKbps) * 1000 * 1.1,);
        return {
            name: r.name,
            width,
            height,
            maxrateKbps: r.maxrateKbps,
            bufsizeKbps: r.maxrateKbps * 2,
            audioKbps: r.audioKbps,
            level: (lvl / 10).toFixed(1,),
            codecs: codecsFor(lvl,),
            bandwidth: peak,
            // CRF under a cap typically averages ~70 % of the cap.
            avgBandwidth: Math.round((r.maxrateKbps * 0.7 + r.audioKbps) * 1000,),
            sortOrder: i,
        };
    },);
}

/** `fast-first`: lowest rung first (playable within minutes), then top-down. */
export function encodeOrder(rungs: PlannedRung[], order: VideoSettings['encodeOrder'],): PlannedRung[] {
    const desc = [...rungs,].sort((a, b,) => b.height - a.height);
    if (order === 'top-down' || desc.length < 2) return desc;
    return [desc[desc.length - 1], ...desc.slice(0, -1,),];
}

/** Teaser rungs: those ≤ `maxHeight`, and at least the lowest. */
export function teaserRungs(rungs: PlannedRung[], maxHeight: number,): PlannedRung[] {
    const desc = [...rungs,].sort((a, b,) => b.height - a.height);
    const fit = desc.filter((r,) => r.height <= maxHeight);
    return fit.length > 0 ? fit : desc.slice(-1,);
}

/** Rendition rows for `repo.syncRenditions`. */
export function renditionPlan(full: PlannedRung[], teaser: PlannedRung[],): RenditionPlan[] {
    const row = (variant: 'full' | 'teaser', r: PlannedRung,): RenditionPlan => ({
        variant,
        name: r.name,
        sortOrder: r.sortOrder,
        width: r.width,
        height: r.height,
        bandwidth: r.bandwidth,
        avgBandwidth: r.avgBandwidth,
        codecs: r.codecs,
    });
    return [...full.map((r,) => row('full', r,)), ...teaser.map((r,) => row('teaser', r,)),];
}
