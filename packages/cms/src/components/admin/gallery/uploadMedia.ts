/**
 * Upload one file to the Media library through the SAME two paths the Media
 * page and MediaUploadModal use: the direct multipart upload (videos and big
 * files, when the `video` feature is on — progress in the upload tray store)
 * or the classic `cms.media.upload` (images / small files).
 */
import type { Media, } from '@sitesurge/types';
import { createEffect, createRoot, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { cancel, defaultTitle, setUploadTitle, startUpload, uploads, usesMultipart, whenComplete, } from '../../../stores/uploads';

/** Thrown when the upload was cancelled through `signal`. */
export class UploadCancelledError extends Error {
    constructor(name: string,) {
        super(`Upload of "${name}" was cancelled.`,);
        this.name = 'UploadCancelledError';
    }
}

export interface UploadMediaOptions {
    /** 0–100 (the classic path only reports 0 → 100). */
    onProgress?: (percent: number,) => void;
    /** The media title; defaults to the file name without its extension. */
    title?: string;
    /** The CURRENT title, read when the upload completes (the user may rename
     *  it meanwhile); it wins over `title`. */
    getTitle?: () => string | undefined;
    /** Aborting cancels the upload (parts aborted, session deleted); the
     *  promise then rejects with `UploadCancelledError`. */
    signal?: AbortSignal;
}

/** Uploads `file`; resolves with the media id. */
export async function uploadMediaFile(file: File, opts: UploadMediaOptions = {},): Promise<string> {
    const { onProgress, signal, } = opts;
    const title = opts.title?.trim() || defaultTitle(file.name,);
    const current = () => opts.getTitle?.()?.trim() || title;
    if (signal?.aborted) throw new UploadCancelledError(file.name,);
    onProgress?.(0,);
    if (usesMultipart(file,)) {
        const id = startUpload(file, { title, },);
        // Mirror the uploads-store row's percent into the caller, and keep the
        // row's title current so the latest one is sent on completion.
        const dispose = createRoot((d,) => {
            createEffect(() => {
                const row = uploads.items.find((i,) => i.id === id,);
                if (row) onProgress?.(Math.floor(row.percent,),);
            },);
            createEffect(() => {
                const t = current();
                if (uploads.items.some((i,) => i.id === id,)) setUploadTitle(id, t,);
            },);
            return d;
        },);
        const onAbort = () => void cancel(id,);
        signal?.addEventListener('abort', onAbort, { once: true, },);
        try {
            const media = await whenComplete(id,);
            if (signal?.aborted) throw new UploadCancelledError(file.name,);
            const row = uploads.items.find((i,) => i.id === id,);
            const mediaId = (media as Media | null)?.id ?? row?.mediaId ?? null;
            if (!mediaId) throw new Error(row?.error || `Upload of "${file.name}" did not finish.`,);
            onProgress?.(100,);
            return mediaId;
        } finally {
            signal?.removeEventListener('abort', onAbort,);
            dispose();
        }
    }
    let media: Media;
    try {
        media = await cms.media.upload(file, { title, }, { signal, },) as unknown as Media;
    } catch (e) {
        if (signal?.aborted) throw new UploadCancelledError(file.name,);
        throw e;
    }
    if (signal?.aborted) {
        // Cancelled as the server answered: remove what it made.
        await cms.media.discard(media.id,).catch(() => undefined);
        throw new UploadCancelledError(file.name,);
    }
    // Renamed while it uploaded: apply the latest title.
    const late = current();
    if (late !== title) await cms.media.update(media.id, { title: late, },).catch(() => undefined);
    onProgress?.(100,);
    return media.id;
}
