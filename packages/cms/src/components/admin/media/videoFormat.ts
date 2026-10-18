/** Small display formatters shared by the upload tray and the video panels. */
import { formatSize, } from './mediaUtils';

/** Same as `mediaUtils.formatSize` (kept as a name for the tray / video panels). */
export const formatBytes = formatSize;

/** `1:02:03` / `4:05` from milliseconds. */
export function formatDuration(ms: number | null | undefined,): string {
    if (!ms || ms < 0) return '';
    const total = Math.round(ms / 1000,);
    const h = Math.floor(total / 3600,);
    const m = Math.floor((total % 3600) / 60,);
    const s = total % 60;
    const ss = String(s,).padStart(2, '0',);
    return h ? `${h}:${String(m,).padStart(2, '0',)}:${ss}` : `${m}:${ss}`;
}

/** `2h 5m`, `4m 10s`, `12s` — a time-left estimate. */
export function formatEta(seconds: number | null | undefined,): string {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds,)) return '';
    const s = Math.max(0, Math.round(seconds,),);
    if (s >= 3600) return `${Math.floor(s / 3600,)}h ${Math.floor((s % 3600) / 60,)}m`;
    if (s >= 60) return `${Math.floor(s / 60,)}m ${s % 60}s`;
    return `${s}s`;
}

export function formatSpeed(bytesPerSecond: number,): string {
    return bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond,)}/s` : '';
}
