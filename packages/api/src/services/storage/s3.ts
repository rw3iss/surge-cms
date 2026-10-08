import {
    AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CopyObjectCommand, CreateMultipartUploadCommand,
    DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command,
    ListPartsCommand, PutObjectCommand, S3Client, UploadPartCommand, UploadPartCopyCommand,
} from '@aws-sdk/client-s3';
import { Upload, } from '@aws-sdk/lib-storage';
import { getSignedUrl, } from '@aws-sdk/s3-request-presigner';
import { createReadStream, promises as fs, } from 'fs';
import type { Readable, } from 'stream';
import { logger, } from '../../utils/logger';
import {
    IMMUTABLE_CACHE, type ObjectStore, type ObjectWriteOptions, type StorageProvider, type UploadedPart, type UploadOptions,
} from './types';

/** Resolved S3/R2 connection (Settings → Media storage, env wins). */
export interface S3Settings {
    endpoint?: string;
    region?: string;
    bucket: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    cdnUrl?: string;
}

/** Above this, a server-side upload goes multipart (parallel parts, retries). */
const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

/** CopyObject's single-request ceiling (S3/R2: 5 GiB). */
const COPY_SINGLE_LIMIT = 5 * 1024 * 1024 * 1024;
/** Part size for a large server-side copy (equal parts, as R2 requires). */
const COPY_PART_SIZE = 512 * 1024 * 1024;

export class S3StorageProvider implements StorageProvider, ObjectStore {
    private client: S3Client;
    private bucket: string;
    private cdnUrl: string | undefined;
    private region: string;
    private endpoint: string | undefined;

    constructor(s: S3Settings,) {
        this.region = s.region || 'us-east-1';
        this.bucket = s.bucket;
        this.cdnUrl = s.cdnUrl?.replace(/\/+$/, '',) || undefined;
        this.endpoint = s.endpoint || undefined;

        // A custom endpoint (Cloudflare R2, Backblaze B2, MinIO, …) switches the
        // client off AWS. R2 needs path-style addressing. When set, a public URL
        // MUST come from the CDN URL (the raw endpoint isn't publicly servable).
        this.client = new S3Client({
            region: this.region,
            ...(this.endpoint ? { endpoint: this.endpoint, forcePathStyle: true, } : {}),
            credentials: s.accessKeyId && s.secretAccessKey
                ? { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey, }
                : undefined,
        },);
    }

    // ─── StorageProvider (media library) ─────────────────────────────

    /** Streamed (never read into memory); multipart above 100 MB. Media file
     *  names are unique (nanoid), so they are cached as immutable. */
    private async uploadToS3(localPath: string, key: string, mimeType: string,): Promise<void> {
        await this.putFile(key, localPath, { contentType: mimeType, cacheControl: IMMUTABLE_CACHE, },);
    }

    async upload(localPath: string, options: UploadOptions,): Promise<string> {
        const key = `uploads/${options.filename}`;
        await this.uploadToS3(localPath, key, options.mimeType,);
        return this.getUrl(options.filename,);
    }

    async uploadThumbnail(localPath: string, options: UploadOptions,): Promise<string> {
        const thumbFilename = `thumb_${options.filename}`;
        await this.uploadToS3(localPath, `uploads/${thumbFilename}`, 'image/jpeg',);
        return this.getThumbnailUrl(options.filename,);
    }

    async delete(filename: string,): Promise<void> {
        await this.deleteObject(`uploads/${filename}`,);
    }

    async deleteThumbnail(filename: string,): Promise<void> {
        await this.deleteObject(`uploads/thumb_${filename}`,);
    }

    getUrl(filename: string,): string {
        return this.publicUrl(`uploads/${filename}`,);
    }

    getThumbnailUrl(filename: string,): string {
        return this.publicUrl(`uploads/thumb_${filename}`,);
    }

    // ─── ObjectStore ─────────────────────────────────────────────────

    publicUrl(key: string,): string {
        if (this.cdnUrl) return `${this.cdnUrl}/${key}`;
        return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    }

    async head(key: string,): Promise<{ size: number; contentType?: string; } | null> {
        try {
            const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, },),);
            return { size: Number(r.ContentLength ?? 0,), contentType: r.ContentType, };
        } catch (e) {
            const code = (e as { name?: string; $metadata?: { httpStatusCode?: number; }; });
            if (code.name === 'NotFound' || code.$metadata?.httpStatusCode === 404) return null;
            throw e;
        }
    }

    async putObject(key: string, body: NodeJS.ReadableStream | Buffer | string, o: ObjectWriteOptions,): Promise<void> {
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket, Key: key, Body: body as never, ContentType: o.contentType,
            CacheControl: o.cacheControl, ContentDisposition: o.contentDisposition, ContentLength: o.contentLength,
        },),);
    }

    async putFile(key: string, localPath: string, o: ObjectWriteOptions,): Promise<void> {
        const { size, } = await fs.stat(localPath,);
        if (size <= MULTIPART_THRESHOLD) {
            await this.putObject(key, createReadStream(localPath,), { ...o, contentLength: size, },);
            return;
        }
        const up = new Upload({
            client: this.client,
            queueSize: 3,
            partSize: 16 * 1024 * 1024,
            params: {
                Bucket: this.bucket, Key: key, Body: createReadStream(localPath,), ContentType: o.contentType,
                CacheControl: o.cacheControl, ContentDisposition: o.contentDisposition,
            },
        },);
        await up.done();
    }

    async getObjectStream(key: string, range?: { start: number; end?: number; },): Promise<NodeJS.ReadableStream> {
        const r = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket, Key: key,
            ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}`, } : {}),
        },),);
        return r.Body as Readable;
    }

    /**
     * Server-side copy (no bytes through us). A single CopyObject is capped at
     * 5 GiB, so larger objects (a kept 20 GB original) are copied as a
     * multipart upload of UploadPartCopy ranges. `opts` replaces the metadata
     * (content type / cache control); without it the source's is kept.
     */
    async copyObject(fromKey: string, toKey: string, opts?: Partial<ObjectWriteOptions>,): Promise<void> {
        const source = `${this.bucket}/${encodeURIComponent(fromKey,).replace(/%2F/g, '/',)}`;
        const head = await this.head(fromKey,);
        if (!head) throw new Error(`copyObject: source not found: ${fromKey}`,);
        const meta = opts
            ? {
                MetadataDirective: 'REPLACE' as const,
                ContentType: opts.contentType ?? head.contentType,
                CacheControl: opts.cacheControl,
                ContentDisposition: opts.contentDisposition,
            }
            : {};
        if (head.size <= COPY_SINGLE_LIMIT) {
            await this.client.send(new CopyObjectCommand({ Bucket: this.bucket, Key: toKey, CopySource: source, ...meta, },),);
            return;
        }
        const created = await this.client.send(new CreateMultipartUploadCommand({
            Bucket: this.bucket, Key: toKey,
            ContentType: opts?.contentType ?? head.contentType, CacheControl: opts?.cacheControl,
        },),);
        const uploadId = created.UploadId!;
        try {
            const parts: { PartNumber: number; ETag: string; }[] = [];
            let n = 1;
            for (let start = 0; start < head.size; start += COPY_PART_SIZE, n++) {
                const end = Math.min(head.size, start + COPY_PART_SIZE,) - 1;
                const r = await this.client.send(new UploadPartCopyCommand({
                    Bucket: this.bucket, Key: toKey, UploadId: uploadId, PartNumber: n,
                    CopySource: source, CopySourceRange: `bytes=${start}-${end}`,
                },),);
                parts.push({ PartNumber: n, ETag: r.CopyPartResult!.ETag!, },);
            }
            await this.client.send(new CompleteMultipartUploadCommand({
                Bucket: this.bucket, Key: toKey, UploadId: uploadId, MultipartUpload: { Parts: parts, },
            },),);
        } catch (e) {
            await this.abortMultipart(toKey, uploadId,).catch(() => undefined);
            throw e;
        }
    }

    async deleteObject(key: string,): Promise<void> {
        try {
            await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key, },),);
        } catch (err) {
            logger.warn('Failed to delete object', { key, error: (err as Error).message, },);
        }
    }

    async listPrefix(prefix: string,): Promise<Array<{ key: string; size: number; }>> {
        const out: Array<{ key: string; size: number; }> = [];
        let token: string | undefined;
        do {
            const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token, },),);
            for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: Number(o.Size ?? 0,), },);
            token = r.IsTruncated ? r.NextContinuationToken : undefined;
        } while (token);
        return out;
    }

    async deletePrefix(prefix: string,): Promise<number> {
        if (!prefix || prefix === '/' || !prefix.endsWith('/',)) throw new Error(`deletePrefix needs a folder prefix ending in "/" (got "${prefix}")`,);
        const keys = (await this.listPrefix(prefix,)).map((o,) => o.key);
        for (let i = 0; i < keys.length; i += 1000) {
            await this.client.send(new DeleteObjectsCommand({
                Bucket: this.bucket,
                Delete: { Objects: keys.slice(i, i + 1000,).map((Key,) => ({ Key, })), Quiet: true, },
            },),);
        }
        return keys.length;
    }

    async createMultipart(key: string, contentType: string,): Promise<string> {
        const r = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, },),);
        if (!r.UploadId) throw new Error('The store did not return an upload id.',);
        return r.UploadId;
    }

    async presignPart(key: string, uploadId: string, partNumber: number, ttlSeconds: number,): Promise<string> {
        return getSignedUrl(this.client, new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, },), { expiresIn: ttlSeconds, },);
    }

    async listParts(key: string, uploadId: string,): Promise<UploadedPart[]> {
        const out: UploadedPart[] = [];
        let marker: string | undefined;
        do {
            const r = await this.client.send(new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker, },),);
            for (const p of r.Parts ?? []) {
                if (p.PartNumber && p.ETag) out.push({ partNumber: p.PartNumber, etag: p.ETag, size: Number(p.Size ?? 0,), },);
            }
            marker = r.IsTruncated ? r.NextPartNumberMarker : undefined;
        } while (marker);
        return out;
    }

    async completeMultipart(key: string, uploadId: string, parts: UploadedPart[],): Promise<void> {
        await this.client.send(new CompleteMultipartUploadCommand({
            Bucket: this.bucket, Key: key, UploadId: uploadId,
            MultipartUpload: { Parts: [...parts,].sort((a, b,) => a.partNumber - b.partNumber).map((p,) => ({ PartNumber: p.partNumber, ETag: p.etag, })), },
        },),);
    }

    async abortMultipart(key: string, uploadId: string,): Promise<void> {
        try {
            await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, },),);
        } catch (e) {
            logger.warn('abortMultipart failed', { key, error: (e as Error).message, },);
        }
    }

    async presignGet(key: string, ttlSeconds: number, downloadName?: string,): Promise<string> {
        return getSignedUrl(this.client, new GetObjectCommand({
            Bucket: this.bucket, Key: key,
            ...(downloadName ? { ResponseContentDisposition: `attachment; filename="${downloadName.replace(/["\\\r\n]/g, '',)}"`, } : {}),
        },), { expiresIn: ttlSeconds, },);
    }

    /** The store's own origin (for the browser's direct part uploads — CSP connect-src). */
    get uploadOrigin(): string | null {
        try {
            return this.endpoint ? new URL(this.endpoint,).origin : `https://${this.bucket}.s3.${this.region}.amazonaws.com`;
        } catch {
            return null;
        }
    }
}
