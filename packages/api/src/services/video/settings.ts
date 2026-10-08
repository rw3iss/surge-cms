/**
 * Effective video settings: the `video_settings` row over built-in defaults,
 * with env overrides where an operator may want to pin a value per host
 * (`VIDEO_ENCODE_THREADS`). Every field is clamped, so a hand-edited row can
 * never hand ffmpeg a nonsense argument.
 */
import os from 'os';
import type { VideoLadderRung, VideoSettings, } from '@sitesurge/types';
import type { AuditContext, } from '../types';
import { getVideoSettingsRaw, setVideoSettingsRaw, } from '../settings';

export const DEFAULT_LADDER: VideoLadderRung[] = [
    { name: '1080p', height: 1080, maxrateKbps: 5000, audioKbps: 128, enabled: true, },
    { name: '720p', height: 720, maxrateKbps: 2800, audioKbps: 128, enabled: true, },
    { name: '480p', height: 480, maxrateKbps: 1200, audioKbps: 96, enabled: true, },
    { name: '360p', height: 360, maxrateKbps: 700, audioKbps: 96, enabled: true, },
];

export const VIDEO_SETTINGS_DEFAULTS: VideoSettings = {
    encodeThreads: 1,
    preset: 'veryfast',
    crf: 21,
    segmentSeconds: 6,
    ladder: DEFAULT_LADDER,
    encodeOrder: 'fast-first',
    defaultQuality: 'auto',
    maxUploadGb: 20,
    partSizeMb: 64,
    keepOriginal: true,
    originalRetentionDays: 90,
    teaserEnabled: true,
    teaserSeconds: 60,
    teaserStartSeconds: 0,
    teaserMaxHeight: 720,
    downloadsEnabled: true,
    posterAtPercent: 10,
    sprites: true,
    minFreeDiskGb: 5,
    keyBaseUrl: '',
};

const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium',] as const;

const clamp = (v: unknown, min: number, max: number, dflt: number,): number => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v,) : NaN;
    return Number.isFinite(n,) ? Math.min(max, Math.max(min, n,),) : dflt;
};
const bool = (v: unknown, dflt: boolean,): boolean => (typeof v === 'boolean' ? v : dflt);

export function threadsMax(): number {
    return typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
}

/** Pure: raw row (+ env) → a valid `VideoSettings`. Exported for tests. */
export function normalizeVideoSettings(raw: Partial<VideoSettings> | null | undefined, env: NodeJS.ProcessEnv = process.env,): VideoSettings {
    const r = raw ?? {};
    const d = VIDEO_SETTINGS_DEFAULTS;
    const ladderIn = Array.isArray(r.ladder,) && r.ladder.length > 0 ? r.ladder : d.ladder;
    const ladder = ladderIn
        .filter((x,) => x && typeof x.name === 'string' && x.name.trim() !== '')
        .map((x,) => ({
            name: x.name.trim().slice(0, 16,),
            height: Math.round(clamp(x.height, 144, 4320, 480,),),
            maxrateKbps: Math.round(clamp(x.maxrateKbps, 100, 50000, 1200,),),
            audioKbps: Math.round(clamp(x.audioKbps, 32, 320, 96,),),
            enabled: x.enabled !== false,
        }))
        .sort((a, b,) => b.height - a.height);
    const dq = r.defaultQuality;
    const envThreads = env.VIDEO_ENCODE_THREADS;
    return {
        encodeThreads: Math.round(clamp(envThreads ?? r.encodeThreads, 1, threadsMax(), d.encodeThreads,),),
        preset: PRESETS.includes(r.preset as never,) ? r.preset! : d.preset,
        crf: Math.round(clamp(r.crf, 14, 35, d.crf,),),
        segmentSeconds: Math.round(clamp(r.segmentSeconds, 2, 12, d.segmentSeconds,),),
        ladder: ladder.length > 0 ? ladder : d.ladder,
        encodeOrder: r.encodeOrder === 'top-down' ? 'top-down' : 'fast-first',
        defaultQuality: dq === 'highest' ? 'highest' : typeof dq === 'number' && dq > 0 ? Math.round(dq,) : 'auto',
        maxUploadGb: clamp(r.maxUploadGb, 0.1, 200, d.maxUploadGb,),
        // R2/S3: parts 5 MiB–5 GiB; ≤ 10,000 parts.
        partSizeMb: Math.round(clamp(r.partSizeMb, 8, 1024, d.partSizeMb,),),
        keepOriginal: bool(r.keepOriginal, d.keepOriginal,),
        originalRetentionDays: Math.round(clamp(r.originalRetentionDays, 0, 3650, d.originalRetentionDays,),),
        teaserEnabled: bool(r.teaserEnabled, d.teaserEnabled,),
        teaserSeconds: Math.round(clamp(r.teaserSeconds, 5, 600, d.teaserSeconds,),),
        teaserStartSeconds: Math.round(clamp(r.teaserStartSeconds, 0, 86400, d.teaserStartSeconds,),),
        teaserMaxHeight: Math.round(clamp(r.teaserMaxHeight, 144, 2160, d.teaserMaxHeight,),),
        downloadsEnabled: bool(r.downloadsEnabled, d.downloadsEnabled,),
        posterAtPercent: clamp(r.posterAtPercent, 0, 95, d.posterAtPercent,),
        sprites: bool(r.sprites, d.sprites,),
        minFreeDiskGb: clamp(r.minFreeDiskGb, 0, 1000, d.minFreeDiskGb,),
        keyBaseUrl: typeof r.keyBaseUrl === 'string' ? r.keyBaseUrl.trim().replace(/\/+$/, '',) : '',
    };
}

export async function getVideoSettings(): Promise<VideoSettings> {
    return normalizeVideoSettings(await getVideoSettingsRaw() as Partial<VideoSettings>,);
}

/** Merge a patch over the stored row, normalise, save. */
export async function updateVideoSettings(patch: Partial<VideoSettings>, ctx: AuditContext,): Promise<VideoSettings> {
    const current = (await getVideoSettingsRaw() ?? {}) as Partial<VideoSettings>;
    const next = normalizeVideoSettings({ ...current, ...patch, }, {},);
    await setVideoSettingsRaw(next, ctx,);
    return getVideoSettings();
}
