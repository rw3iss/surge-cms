/**
 * Wire DTOs for self-hosted video (`video` feature): direct multipart uploads,
 * encode jobs, playback, keys and settings. Entity shapes live in
 * `types/video.ts`; routes in `packages/api/src/routes/video.ts`.
 */
import type {
    MediaAccessLevel,
    MediaPlayback,
    MediaVideoInfo,
    UploadSession,
    UploadSessionOptions,
    VideoJob,
    VideoKeyVersion,
    VideoSettings,
    VideoToolingStatus,
} from '../../types/video';
import type { Media, } from '../../types/content';

// ─── Uploads ──────────────────────────────────────────────────────────

/** POST /video/uploads — create, or resume (same user + fingerprint). */
export interface MediaUploadCreateBody {
    filename: string;
    mimeType: string;
    size: number;
    /** `name:size:lastModified[:sha256(head+tail)]` — identifies the file
     *  across reloads so a resumed upload cannot continue with another file. */
    fingerprint: string;
    options?: UploadSessionOptions;
}
export type MediaUploadCreateResponse = UploadSession;

/** GET /video/uploads — the caller's unfinished sessions. */
export type MediaUploadListResponse = UploadSession[];

/** GET /video/uploads/:id */
export type MediaUploadGetResponse = UploadSession;

/** POST /video/uploads/:id/part-urls */
export interface MediaUploadPartUrlsBody {
    /** ≤ 50 part numbers (1-based). */
    partNumbers: number[];
}
export interface MediaUploadPartUrlsResponse {
    urls: { partNumber: number; url: string; }[];
    /** Seconds the URLs stay valid. */
    expiresIn: number;
}

/** POST /video/uploads/:id/complete → the created media row (status
 *  `processing` for video). */
export type MediaUploadCompleteResponse = Media;

/** DELETE /video/uploads/:id */
export interface MediaUploadAbortResponse {
    message: string;
}

// ─── Video jobs / info ────────────────────────────────────────────────

/** GET /video/:id (staff) */
export type MediaVideoInfoResponse = MediaVideoInfo;

/** GET /video/jobs */
export interface MediaVideoJobsQuery {
    /** `true` = only queued/running jobs. */
    active?: boolean;
    limit?: number;
}
export type MediaVideoJobsResponse = (VideoJob & { title: string | null; })[];

/** POST /video/:id/reencode */
export interface MediaVideoReencodeBody {
    /** `encode` = from the original; `repackage` = re-segment the stored MP4s. */
    kind?: 'encode' | 'repackage';
}

/** PUT /video/:id — per-video settings. */
export interface MediaVideoUpdateBody {
    accessLevel?: MediaAccessLevel;
    teaserEnabled?: boolean;
    teaserStartMs?: number;
    teaserDurationMs?: number;
    /** Extend or clear the original's expiry (null = keep forever). */
    originalExpiresAt?: string | null;
}

/** Response of cancel / retry / reencode / update. */
export type MediaVideoActionResponse = MediaVideoInfo;

// ─── Playback ─────────────────────────────────────────────────────────

/** GET /video/:id/playback (public, role-shaped) */
export type MediaPlaybackResponse = MediaPlayback;

/** GET /video/:id/download?quality= → 302 to a signed URL. */
export interface MediaDownloadQuery {
    quality?: string;
}

// ─── Status, settings, keys ───────────────────────────────────────────

export type MediaVideoStatusResponse = VideoToolingStatus;
export type SettingsVideoResponse = VideoSettings;
export type SettingsVideoBody = Partial<VideoSettings>;
export type MediaVideoKeysResponse = VideoKeyVersion[];
/** POST /video/keys/rotate */
export interface MediaVideoKeyRotateResponse {
    version: number;
    /** Private videos queued for re-packaging with the new key. */
    repackageQueued: number;
}
