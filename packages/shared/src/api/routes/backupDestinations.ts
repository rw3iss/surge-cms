/**
 * Where database backups are stored.
 *
 * Until now a backup could only be DOWNLOADED through the browser — there was
 * no destination at all, so "do we have offsite backups?" was answered by
 * whether someone remembered to click the button. These settings give the
 * backup a home.
 */

/** Supported backup destinations. */
export type BackupDestinationKind =
    /** No automatic storage — the operator downloads through the admin. */
    | 'download'
    /** A directory on the server's own filesystem. */
    | 'local'
    /** Any S3-compatible object store: AWS S3, Cloudflare R2, Backblaze B2,
     *  Wasabi, MinIO. One implementation covers them all. */
    | 's3';

export const BACKUP_DESTINATIONS: readonly BackupDestinationKind[] = ['download', 'local', 's3',];

/** Filesystem destination. */
export interface BackupLocalConfig {
    /**
     * Absolute directory to write into.
     *
     * NOT under /tmp by default: most systems clear /tmp on reboot, and a
     * backup that disappears when the box restarts is not a backup.
     */
    path: string;
}

/** S3-compatible object store (AWS S3, R2, B2, Wasabi, MinIO). */
export interface BackupS3Config {
    /**
     * Full endpoint URL. Required for R2 and friends; leave blank for AWS S3,
     * where the SDK derives it from the region.
     */
    endpoint?: string;
    /** `auto` for R2; a real region for AWS. */
    region?: string;
    bucket: string;
    /** Key prefix, e.g. `db-backups/`. Optional. */
    prefix?: string;
    accessKeyId?: string;
    /** Masked on read; an echoed mask means "unchanged" on write. */
    secretAccessKey?: string;
}

/** The stored `backup_settings` row. */
export interface BackupSettings {
    destination: BackupDestinationKind;
    local: BackupLocalConfig;
    s3: BackupS3Config;
    /**
     * Delete stored backups older than this many days. 0 keeps everything.
     *
     * Only applies to destinations we manage the listing for (local, s3).
     */
    retentionDays: number;
}

/** GET /settings/backup-destination (admin). */
export type SettingsBackupDestinationResponse = BackupSettings;

/** Body for PUT /settings/backup-destination (admin). */
export type SettingsBackupDestinationBody = BackupSettings;

/** Result of a destination connectivity check. */
export interface BackupDestinationTestResponse {
    ok: boolean;
    /** Human-readable detail — the endpoint reached, or why it failed. */
    detail: string;
}

/** Result of running a backup to the configured destination. */
export interface BackupRunResponse {
    ok: boolean;
    /** Where it landed (a path or an object key). */
    location: string;
    bytes: number;
    detail?: string;
}
