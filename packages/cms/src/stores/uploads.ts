/**
 * Active direct (multipart) uploads — a singleton store shared by the upload
 * tray, the upload modal and the media library, so an upload keeps running
 * while the editor navigates between admin pages.
 *
 * Each row is either a running upload (it owns a `MultipartUpload`) or an
 * `unfinished` session found after a reload — the browser cannot reopen a
 * `File`, so the user picks the file again (`resumeWithFile`).
 *
 * `uploadsVersion()` ticks each time an upload completes; the media library
 * watches it to refetch.
 */
import { isVideoFile, } from '@sitesurge/types';
import type { Media, UploadSessionOptions, } from '@sitesurge/types';
import { createSignal, } from 'solid-js';
import { createStore, produce, } from 'solid-js/store';
import { cms, } from '../services/cmsClient';
import {
    forgetUpload,
    looksLikeSameFile,
    MultipartUpload,
    readStoredUploads,
    type UploadProgress,
    type UploadState,
} from '../services/upload/multipartUploader';
import { isFeatureEnabled, } from './siteSettings';

export type UploadItemState = UploadState | 'unfinished';

export interface UploadItem {
    /** Local row id (stable for the row's life). */
    id: string;
    sessionId: string | null;
    name: string;
    size: number;
    loaded: number;
    percent: number;
    speed: number;
    eta: number | null;
    state: UploadItemState;
    error: string | null;
    mediaId: string | null;
    /** Title the media gets (editable until the upload completes — the
     *  latest value is sent on completion). */
    title: string;
    /** Done, and the video is still being encoded (Cancel still applies). */
    processing: boolean;
}

/** Files above this go through the multipart uploader even when not video. */
export const MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024;

/** True when this file should use the direct multipart path (video feature on
 *  AND the file is a video or larger than 50 MB). */
export function usesMultipart(file: File,): boolean {
    if (!isFeatureEnabled('video',)) return false;
    return isVideoFile(file.name, file.type,) || file.size > MULTIPART_THRESHOLD_BYTES;
}

const [state, setState,] = createStore<{ items: UploadItem[]; }>({ items: [], },);
const [version, setVersion,] = createSignal(0,);

const uploaders = new Map<string, MultipartUpload>();
const PROCESSING_POLL_MS = 10_000;
const waiters = new Map<string, ((m: Media | null,) => void)[]>();
/** The media each finished row produced, so a late `whenComplete` still gets it. */
const completed = new Map<string, Media>();
let seq = 0;
let unfinishedLoaded = false;

export const uploads = state;
/** Ticks when any upload completes (the library refetches on change). */
export const uploadsVersion = version;

const ACTIVE: UploadItemState[] = ['hashing', 'uploading', 'completing',];

/** An upload would be lost by closing the tab. */
export function hasActiveUploads(): boolean {
    return state.items.some((i,) => ACTIVE.includes(i.state,),);
}

function patch(id: string, p: Partial<UploadItem>,): void {
    const idx = state.items.findIndex((i,) => i.id === id,);
    if (idx >= 0) setState('items', idx, p,);
}

function applyProgress(id: string, p: UploadProgress,): void {
    patch(id, { loaded: p.loaded, percent: p.percent, speed: p.speed, eta: p.eta, state: p.state, error: p.error, },);
}

function settleWaiters(id: string, media: Media | null,): void {
    for (const w of waiters.get(id,) ?? []) w(media,);
    waiters.delete(id,);
}

/** `failState`: where a FATAL failure leaves the row — a wrong-file resume
 *  goes back to `unfinished` so the user can pick the right file. */
function run(id: string, up: MultipartUpload, failState: UploadItemState = 'error',): void {
    uploaders.set(id, up,);
    up.start()
        .then((media,) => {
            const sid = up.sessionId;
            if (sid) patch(id, { sessionId: sid, },);
            if (media) {
                completed.set(id, media,);
                const processing = media.status === 'processing';
                patch(id, { mediaId: media.id, state: 'done', percent: 100, loaded: up.file.size, eta: null, speed: 0, processing, },);
                setVersion((v,) => v + 1,);
                if (processing) watchProcessing(id, media.id,);
            }
            settleWaiters(id, media,);
            uploaders.delete(id,);
        },)
        .catch((e: Error,) => {
            patch(id, { state: failState, error: e.message, },);
            settleWaiters(id, null,);
            uploaders.delete(id,);
        },);
}

/** Poll a finished video until its encode settles (so Cancel disappears). */
function watchProcessing(id: string, mediaId: string,): void {
    const tick = async () => {
        const row = state.items.find((i,) => i.id === id,);
        if (!row || !row.processing || row.mediaId !== mediaId) return;
        try {
            const info = await cms.media.video.info(mediaId,);
            if (info.status !== 'processing') {
                patch(id, { processing: false, },);
                return;
            }
        } catch { /* deleted or unreadable — stop watching */
            patch(id, { processing: false, },);
            return;
        }
        setTimeout(() => void tick(), PROCESSING_POLL_MS,);
    };
    setTimeout(() => void tick(), PROCESSING_POLL_MS,);
}

/** `IMG_2034.jpeg` → `IMG 2034` — the server's fallback title for a file. */
export function defaultTitle(name: string,): string {
    return name.replace(/\.[a-z0-9]{2,5}$/i, '',).replace(/[_-]+/g, ' ',).trim();
}

/** Start a new upload; returns the row id. `options.title` defaults to the
 *  file name (see `defaultTitle`); change it later with `setUploadTitle`. */
export function startUpload(file: File, options?: UploadSessionOptions,): string {
    const id = `up-${++seq}`;
    const title = options?.title ?? defaultTitle(file.name,);
    setState('items', (items,) => [...items, {
        id, sessionId: null, name: file.name, size: file.size, loaded: 0, percent: 0,
        speed: 0, eta: null, state: 'hashing', error: null, mediaId: null, title, processing: false,
    },],);
    const up = new MultipartUpload(file, {
        options: { ...options, title, },
        getTitle: () => state.items.find((i,) => i.id === id,)?.title,
        onProgress: (p,) => {
            applyProgress(id, p,);
            if (up.sessionId) patch(id, { sessionId: up.sessionId, },);
        },
    },);
    run(id, up,);
    return id;
}

/**
 * Resolves with the created media when the row completes — also when it had
 * ALREADY completed before the call (a fast upload). Null only when the row
 * was cancelled / failed (or never existed).
 */
export function whenComplete(id: string,): Promise<Media | null> {
    const done = completed.get(id,);
    if (done) return Promise.resolve(done,);
    const item = state.items.find((i,) => i.id === id,);
    if (!item) return Promise.resolve(null,);
    if (item.state === 'done' || item.state === 'cancelled' || item.state === 'error') return Promise.resolve(null,);
    return new Promise((resolve,) => waiters.set(id, [...(waiters.get(id,) ?? []), resolve,],),);
}

/** The row still has a live uploader (so pause/resume/retry apply). */
export function isLive(id: string,): boolean { return uploaders.has(id,); }

export function pause(id: string,): void { uploaders.get(id,)?.pause(); }
export function resume(id: string,): void { uploaders.get(id,)?.resume(); }

/** Rename an upload before it completes: the latest title is sent on completion. */
export function setUploadTitle(id: string, title: string,): void {
    patch(id, { title, },);
}

function removeRow(id: string,): void {
    completed.delete(id,);
    setState('items', (items,) => items.filter((i,) => i.id !== id,),);
}

/**
 * CANCEL a row — whatever stage it is at — and remove it from the list:
 * a running upload aborts every in-flight part and the session (server
 * discards the parts and deletes the session); an unfinished session is
 * aborted; a finished one whose video is still encoding is DISCARDED
 * (`cms.media.discard`: the encode stops, its files, media row and any
 * gallery item made from it are deleted). Callers confirm the last case.
 */
export async function cancel(id: string,): Promise<void> {
    const up = uploaders.get(id,);
    const item = state.items.find((i,) => i.id === id,);
    if (up) {
        await up.cancel();
    } else if (item?.state === 'unfinished' && item.sessionId) {
        forgetUpload(item.sessionId,);
        try { await cms.media.uploads.abort(item.sessionId,); } catch { /* expires anyway */ }
    } else if (item?.mediaId) {
        await cms.media.discard(item.mediaId,);
        setVersion((v,) => v + 1,);
    }
    removeRow(id,);
}

/**
 * Cancel the upload/encode behind a media item (library or gallery tile):
 * discards it on the server and drops its upload row, if any.
 */
export async function cancelMedia(mediaId: string, opts: { force?: boolean; } = {},): Promise<void> {
    await cms.media.discard(mediaId, opts,);
    for (const i of state.items.filter((x,) => x.mediaId === mediaId,)) removeRow(i.id,);
    setVersion((v,) => v + 1,);
}

/** Remove a finished/failed/cancelled/unfinished row from the list. */
export function dismiss(id: string,): void {
    const item = state.items.find((i,) => i.id === id,);
    if (!item || ACTIVE.includes(item.state,) || item.state === 'paused') return;
    setState('items', (items,) => items.filter((i,) => i.id !== id,),);
}

/** Remove every settled row. */
export function dismissFinished(): void {
    setState('items', (items,) => items.filter((i,) => i.state !== 'done' && i.state !== 'cancelled',),);
}

/**
 * Resume an unfinished session with a file the user picked again. Returns an
 * error message when the file is obviously not the same one (name/size); a
 * same-name/size file with different content is caught after hashing (the
 * server would otherwise start a NEW session for it).
 */
export function resumeWithFile(sessionId: string, file: File,): string | null {
    const item = state.items.find((i,) => i.sessionId === sessionId && i.state === 'unfinished',);
    if (!item) return 'That upload is no longer waiting to be resumed.';
    if (!looksLikeSameFile(item, file,)) {
        return `That is a different file. Choose "${item.name}" (${item.size.toLocaleString()} bytes) to resume.`;
    }
    const id = item.id;
    patch(id, { state: 'hashing', error: null, },);
    const up = new MultipartUpload(file, {
        expectedSessionId: sessionId,
        getTitle: () => state.items.find((i,) => i.id === id,)?.title,
        onProgress: (p,) => applyProgress(id, p,),
    },);
    run(id, up, 'unfinished',);
    return null;
}

/**
 * Load sessions left unfinished by an earlier page (server list, cross-checked
 * with localStorage). Runs once per page load; stale localStorage entries the
 * server no longer has are dropped.
 */
export async function loadUnfinished(): Promise<void> {
    if (unfinishedLoaded) return;
    unfinishedLoaded = true;
    let sessions;
    try {
        sessions = await cms.media.uploads.list();
    } catch {
        unfinishedLoaded = false;
        return;
    }
    const open = sessions.filter((s,) => s.status === 'uploading',);
    const openIds = new Set(open.map((s,) => s.id),);
    for (const stored of readStoredUploads()) {
        if (!openIds.has(stored.sessionId,)) forgetUpload(stored.sessionId,);
    }
    setState(produce((s,) => {
        for (const sess of open) {
            if (s.items.some((i,) => i.sessionId === sess.id,)) continue;
            s.items.push({
                id: `up-${++seq}`,
                sessionId: sess.id,
                name: sess.filename,
                size: sess.size,
                loaded: sess.uploadedBytes,
                percent: sess.size ? Math.min(100, (sess.uploadedBytes / sess.size) * 100,) : 0,
                speed: 0,
                eta: null,
                state: 'unfinished',
                error: null,
                mediaId: null,
                title: (sess.options?.title as string | undefined) ?? defaultTitle(sess.filename,),
                processing: false,
            },);
        }
    },),);
}
