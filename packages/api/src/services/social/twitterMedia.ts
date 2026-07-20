/**
 * X/Twitter media upload for POSSE publishing. Photos use the one-shot upload;
 * video/GIF/large images use the chunked INIT/APPEND/FINALIZE flow with an
 * async processing poll. Auth is the same user-context OAuth 1.0a as compose
 * (`twitterOAuth`). Multipart params don't participate in the OAuth signature;
 * form-urlencoded params (INIT/FINALIZE/STATUS) do.
 *
 * Endpoint note: this targets the v1.1 upload host (`upload.twitter.com`), the
 * canonical OAuth-1.0a media flow. If X fully retires it in favour of
 * `/2/media/upload`, switch UPLOAD_URL below — the command flow is equivalent.
 */
import fs from 'fs/promises';
import path from 'path';
import { config, } from '../../config';
import { logger, } from '../../utils/logger';
import { buildAuthHeader, type TwitterUserCreds, } from './twitterOAuth';

const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';
const IMAGE_SIMPLE_MAX = 5 * 1024 * 1024; // 5 MB — larger images go chunked
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB per APPEND (under the 5 MB cap)
const MAX_STATUS_POLLS = 20;

export type MediaCategory = 'tweet_image' | 'tweet_gif' | 'tweet_video';

/** Map a MIME type to X's `media_category`. */
export function mediaCategory(mime: string,): MediaCategory {
    if (mime === 'image/gif') return 'tweet_gif';
    if (mime.startsWith('video/',)) return 'tweet_video';
    return 'tweet_image';
}

/** Whether a MIME type + size must use the chunked flow (video/gif/large). */
export function needsChunkedUpload(mime: string, size: number,): boolean {
    return mediaCategory(mime,) !== 'tweet_image' || size > IMAGE_SIMPLE_MAX;
}

/** Number of APPEND segments a payload of `size` bytes needs. Pure — testable. */
export function chunkCount(size: number, chunk: number = CHUNK_SIZE,): number {
    return Math.max(1, Math.ceil(size / chunk,),);
}

const sleep = (ms: number,): Promise<void> => new Promise((r,) => setTimeout(r, ms,));

/** Best-effort MIME from a filename extension (for local reads). */
function mimeFromExt(filename: string,): string {
    switch (path.extname(filename,).toLowerCase()) {
        case '.png': return 'image/png';
        case '.gif': return 'image/gif';
        case '.webp': return 'image/webp';
        case '.mp4': return 'video/mp4';
        case '.mov': return 'video/quicktime';
        case '.webm': return 'video/webm';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        default: return 'application/octet-stream';
    }
}

/**
 * Read a media asset's bytes + MIME from its CMS URL. Local storage serves
 * relative `/uploads/<file>` URLs, which Node `fetch` can't parse — those are
 * read straight from the upload dir on disk. Absolute http(s) URLs (S3 /
 * external) are fetched. We upload these bytes to X ourselves, so the media
 * host never needs to be publicly reachable (localhost is fine).
 */
export async function fetchMediaBytes(url: string,): Promise<{ bytes: Buffer; mime: string; }> {
    if (!/^https?:\/\//i.test(url,)) {
        // Relative /uploads/<file> (optionally with a query) → read from disk.
        const filename = path.basename(url.split('?',)[0],);
        const filePath = path.join(config.upload.dir, filename,);
        try {
            const bytes = await fs.readFile(filePath,);
            return { bytes, mime: mimeFromExt(filename,), };
        } catch (error) {
            throw new Error(`Could not read local media ${filePath}: ${error instanceof Error ? error.message : error}`,);
        }
    }

    const res = await fetch(url,);
    if (!res.ok) throw new Error(`Could not fetch media (${res.status}) from ${url}`,);
    const mime = res.headers.get('content-type',)?.split(';',)[0]?.trim() || 'application/octet-stream';
    const bytes = Buffer.from(await res.arrayBuffer(),);
    return { bytes, mime, };
}

function authFor(extraParams: Record<string, string>, creds: TwitterUserCreds, method = 'POST', url = UPLOAD_URL,): string {
    return buildAuthHeader(method, url, extraParams, creds,);
}

/** One-shot image upload (≤5 MB, non-GIF). Returns the media id. */
async function uploadSimple(bytes: Buffer, mime: string, creds: TwitterUserCreds,): Promise<string> {
    const form = new FormData();
    // Copy into a fresh Uint8Array so the Blob part is ArrayBuffer-backed.
    form.append('media', new Blob([new Uint8Array(bytes,)], { type: mime, },),);
    form.append('media_category', 'tweet_image',);
    // Multipart body → not signed; sign oauth params only.
    const res = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { Authorization: authFor({}, creds,), },
        body: form,
    },);
    if (!res.ok) throw new Error(`media upload failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200,)}`,);
    const json = await res.json() as { media_id_string?: string; };
    if (!json.media_id_string) throw new Error('media upload returned no media_id',);
    return json.media_id_string;
}

/** Chunked upload (video / GIF / large image) with processing poll. */
async function uploadChunked(bytes: Buffer, mime: string, creds: TwitterUserCreds,): Promise<string> {
    const category = mediaCategory(mime,);

    // INIT (form-urlencoded → params ARE signed).
    const initParams: Record<string, string> = {
        command: 'INIT',
        total_bytes: String(bytes.length,),
        media_type: mime,
        media_category: category,
    };
    const initRes = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: {
            Authorization: authFor(initParams, creds,),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(initParams,).toString(),
    },);
    if (!initRes.ok) throw new Error(`media INIT failed (${initRes.status}): ${(await initRes.text().catch(() => '')).slice(0, 200,)}`,);
    const initJson = await initRes.json() as { media_id_string?: string; };
    const mediaId = initJson.media_id_string;
    if (!mediaId) throw new Error('media INIT returned no media_id',);

    // APPEND each chunk (multipart → not signed).
    const total = chunkCount(bytes.length,);
    for (let i = 0; i < total; i++) {
        const slice = bytes.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE,);
        const form = new FormData();
        form.append('command', 'APPEND',);
        form.append('media_id', mediaId,);
        form.append('segment_index', String(i,),);
        form.append('media', new Blob([new Uint8Array(slice,)],),);
        const appendRes = await fetch(UPLOAD_URL, {
            method: 'POST',
            headers: { Authorization: authFor({}, creds,), },
            body: form,
        },);
        if (!appendRes.ok) throw new Error(`media APPEND ${i} failed (${appendRes.status})`,);
    }

    // FINALIZE (form-urlencoded → signed).
    const finalizeParams = { command: 'FINALIZE', media_id: mediaId, };
    const finalizeRes = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: {
            Authorization: authFor(finalizeParams, creds,),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(finalizeParams,).toString(),
    },);
    if (!finalizeRes.ok) throw new Error(`media FINALIZE failed (${finalizeRes.status})`,);
    const finalizeJson = await finalizeRes.json() as { processing_info?: { state: string; check_after_secs?: number; }; };

    // Poll STATUS until processing completes (videos process asynchronously).
    let info = finalizeJson.processing_info;
    let polls = 0;
    while (info && info.state !== 'succeeded' && polls < MAX_STATUS_POLLS) {
        if (info.state === 'failed') throw new Error('media processing failed',);
        await sleep(Math.max(1, info.check_after_secs ?? 2,) * 1000,);
        const statusParams = { command: 'STATUS', media_id: mediaId, };
        const statusUrl = `${UPLOAD_URL}?command=STATUS&media_id=${encodeURIComponent(mediaId,)}`;
        const statusRes = await fetch(statusUrl, {
            method: 'GET',
            headers: { Authorization: authFor(statusParams, creds, 'GET', statusUrl,), },
        },);
        if (!statusRes.ok) throw new Error(`media STATUS failed (${statusRes.status})`,);
        const statusJson = await statusRes.json() as { processing_info?: { state: string; check_after_secs?: number; }; };
        info = statusJson.processing_info;
        polls++;
    }
    if (info && info.state !== 'succeeded') throw new Error('media processing did not complete in time',);

    return mediaId;
}

/** Upload one media asset and return its X media id (picks simple vs chunked). */
export async function uploadMedia(bytes: Buffer, mime: string, creds: TwitterUserCreds,): Promise<string> {
    logger.info('Uploading media to X', { mime, bytes: bytes.length, chunked: needsChunkedUpload(mime, bytes.length,), },);
    return needsChunkedUpload(mime, bytes.length,)
        ? uploadChunked(bytes, mime, creds,)
        : uploadSimple(bytes, mime, creds,);
}
