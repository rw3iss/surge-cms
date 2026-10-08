/**
 * Self-hosted video (the `video` feature).
 *
 * A video is an ordinary `media` row plus a `media_videos` row. The upload goes
 * browser → object storage directly (multipart, presigned parts); an encode job
 * turns the original into HLS renditions one at a time, plus an optional
 * TEASER (the first N seconds, never encrypted) and per-quality MP4 downloads.
 *
 * Access is two-level. `public`: anyone plays the full video. `private`: the
 * full video's segments are AES-128 encrypted with a SHARED, versioned key that
 * only viewers with `media.private:view` can fetch, and the full stream's URLs
 * are only handed to those viewers — everyone else gets the teaser.
 */

/** Lifecycle of any media row (images are always `ready`). */
export type MediaStatus = 'uploading' | 'processing' | 'ready' | 'failed';

/** Who may play the FULL video. */
export type MediaAccessLevel = 'public' | 'private';

export type VideoJobStatus =
    | 'queued' | 'downloading' | 'probing' | 'encoding' | 'uploading'
    | 'finalizing' | 'ready' | 'failed' | 'cancelled';

/** What a job does. `encode` = from the original; `repackage` = re-segment the
 *  existing per-quality MP4s (cheap, no re-encode) — used after a key rotation
 *  or an access-level change. */
export type VideoJobKind = 'encode' | 'repackage';

/** Why a job is waiting although it is due. */
export type VideoBlockedReason = 'ffmpeg_missing' | 'disk' | 'storage' | null;

export type VideoRenditionStatus = 'queued' | 'encoding' | 'uploading' | 'ready' | 'failed' | 'skipped';

/** `full` = the real video; `teaser` = the public first-N-seconds clip. */
export type VideoVariant = 'full' | 'teaser';

export interface VideoRendition {
    id: string;
    variant: VideoVariant;
    /** `1080p` | `720p` | `480p` | `360p` | `<h>p` for a sub-360 source. */
    name: string;
    width: number | null;
    height: number | null;
    /** Peak bits/s, as in `#EXT-X-STREAM-INF:BANDWIDTH`. */
    bandwidth: number | null;
    status: VideoRenditionStatus;
    /** 0–100. */
    progress: number;
    error: string | null;
    /** Total stored bytes of the HLS output. */
    bytes: number | null;
    /** Size of the downloadable MP4, when one exists (full variant only). */
    downloadBytes: number | null;
    startedAt: string | null;
    finishedAt: string | null;
}

export interface VideoJob {
    id: string;
    mediaId: string;
    kind: VideoJobKind;
    status: VideoJobStatus;
    blockedReason: VideoBlockedReason;
    /** Weighted overall progress, 0–100. */
    progress: number;
    attempts: number;
    maxAttempts: number;
    error: string | null;
    cancelRequested: boolean;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    updatedAt: string;
}

/**
 * The admin view of a video: everything about its encode. STAFF ONLY — it
 * carries the full stream's master URL. Public callers use `MediaPlayback`.
 */
export interface MediaVideoInfo {
    mediaId: string;
    status: MediaStatus;
    accessLevel: MediaAccessLevel;
    encrypted: boolean;
    keyVersion: number | null;
    posterUrl: string | null;
    thumbnailsVtt: string | null;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    /** Master playlist of the full video (API URL; lists ready renditions). */
    masterUrl: string;
    /** Master playlist of the teaser, when one exists. */
    teaserUrl: string | null;
    hasTeaser: boolean;
    teaserStartMs: number;
    teaserDurationMs: number;
    /** The original is still in storage (re-encode possible). */
    hasOriginal: boolean;
    originalExpiresAt: string | null;
    renditions: VideoRendition[];
    /** The newest job (active or finished), if any. */
    job: VideoJob | null;
    /** Weighted overall progress of the newest job, 0–100. */
    progress: number;
}

/**
 * The compact video block carried on every `Media` row in the admin list —
 * enough for a library tile (poster, progress, quality chips, teaser flag)
 * without a per-tile request.
 */
export interface MediaVideoSummary {
    posterUrl: string | null;
    hasTeaser: boolean;
    encrypted: boolean;
    /** Weighted overall progress of the newest job, 0–100. */
    progress: number;
    jobStatus: VideoJobStatus | null;
    blockedReason: VideoBlockedReason;
    renditions: Pick<VideoRendition, 'variant' | 'name' | 'status' | 'progress'>[];
}

/** A quality a viewer may download. */
export interface VideoDownloadOption {
    quality: string;
    height: number | null;
    bytes: number | null;
    /** API URL that 302s to a short-lived signed download link. */
    url: string;
}

/**
 * GET /video/:id/playback — what a PLAYER needs. Safe to return to anyone:
 * the full stream's URL is present only when `access.full` is true, so a
 * visitor who may not watch the full video cannot find it in the network tab.
 */
export interface MediaPlayback {
    mediaId: string;
    status: MediaStatus;
    accessLevel: MediaAccessLevel;
    title: string | null;
    posterUrl: string | null;
    thumbnailsVtt: string | null;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    /** Full video master playlist — null unless `access.full`. */
    src: string | null;
    /** Teaser master playlist — null when the video has no teaser. */
    teaserSrc: string | null;
    teaserDurationMs: number | null;
    /** Plain-file fallback for media that is not an encoded video (an MP4/WebM
     *  uploaded the old way). Null for encoded videos. */
    fileSrc: string | null;
    fileType: string | null;
    /** Ready qualities of the full video (empty when not `access.full`). */
    qualities: string[];
    downloads: VideoDownloadOption[];
    access: {
        /** The caller may play (and fetch the key for) the full video. */
        full: boolean;
        /** Why not, when `full` is false. */
        reason: 'ok' | 'private' | 'not_ready' | null;
    };
}

/** One rung of the encoding ladder (`video_settings.ladder`). */
export interface VideoLadderRung {
    name: string;
    height: number;
    maxrateKbps: number;
    audioKbps: number;
    enabled: boolean;
}

export type VideoEncodePreset = 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium';

/** `video_settings` keyed row. Env wins where an env var exists. */
export interface VideoSettings {
    /** ffmpeg `-threads` per encode (env `VIDEO_ENCODE_THREADS`). 1 = gentlest. */
    encodeThreads: number;
    preset: VideoEncodePreset;
    crf: number;
    segmentSeconds: number;
    ladder: VideoLadderRung[];
    /** `fast-first` encodes the lowest rung first so the video plays within
     *  minutes, then the rest from the top down. */
    encodeOrder: 'fast-first' | 'top-down';
    /** Player start level: `auto`, `highest`, or a height (e.g. 720). */
    defaultQuality: 'auto' | 'highest' | number;
    maxUploadGb: number;
    /** Multipart part size. Every part except the last is this size. */
    partSizeMb: number;
    /** Keep the original after encoding (needed for a later re-encode). */
    keepOriginal: boolean;
    /** Delete a kept original this many days after upload. 0 = never. */
    originalRetentionDays: number;
    /** Generate a teaser for new uploads. */
    teaserEnabled: boolean;
    teaserSeconds: number;
    teaserStartSeconds: number;
    /** Teaser rungs are capped at this height (the teaser is a preview). */
    teaserMaxHeight: number;
    /** Keep a per-quality MP4 for downloads (also what makes a cheap
     *  re-package after a key rotation possible). */
    downloadsEnabled: boolean;
    posterAtPercent: number;
    /** Scrub-bar preview sprites + WebVTT. */
    sprites: boolean;
    minFreeDiskGb: number;
    /** Origin baked into encrypted playlists as the key URI. Blank = the
     *  site URL (`FRONTEND_URL`). Changing it only affects new encodes. */
    keyBaseUrl: string;
}

/** GET /video/status — can this server encode? */
export interface VideoToolingStatus {
    ffmpeg: boolean;
    ffprobe: boolean;
    libx264: boolean;
    version: string | null;
    encoderEnabled: boolean;
    tempDir: string;
    diskFreeBytes: number | null;
    /** Object storage supports direct (multipart) uploads. */
    storageReady: boolean;
    storageProblem: string | null;
    threadsMax: number;
}

/** A shared encryption key version (bytes never leave the server except via
 *  the gated key endpoint). */
export interface VideoKeyVersion {
    version: number;
    createdAt: string;
    retiredAt: string | null;
    /** Videos still encrypted with this version. */
    videoCount: number;
    current: boolean;
}

// ─── Direct (multipart) uploads ───────────────────────────────────────

export type UploadSessionStatus = 'uploading' | 'completed' | 'aborted' | 'expired';

export interface UploadSessionOptions {
    title?: string;
    alt?: string;
    caption?: string;
    credits?: string;
    accessLevel?: MediaAccessLevel;
    keepOriginal?: boolean;
    teaser?: boolean;
    teaserStartSeconds?: number;
    teaserSeconds?: number;
}

export interface UploadSession {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    fingerprint: string;
    partSize: number;
    partCount: number;
    status: UploadSessionStatus;
    options: UploadSessionOptions;
    mediaId: string | null;
    /** Part numbers already stored (from ListParts — authoritative). */
    uploadedParts: number[];
    uploadedBytes: number;
    createdAt: string;
    expiresAt: string;
}
