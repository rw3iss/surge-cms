/**
 * Upload one file to the Media library through the SAME two paths the Media
 * page and MediaUploadModal use: the direct multipart upload (videos and big
 * files, when the `video` feature is on — progress in the upload tray store)
 * or the classic `cms.media.upload` (images / small files).
 */
import type { Media, } from '@sitesurge/types';
import { createEffect, createRoot, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { startUpload, uploads, usesMultipart, whenComplete, } from '../../../stores/uploads';

/** Uploads `file`; `onProgress` gets 0–100 (the classic path only reports 0 → 100). Resolves with the media id. */
export async function uploadMediaFile(file: File, onProgress?: (percent: number,) => void,): Promise<string> {
    onProgress?.(0,);
    if (usesMultipart(file,)) {
        const id = startUpload(file, { title: file.name.replace(/\.[^.]+$/, '',), },);
        // Mirror the uploads-store row's percent into the caller.
        const dispose = createRoot((d,) => {
            createEffect(() => {
                const row = uploads.items.find((i,) => i.id === id,);
                if (row) onProgress?.(Math.floor(row.percent,),);
            },);
            return d;
        },);
        try {
            const media = await whenComplete(id,);
            const row = uploads.items.find((i,) => i.id === id,);
            const mediaId = (media as Media | null)?.id ?? row?.mediaId ?? null;
            if (!mediaId) throw new Error(row?.error || `Upload of "${file.name}" did not finish.`,);
            onProgress?.(100,);
            return mediaId;
        } finally {
            dispose();
        }
    }
    const fields: Record<string, string> = { title: file.name.replace(/\.[^.]+$/, '',), };
    const media = await cms.media.upload(file, fields,) as unknown as Media;
    onProgress?.(100,);
    return media.id;
}
