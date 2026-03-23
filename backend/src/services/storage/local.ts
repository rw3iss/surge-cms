import fs from 'fs/promises';
import path from 'path';
import { config, } from '../../config';
import { logger, } from '../../utils/logger';
import { StorageProvider, UploadOptions, } from './types';

export class LocalStorageProvider implements StorageProvider {
    private uploadDir: string;

    constructor() {
        this.uploadDir = config.upload.dir;
    }

    private async ensureDir(): Promise<void> {
        await fs.mkdir(this.uploadDir, { recursive: true, },);
    }

    async upload(localPath: string, options: UploadOptions,): Promise<string> {
        await this.ensureDir();
        const destPath = path.join(this.uploadDir, options.filename,);

        // If the file is already in the upload dir (from multer), skip copy
        if (path.resolve(localPath,) !== path.resolve(destPath,)) {
            await fs.copyFile(localPath, destPath,);
        }

        return this.getUrl(options.filename,);
    }

    async uploadThumbnail(localPath: string, options: UploadOptions,): Promise<string> {
        await this.ensureDir();
        const thumbFilename = `thumb_${options.filename}`;
        const destPath = path.join(this.uploadDir, thumbFilename,);

        if (path.resolve(localPath,) !== path.resolve(destPath,)) {
            await fs.copyFile(localPath, destPath,);
        }

        return this.getThumbnailUrl(options.filename,);
    }

    async delete(filename: string,): Promise<void> {
        try {
            await fs.unlink(path.join(this.uploadDir, filename,),);
        } catch (err) {
            logger.warn('Failed to delete local file', { filename, error: err, },);
        }
    }

    async deleteThumbnail(filename: string,): Promise<void> {
        try {
            await fs.unlink(path.join(this.uploadDir, `thumb_${filename}`,),);
        } catch (err) {
            logger.warn('Failed to delete local thumbnail', { filename, error: err, },);
        }
    }

    getUrl(filename: string,): string {
        return `/uploads/${filename}`;
    }

    getThumbnailUrl(filename: string,): string {
        return `/uploads/thumb_${filename}`;
    }
}
