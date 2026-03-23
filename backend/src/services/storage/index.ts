import { config, } from '../../config';
import { logger, } from '../../utils/logger';
import { LocalStorageProvider, } from './local';
import { S3StorageProvider, } from './s3';
import { StorageProvider, StorageProviderType, } from './types';

export type { StorageFile, StorageProvider, StorageProviderType, UploadOptions, } from './types';

let storageInstance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
    if (storageInstance) return storageInstance;

    const providerType = config.upload.storageProvider as StorageProviderType;

    switch (providerType) {
        case 's3':
            if (!config.aws.s3Bucket) {
                logger.error('S3 storage provider configured but S3_BUCKET is not set. Falling back to local.',);
                storageInstance = new LocalStorageProvider();
            } else {
                logger.info('Using S3 storage provider', { bucket: config.aws.s3Bucket, region: config.aws.region, },);
                storageInstance = new S3StorageProvider();
            }
            break;
        case 'local':
        default:
            logger.info('Using local storage provider', { dir: config.upload.dir, },);
            storageInstance = new LocalStorageProvider();
            break;
    }

    return storageInstance;
}
