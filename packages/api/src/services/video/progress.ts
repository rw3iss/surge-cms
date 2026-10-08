/**
 * Progress (pure): parse ffmpeg's `-progress pipe:1` key=value stream, and
 * weigh per-rendition progress into one job percentage.
 */

export interface ProgressTick {
    /** Output position in microseconds, when reported. */
    outTimeUs: number | null;
    /** `progress=end` — ffmpeg finished writing. */
    done: boolean;
}

/** `HH:MM:SS.micro` → microseconds. */
function hmsToUs(s: string,): number | null {
    const m = /^(-)?(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(s.trim(),);
    if (!m || m[1]) return null;
    return Math.round(((Number(m[2],) * 60 + Number(m[3],)) * 60 + Number(m[4],)) * 1e6,);
}

/**
 * Stateful line parser. ffmpeg writes a block of `key=value` lines ending in
 * `progress=continue|end`; chunks may split lines anywhere.
 */
export class ProgressParser {
    private buf = '';
    private outUs: number | null = null;

    feed(chunk: string,): ProgressTick[] {
        this.buf += chunk;
        const lines = this.buf.split(/\r?\n/,);
        this.buf = lines.pop() ?? '';
        const ticks: ProgressTick[] = [];
        for (const line of lines) {
            const eq = line.indexOf('=',);
            if (eq < 0) continue;
            const key = line.slice(0, eq,).trim();
            const val = line.slice(eq + 1,).trim();
            if (key === 'out_time_us' || key === 'out_time_ms') {
                // Both are microseconds (out_time_ms is misnamed in ffmpeg).
                const n = Number(val,);
                if (Number.isFinite(n,) && n >= 0) this.outUs = n;
            } else if (key === 'out_time' && this.outUs === null) {
                const us = hmsToUs(val,);
                if (us !== null) this.outUs = us;
            } else if (key === 'progress') {
                ticks.push({ outTimeUs: this.outUs, done: val === 'end', },);
                this.outUs = null;
            }
        }
        return ticks;
    }
}

/** Fraction 0–1 of `durationUs` reached (clamped; 0 when unknown). */
export function fractionDone(outTimeUs: number | null, durationUs: number,): number {
    if (outTimeUs === null || !(durationUs > 0)) return 0;
    return Math.min(1, Math.max(0, outTimeUs / durationUs,),);
}

export interface ProgressItem {
    variant: 'full' | 'teaser';
    width: number | null;
    height: number | null;
    /** 0–100. */
    progress: number;
}

/**
 * Overall job progress 0–100, pixel-weighted: a 1080p rung counts ~9× a 360p
 * one. Teaser rungs are a stream copy (cheap), so each weighs 2 % of the
 * smallest full rung. Fixed 5 % for the download and 5 % for finalising.
 */
export function overallProgress(items: ProgressItem[], phase: { downloaded: boolean; finalized: boolean; },): number {
    const px = (i: ProgressItem,) => Math.max(1, (i.width ?? 0) * (i.height ?? 0),);
    const fulls = items.filter((i,) => i.variant === 'full');
    const minFull = fulls.length > 0 ? Math.min(...fulls.map(px,),) : 1;
    let wSum = 0;
    let pSum = 0;
    for (const i of items) {
        const w = i.variant === 'full' ? px(i,) : 0.02 * minFull;
        wSum += w;
        pSum += w * Math.min(100, Math.max(0, i.progress,),) / 100;
    }
    const enc = wSum > 0 ? pSum / wSum : 0;
    const total = (phase.downloaded ? 5 : 0) + 90 * enc + (phase.finalized ? 5 : 0);
    return Math.round(Math.min(100, total,) * 100,) / 100;
}
