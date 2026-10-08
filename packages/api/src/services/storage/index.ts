/**
 * The storage provider, built from the EFFECTIVE media storage settings —
 * environment first (`STORAGE_PROVIDER`, `S3_*`), then Settings → Media →
 * Storage (`media_storage` keyed row). It used to read env only, so a change
 * made in the admin was saved and displayed but never used (audit A11).
 *
 * `resolveStorageProvider()` (async) is the source of truth and rebuilds the
 * provider when the settings change; `getStorageProvider()` (sync) returns
 * the last resolved one for callers that cannot await — warmed at boot and
 * after every settings write (`refreshStorageProvider`).
 */
import { config, } from '../../config';
import { logger, } from '../../utils/logger';
import { LocalStorageProvider, } from './local';
import { S3StorageProvider, type S3Settings, } from './s3';
import type { StorageProvider, } from './types';

export type { ObjectStore, ObjectWriteOptions, StorageFile, StorageProvider, StorageProviderType, UploadedPart, UploadOptions, } from './types';
export { IMMUTABLE_CACHE, isObjectStore, } from './types';
export type { S3Settings, } from './s3';

interface EffectiveStorage {
    provider: 'local' | 's3';
    localDir: string;
    s3: S3Settings;
}

let current: { sig: string; provider: StorageProvider; } | null = null;

function build(e: EffectiveStorage,): StorageProvider {
    if (e.provider === 's3') {
        if (!e.s3.bucket) {
            logger.error('S3 storage selected but no bucket is set — falling back to local storage.',);
            return new LocalStorageProvider(e.localDir,);
        }
        logger.info('Using S3 storage provider', { bucket: e.s3.bucket, endpoint: e.s3.endpoint || 'aws', },);
        return new S3StorageProvider(e.s3,);
    }
    logger.info('Using local storage provider', { dir: e.localDir || config.upload.dir, },);
    return new LocalStorageProvider(e.localDir,);
}

/** Env-only fallback (before settings are readable, e.g. setup mode / boot). */
function fromEnv(): EffectiveStorage {
    return {
        provider: (config.upload.storageProvider as 'local' | 's3') || 'local',
        localDir: config.upload.dir,
        s3: {
            endpoint: config.aws.endpoint, region: config.aws.region, bucket: config.aws.s3Bucket || '',
            accessKeyId: config.aws.accessKeyId, secretAccessKey: config.aws.secretAccessKey, cdnUrl: config.aws.cdnUrl,
        },
    };
}

const originOf = (u?: string,) => {
    try {
        return u ? new URL(u,).origin : null;
    } catch {
        return null;
    }
};

function install(e: EffectiveStorage,): StorageProvider {
    const sig = JSON.stringify(e,);
    if (current?.sig !== sig) {
        current = { sig, provider: build(e,), };
        // The browser talks to the CDN (hls.js) and the store's API origin
        // (direct multipart uploads) — both must be in CSP connect-src.
        if (e.provider === 's3') {
            const p = current.provider as S3StorageProvider;
            void import('../../middleware/csp.js').then((m,) => m.setStorageCspOrigins([originOf(e.s3.cdnUrl,), p.uploadOrigin,],),).catch(() => {},);
        }
    }
    return current.provider;
}

/** The provider for the current settings (rebuilt only when they change). */
export async function resolveStorageProvider(): Promise<StorageProvider> {
    try {
        const { getMediaStorageSettings, } = await import('../settings.js');
        const s = await getMediaStorageSettings();
        return install({
            provider: s.provider === 's3' ? 's3' : 'local',
            localDir: s.localDir || config.upload.dir,
            s3: { ...s.s3, bucket: s.s3.bucket || '', region: s.s3.region || 'auto', },
        },);
    } catch (e) {
        logger.warn('Storage settings unreadable — using environment config', { error: (e as Error).message, },);
        return install(fromEnv(),);
    }
}

/** Re-read the settings now (boot, and after Settings → Media → Storage is saved). */
export async function refreshStorageProvider(): Promise<void> {
    await resolveStorageProvider();
}

/** Last resolved provider (env config until the first resolve). */
export function getStorageProvider(): StorageProvider {
    return current?.provider ?? install(fromEnv(),);
}
