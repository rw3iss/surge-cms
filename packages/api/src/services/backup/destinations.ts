/**
 * Backup destinations — where a generated dump is stored.
 *
 * `services/backup.ts` already produces a dump on disk and hands back a path;
 * this module takes it from there. Keeping the two apart means the dump logic
 * does not grow a provider switch, and a new destination is one function.
 *
 * ONE S3 implementation covers AWS S3, Cloudflare R2, Backblaze B2, Wasabi and
 * MinIO — they all speak the same API, and the only thing that differs is the
 * endpoint. A per-vendor provider would be four copies of the same code.
 *
 * SECURITY NOTE, deliberately recorded here: a database dump contains every
 * password hash, session and API key on the site. Credentials for the place it
 * is stored therefore deserve the same care as the dump itself — see
 * `resolveBackupSettings` for why the environment can override the database.
 */
import { createReadStream, } from 'fs';
import { mkdir, readdir, stat, unlink, writeFile, } from 'fs/promises';
import { isAbsolute, join, } from 'path';
import type { BackupSettings, } from '@sitesurge/types';
import { AppError, } from '../../middleware/error';
import { logger, } from '../../utils/logger';

/** Object-store client, imported lazily so an install that never uses S3 does
 *  not pay for the SDK at boot. */
async function s3Client(cfg: BackupSettings['s3'],) {
    const { S3Client, } = await import('@aws-sdk/client-s3');
    return new S3Client({
        region: cfg.region || 'auto',
        ...(cfg.endpoint ? { endpoint: cfg.endpoint, } : {}),
        credentials: {
            accessKeyId: cfg.accessKeyId ?? '',
            secretAccessKey: cfg.secretAccessKey ?? '',
        },
        // R2 and MinIO require path-style addressing; AWS accepts it too.
        forcePathStyle: Boolean(cfg.endpoint,),
    },);
}

/** `db-backups/` + `surge-2026-09-21…dump`, with no double slash. */
function objectKey(prefix: string | undefined, filename: string,): string {
    const p = (prefix ?? '').replace(/^\/+|\/+$/g, '',);
    return p ? `${p}/${filename}` : filename;
}

export interface StoreResult {
    location: string;
    bytes: number;
}

/**
 * Store a finished dump at the configured destination.
 *
 * `download` stores nothing — the operator pulls it through the browser — so it
 * is not an error, just a no-op the caller reports honestly.
 */
export async function storeBackup(
    settings: BackupSettings,
    filePath: string,
    filename: string,
): Promise<StoreResult> {
    const { size, } = await stat(filePath,);

    switch (settings.destination) {
        case 'local': {
            const dir = settings.local?.path?.trim();
            if (!dir) throw new AppError(400, 'BACKUP_DEST_INVALID', 'No local backup directory is configured.',);
            // Absolute only: a relative path resolves against the server's
            // working directory, which differs between a systemd unit and a
            // shell, so backups would land somewhere nobody looks.
            if (!isAbsolute(dir,)) {
                throw new AppError(400, 'BACKUP_DEST_INVALID', 'The local backup directory must be an absolute path.',);
            }
            await mkdir(dir, { recursive: true, },);
            const dest = join(dir, filename,);
            // Streamed rather than read into memory — a multi-GB dump would
            // otherwise be held in the heap in full.
            await new Promise<void>((resolve, reject,) => {
                const read = createReadStream(filePath,);
                const write = require('fs').createWriteStream(dest,);
                read.on('error', reject,);
                write.on('error', reject,);
                write.on('finish', () => resolve(),);
                read.pipe(write,);
            },);
            return { location: dest, bytes: size, };
        }

        case 's3': {
            const cfg = settings.s3;
            if (!cfg?.bucket) throw new AppError(400, 'BACKUP_DEST_INVALID', 'No bucket is configured.',);
            const { PutObjectCommand, } = await import('@aws-sdk/client-s3');
            const client = await s3Client(cfg,);
            const key = objectKey(cfg.prefix, filename,);
            await client.send(new PutObjectCommand({
                Bucket: cfg.bucket,
                Key: key,
                Body: createReadStream(filePath,),
                ContentLength: size,
                ContentType: 'application/octet-stream',
            },),);
            return { location: `${cfg.bucket}/${key}`, bytes: size, };
        }

        case 'download':
        default:
            return { location: '(download only — not stored)', bytes: size, };
    }
}

/**
 * Check the destination is usable BEFORE a backup depends on it.
 *
 * Writes and removes a small probe object rather than only checking
 * reachability: a credential that can list but not write is the failure that
 * would otherwise surface at 3am during the first real backup.
 */
export async function testDestination(settings: BackupSettings,): Promise<{ ok: boolean; detail: string; }> {
    const probeName = `.sitesurge-probe-${Date.now()}`;
    try {
        switch (settings.destination) {
            case 'local': {
                const dir = settings.local?.path?.trim();
                if (!dir) return { ok: false, detail: 'No directory configured.', };
                if (!isAbsolute(dir,)) return { ok: false, detail: 'Directory must be an absolute path.', };
                await mkdir(dir, { recursive: true, },);
                const probe = join(dir, probeName,);
                await writeFile(probe, 'ok',);
                await unlink(probe,);
                return { ok: true, detail: `Wrote and removed a test file in ${dir}`, };
            }
            case 's3': {
                const cfg = settings.s3;
                if (!cfg?.bucket) return { ok: false, detail: 'No bucket configured.', };
                if (!cfg.accessKeyId || !cfg.secretAccessKey) {
                    return { ok: false, detail: 'Access key and secret are required.', };
                }
                const { PutObjectCommand, DeleteObjectCommand, } = await import('@aws-sdk/client-s3');
                const client = await s3Client(cfg,);
                const key = objectKey(cfg.prefix, probeName,);
                await client.send(new PutObjectCommand({
                    Bucket: cfg.bucket, Key: key, Body: 'ok', ContentType: 'text/plain',
                },),);
                await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key, },),);
                return {
                    ok: true,
                    detail: `Wrote and removed a test object in ${cfg.bucket}${cfg.prefix ? `/${cfg.prefix}` : ''}`,
                };
            }
            default:
                return { ok: true, detail: 'Download only — nothing to test.', };
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e,);
        logger.warn('Backup destination test failed', { destination: settings.destination, error: msg, },);
        return { ok: false, detail: msg, };
    }
}

/** Our generated filenames, so retention never deletes someone else's file. */
const BACKUP_NAME_RE = /^sitesurge-backup-.*\.(dump|sql)$/i;

/**
 * Delete stored backups older than `retentionDays`.
 *
 * Matches on our own filename pattern only. A shared bucket or directory is
 * normal, and a retention sweep that deleted by age alone would eventually
 * remove something it did not create.
 */
export async function pruneOldBackups(settings: BackupSettings,): Promise<number> {
    const days = Number(settings.retentionDays ?? 0,);
    if (!Number.isFinite(days,) || days <= 0) return 0;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let removed = 0;

    try {
        if (settings.destination === 'local' && settings.local?.path) {
            const dir = settings.local.path;
            for (const name of await readdir(dir,)) {
                if (!BACKUP_NAME_RE.test(name,)) continue;
                const full = join(dir, name,);
                const info = await stat(full,);
                if (info.mtimeMs < cutoff) { await unlink(full,); removed++; }
            }
        } else if (settings.destination === 's3' && settings.s3?.bucket) {
            const cfg = settings.s3;
            const { ListObjectsV2Command, DeleteObjectCommand, } = await import('@aws-sdk/client-s3');
            const client = await s3Client(cfg,);
            const list = await client.send(new ListObjectsV2Command({
                Bucket: cfg.bucket,
                ...(cfg.prefix ? { Prefix: cfg.prefix.replace(/^\/+/, '',), } : {}),
            },),);
            for (const obj of list.Contents ?? []) {
                const name = (obj.Key ?? '').split('/',).pop() ?? '';
                if (!BACKUP_NAME_RE.test(name,)) continue;
                if ((obj.LastModified?.getTime() ?? Infinity) < cutoff) {
                    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: obj.Key!, },),);
                    removed++;
                }
            }
        }
    } catch (e) {
        // A failed prune must never fail the backup that just succeeded.
        logger.warn('Backup retention sweep failed', { error: (e as Error).message, },);
    }
    return removed;
}
