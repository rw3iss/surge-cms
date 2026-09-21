/**
 * Where uploaded media is stored and served from.
 *
 * Previously env-only (`STORAGE_PROVIDER`, `S3_*`, `S3_CDN_URL`), which meant
 * changing CDN required shell access to the server. These settings move it into
 * the admin, with env still winning so an existing deployment is unaffected
 * and an operator can keep credentials out of the database if they prefer.
 */

/** Supported media storage backends. */
export type MediaStorageKind =
    /** The server's own filesystem, served through the app. */
    | 'local'
    /** Any S3-compatible object store: AWS S3, Cloudflare R2, Backblaze B2,
     *  Wasabi, DigitalOcean Spaces, MinIO. */
    | 's3';

export const MEDIA_STORAGE_KINDS: readonly MediaStorageKind[] = ['local', 's3',];

export interface MediaS3Config {
    /**
     * Full endpoint URL. Required for R2 and other S3-compatible stores;
     * leave blank for AWS S3, where the SDK derives it from the region.
     *
     * e.g. `https://<account-id>.r2.cloudflarestorage.com`
     */
    endpoint?: string;
    /** `auto` for R2; a real region for AWS (e.g. `us-east-1`). */
    region?: string;
    bucket?: string;
    accessKeyId?: string;
    /** Masked on read; an echoed mask means "unchanged" on write. */
    secretAccessKey?: string;
    /**
     * Public base URL media is SERVED from — a CDN or custom domain.
     *
     * Distinct from `endpoint`, which is the write API. Serving from the S3
     * API endpoint would be slow, unauthenticated-hostile and expensive; a
     * custom domain in front of the bucket is the normal arrangement.
     *
     * e.g. `https://cdn.example.com`
     */
    cdnUrl?: string;
}

/** The stored `media_storage` row. */
export interface MediaStorageSettings {
    provider: MediaStorageKind;
    s3: MediaS3Config;
    /** Local upload directory, when `provider` is `local`. */
    localDir?: string;
}

/** GET /settings/media-storage (admin). */
export type SettingsMediaStorageResponse = MediaStorageSettings;

/** Body for PUT /settings/media-storage (admin). */
export type SettingsMediaStorageBody = MediaStorageSettings;

/** Result of a media-storage connectivity check. */
export interface MediaStorageTestResponse {
    ok: boolean;
    detail: string;
}
