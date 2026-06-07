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
