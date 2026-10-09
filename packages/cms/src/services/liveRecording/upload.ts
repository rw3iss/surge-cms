/**
 * Upload of ONE multipart part to object storage via its presigned URL, with
 * retries. A fresh URL is requested for every attempt, so an expired or
 * refused (403) signature heals itself.
 */
import { cms, } from '../cmsClient';

/** PUT a Blob; resolves the HTTP status (0 = network error). */
export function xhrPut(url: string, blob: Blob, onProgress?: (loaded: number,) => void,): Promise<number> {
    return new Promise((resolve,) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url,);
        if (onProgress) xhr.upload.addEventListener('progress', (e,) => onProgress(e.loaded,),);
        xhr.addEventListener('load', () => resolve(xhr.status,),);
        xhr.addEventListener('error', () => resolve(0,),);
        xhr.addEventListener('timeout', () => resolve(0,),);
        xhr.timeout = 10 * 60 * 1000;
        // Untyped body: no Content-Type header, which a presigned UploadPart
        // URL does not sign (a typed Blob would add one).
        xhr.send(blob.type ? blob.slice(0, blob.size, '',) : blob,);
    },);
}

export const sleep = (ms: number,) => new Promise<void>((r,) => setTimeout(r, ms,));

/** 1 s, 2 s, 4 s … capped at 30 s. */
export const uploadBackoff = (attempt: number,) => Math.min(30000, 1000 * 2 ** Math.max(0, attempt - 1,),);

export interface PutPartOptions {
    /** Give up (throw) after this many attempts; default: keep trying. A
     *  function is re-read every attempt (a live upload becomes bounded once
     *  the show is being finalised). */
    maxAttempts?: number | (() => number);
    /** Called with each failure (the loop continues). */
    onError?: (message: string,) => void;
    /** Stop retrying when this returns true (recording aborted). */
    cancelled?: () => boolean;
}

export async function putPartWithRetry(
    postId: string, recordingId: string, partNumber: number, blob: Blob, opts: PutPartOptions = {},
): Promise<void> {
    const max = () => {
        const m = opts.maxAttempts;
        return typeof m === 'function' ? m() : m ?? Number.POSITIVE_INFINITY;
    };
    for (let attempt = 1; ; attempt++) {
        if (opts.cancelled?.()) throw new Error('Recording cancelled.',);
        let message: string;
        try {
            const { url, } = await cms.posts.liveRecording.partUrl(postId, recordingId, partNumber,);
            const status = await xhrPut(url, blob,);
            if (status >= 200 && status < 300) return;
            message = status === 0
                ? `Part ${partNumber}: network error (check the storage bucket's CORS allows PUT from this site)`
                : `Part ${partNumber}: storage answered HTTP ${status}`;
        } catch (err) {
            message = `Part ${partNumber}: ${(err as Error)?.message || 'upload URL request failed'}`;
        }
        opts.onError?.(message,);
        if (attempt >= max()) throw new Error(message,);
        await sleep(uploadBackoff(attempt,),);
    }
}
