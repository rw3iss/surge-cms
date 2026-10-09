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
const waiters = new Map<string, ((m: Media | null,) => void)[]>();
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
                patch(id, { mediaId: media.id, state: 'done', percent: 100, loaded: up.file.size, eta: null, speed: 0, },);
                setVersion((v,) => v + 1,);
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

/** Start a new upload; returns the row id. */
export function startUpload(file: File, options?: UploadSessionOptions,): string {
    const id = `up-${++seq}`;
    setState('items', (items,) => [...items, {
        id, sessionId: null, name: file.name, size: file.size, loaded: 0, percent: 0,
        speed: 0, eta: null, state: 'hashing', error: null, mediaId: null,
    },],);
    const up = new MultipartUpload(file, {
        options,
        onProgress: (p,) => {
            applyProgress(id, p,);
            if (up.sessionId) patch(id, { sessionId: up.sessionId, },);
        },
    },);
    run(id, up,);
    return id;
}

/** Resolves with the created media when the row completes (null if cancelled/failed). */
export function whenComplete(id: string,): Promise<Media | null> {
    const item = state.items.find((i,) => i.id === id,);
    if (!item) return Promise.resolve(null,);
    if (item.state === 'done') return Promise.resolve(null,);
    return new Promise((resolve,) => waiters.set(id, [...(waiters.get(id,) ?? []), resolve,],),);
}

/** The row still has a live uploader (so pause/resume/retry apply). */
export function isLive(id: string,): boolean { return uploaders.has(id,); }

export function pause(id: string,): void { uploaders.get(id,)?.pause(); }
export function resume(id: string,): void { uploaders.get(id,)?.resume(); }

/** Cancel a running upload, or discard an unfinished session. */
export async function cancel(id: string,): Promise<void> {
    const up = uploaders.get(id,);
    if (up) {
        await up.cancel();
        return;
    }
    const item = state.items.find((i,) => i.id === id,);
    if (item?.state === 'unfinished' && item.sessionId) {
        forgetUpload(item.sessionId,);
        try { await cms.media.uploads.abort(item.sessionId,); } catch { /* expires anyway */ }
        patch(id, { state: 'cancelled', },);
    }
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
            },);
        }
    },),);
}
