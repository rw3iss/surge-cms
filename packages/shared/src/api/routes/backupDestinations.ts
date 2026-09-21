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

/** How often an automatic backup runs. */
export type BackupFrequency = 'daily' | 'weekly' | 'monthly';

export const BACKUP_FREQUENCIES: readonly BackupFrequency[] = ['daily', 'weekly', 'monthly',];

/** Longest retention the UI offers — a year. */
export const BACKUP_RETENTION_MAX_DAYS = 365;

/** Automatic-backup schedule. */
export interface BackupScheduleConfig {
    enabled: boolean;
    frequency: BackupFrequency;
    /** Wall-clock `HH:MM` in `timezone`. */
    timeOfDay: string;
    /** IANA zone. Wall clock, not an offset, so 02:00 stays 02:00 across DST. */
    timezone: string;
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
    /** Automatic backups. Disabled by default — a schedule that silently
     *  started writing to an unconfigured destination would be worse than
     *  none. */
    schedule: BackupScheduleConfig;
    /**
     * When the next automatic backup is due (ISO), or null when disabled.
     *
     * Stored rather than held in memory: node-cron tasks vanish on restart,
     * and a schedule that exists in settings but never fires is the exact
     * failure this whole design avoids. A cursor in the database restores
     * itself by construction.
     */
    nextRunAt?: string | null;
    /** Outcome of the last automatic run, for the admin to see. */
    lastRunAt?: string | null;
    lastStatus?: 'ok' | 'failed' | null;
    lastError?: string | null;
    lastLocation?: string | null;
}

/** One stored backup, as listed from the destination. */
export interface StoredBackup {
    /** Object key or absolute path. */
    id: string;
    filename: string;
    bytes: number;
    /** ISO timestamp. */
    createdAt: string;
}

/** GET /settings/backup-destination/list (admin). */
export type BackupListResponse = StoredBackup[];

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
