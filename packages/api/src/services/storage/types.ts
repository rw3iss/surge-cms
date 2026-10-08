export interface StorageFile {
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    thumbnailUrl?: string;
}

export interface UploadOptions {
    filename: string;
    mimeType: string;
    originalName: string;
}

export interface StorageProvider {
    /** Upload a file from a local path to the storage destination. Returns the public URL. */
    upload(localPath: string, options: UploadOptions,): Promise<string>;

    /** Upload a thumbnail. Returns the public URL. */
    uploadThumbnail(localPath: string, options: UploadOptions,): Promise<string>;

    /** Delete a file by its stored filename. */
    delete(filename: string,): Promise<void>;

    /** Delete a thumbnail by its stored filename. */
    deleteThumbnail(filename: string,): Promise<void>;

    /** Get the public URL for a stored file. */
    getUrl(filename: string,): string;

    /** Get the public URL for a thumbnail. */
    getThumbnailUrl(filename: string,): string;
}

export type StorageProviderType = 'local' | 's3';

/** Headers stored on an object (served by the CDN as-is). */
export interface ObjectWriteOptions {
    contentType: string;
    cacheControl?: string;
    contentDisposition?: string;
    contentLength?: number;
}

/** One uploaded multipart part (as `ListParts` reports it). */
export interface UploadedPart {
    partNumber: number;
    etag: string;
    size: number;
}

/**
 * Object-store capabilities beyond the media library's simple upload/delete —
 * what large uploads (browser → store multipart) and video (streamed reads,
 * per-file writes, prefix deletes) need. Implemented by the S3/R2 provider;
 * the local provider does not, so callers check `isObjectStore(provider)`.
 *
 * Keys are bucket-relative (`incoming/…`, `video/…`, `uploads/…`).
 */
export interface ObjectStore {
    /** Public URL of a key (CDN host when configured). */
    publicUrl(key: string,): string;
    head(key: string,): Promise<{ size: number; contentType?: string; } | null>;
    putObject(key: string, body: NodeJS.ReadableStream | Buffer | string, opts: ObjectWriteOptions,): Promise<void>;
    putFile(key: string, localPath: string, opts: ObjectWriteOptions,): Promise<void>;
    getObjectStream(key: string, range?: { start: number; end?: number; },): Promise<NodeJS.ReadableStream>;
    copyObject(fromKey: string, toKey: string,): Promise<void>;
    deleteObject(key: string,): Promise<void>;
    /** Delete every object under a prefix; returns the count. */
    deletePrefix(prefix: string,): Promise<number>;
    listPrefix(prefix: string,): Promise<Array<{ key: string; size: number; }>>;
    // Multipart (browser uploads parts straight to the store)
    createMultipart(key: string, contentType: string,): Promise<string>;
    presignPart(key: string, uploadId: string, partNumber: number, ttlSeconds: number,): Promise<string>;
    listParts(key: string, uploadId: string,): Promise<UploadedPart[]>;
    completeMultipart(key: string, uploadId: string, parts: UploadedPart[],): Promise<void>;
    abortMultipart(key: string, uploadId: string,): Promise<void>;
    /** A time-limited GET URL straight to the store (bypasses the CDN). */
    presignGet(key: string, ttlSeconds: number, downloadName?: string,): Promise<string>;
}

export function isObjectStore(p: unknown,): p is ObjectStore {
    return Boolean(p && typeof (p as ObjectStore).createMultipart === 'function',);
}

/** Cache header for content-addressed objects (unique names — never rewritten). */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
