import { DeleteObjectCommand, PutObjectCommand, S3Client, } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import { config, } from '../../config';
import { logger, } from '../../utils/logger';
import { StorageProvider, UploadOptions, } from './types';

export class S3StorageProvider implements StorageProvider {
    private client: S3Client;
    private bucket: string;
    private cdnUrl: string | undefined;
    private region: string;

    constructor() {
        this.region = config.aws.region || 'us-east-1';
        this.bucket = config.aws.s3Bucket || '';
        this.cdnUrl = config.aws.cdnUrl;

        this.client = new S3Client({
            region: this.region,
            credentials: config.aws.accessKeyId && config.aws.secretAccessKey ?
                {
                    accessKeyId: config.aws.accessKeyId,
                    secretAccessKey: config.aws.secretAccessKey,
                } :
                undefined,
        },);
    }

    private async uploadToS3(localPath: string, key: string, mimeType: string,): Promise<void> {
        const fileBuffer = await fs.readFile(localPath,);

        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: fileBuffer,
                ContentType: mimeType,
            },),
        );
    }

    async upload(localPath: string, options: UploadOptions,): Promise<string> {
        const key = `uploads/${options.filename}`;
        await this.uploadToS3(localPath, key, options.mimeType,);
        return this.getUrl(options.filename,);
    }

    async uploadThumbnail(localPath: string, options: UploadOptions,): Promise<string> {
        const thumbFilename = `thumb_${options.filename}`;
        const key = `uploads/${thumbFilename}`;
        await this.uploadToS3(localPath, key, 'image/jpeg',);
        return this.getThumbnailUrl(options.filename,);
    }

    async delete(filename: string,): Promise<void> {
        try {
            await this.client.send(
                new DeleteObjectCommand({
                    Bucket: this.bucket,
                    Key: `uploads/${filename}`,
                },),
            );
        } catch (err) {
            logger.warn('Failed to delete S3 file', { filename, error: err, },);
        }
    }

    async deleteThumbnail(filename: string,): Promise<void> {
        try {
            await this.client.send(
                new DeleteObjectCommand({
                    Bucket: this.bucket,
                    Key: `uploads/thumb_${filename}`,
                },),
            );
        } catch (err) {
            logger.warn('Failed to delete S3 thumbnail', { filename, error: err, },);
        }
    }

    getUrl(filename: string,): string {
        if (this.cdnUrl) {
            return `${this.cdnUrl}/uploads/${filename}`;
        }
        return `https://${this.bucket}.s3.${this.region}.amazonaws.com/uploads/${filename}`;
    }

    getThumbnailUrl(filename: string,): string {
        const thumbFilename = `thumb_${filename}`;
        if (this.cdnUrl) {
            return `${this.cdnUrl}/uploads/${thumbFilename}`;
        }
        return `https://${this.bucket}.s3.${this.region}.amazonaws.com/uploads/${thumbFilename}`;
    }
}
