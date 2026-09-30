/**
 * Wire DTOs for the /media module (all admin tier). Validation + multer
 * disk-staging live in `packages/api/src/routes/media.ts`; the upload
 * pipeline + list/update/delete live in `packages/api/src/services/media.ts`.
 *
 * There is NO signed-url route (confirmed against the manifest — it was
 * not added in Phase 3); URLs are stored on the row directly.
 */

import type { Media, } from '../../types/content';

// ─── Entities carried on the wire ─────────────────────────────────────

/**
 * The media row as it ACTUALLY appears on the wire. `mapRow<Media>` runs
 * over `SELECT *`, so migration 003's `title` column rides along even
 * though the shared `Media` entity doesn't declare it. WIRE WINS: the
 * media list / fetch / update endpoints can return `title`, so it's added
 * here rather than mutating the base entity. `createdAt` serializes to an
 * ISO string.
 */
export interface MediaWire extends Media {
    /** Optional display title (migration 003). Distinct from `originalName`. */
    title?: string | null;
}

// ─── POST /media (single upload) ──────────────────────────────────────

/**
 * POST /media is a MULTIPART upload (field "file"); the optional
 * `alt`/`caption` ride as form fields, so there is no JSON body schema.
 * This marker documents the form-field shape for clients building the
 * multipart request.
 */
export interface MediaUploadFields {
    alt?: string;
    caption?: string;
}

/** POST /media (201) — the created media row. */
export type MediaUploadResponse = MediaWire;

// ─── POST /media/block-upload ─────────────────────────────────────────

/** POST /media/block-upload form fields (multipart, field "file"). */
export interface MediaBlockUploadFields {
    postId?: string;
    blockId?: string;
}

/** POST /media/block-upload (201) — the created media row, with the
 *  caller's `postId`/`blockId` echoed back (null when absent). */
export type MediaBlockUploadResponse = MediaWire & {
    postId: string | null;
    blockId: string | null;
};

// ─── POST /media/bulk ─────────────────────────────────────────────────

/** POST /media/bulk (201) — one row per uploaded file (multipart, field
 *  "files", max 10). */
export type MediaBulkUploadResponse = MediaWire[];

// ─── GET /media ───────────────────────────────────────────────────────

/** Query accepted by GET /media (paginated admin list). */
export interface MediaListQuery {
    /** mime-type prefix filter, e.g. `image` → `image/%`; `document`
     *  matches anything not image/video/audio. */
    type?: string;
    /** comma-separated type list, e.g. `image,video`. */
    types?: string;
    search?: string;
    /** `title_asc` | `title_desc` | `date_asc` | `date_desc` |
     *  `size_asc` | `size_desc` | `updated_asc` | `updated_desc`. */
    sort?: string;
    page?: number;
    limit?: number;
}

/** GET /media — list items. Page meta rides the ApiResponse envelope. */
export type MediaListResponse = MediaWire[];

// ─── GET /media/:id ───────────────────────────────────────────────────

/** Params for the media-by-id family of routes. */
export interface MediaIdParams {
    id: string;
}

/** GET /media/:id — the media row. */
export type MediaByIdResponse = MediaWire;

// ─── PUT /media/:id ───────────────────────────────────────────────────

/** Body for PUT /media/:id (metadata patch). Only supplied fields change;
 *  at least one is required at runtime (the handler 400s on an empty patch). */
export interface MediaUpdateBody {
    title?: string;
    alt?: string;
    caption?: string;
    credits?: string;
}

/** PUT /media/:id — the updated media row. */
export type MediaUpdateResponse = MediaWire;

// ─── DELETE /media/:id ────────────────────────────────────────────────

/** DELETE /media/:id — confirmation message. Files are removed from
 *  storage. */
export interface MediaDeleteResponse {
    message: string;
}
