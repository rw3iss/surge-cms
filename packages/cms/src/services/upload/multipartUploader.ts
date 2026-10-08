/**
 * Resumable direct-to-storage multipart uploader (design §2.1 / §2.8 of
 * docs/plans/2026-10-08-self-hosted-video.md).
 *
 * Framework-free: no Solid imports, so it can be unit-tested and reused by any
 * caller. The browser PUTs each part straight to object storage through a
 * presigned URL; the API only creates the session, signs part URLs and
 * completes the upload — no bytes pass through our server.
 *
 *   const up = new MultipartUpload(file, { options, onProgress });
 *   const media = await up.start();     // null when cancelled
 *   up.pause(); up.resume(); up.cancel();
 *
 * Resume: the session is keyed server-side by user + fingerprint, so creating
 * a session for the same file again returns the existing one with the parts
 * already stored (`uploadedParts`) — only the missing parts are sent. The
 * session id is kept in localStorage (`sitesurge.uploads`) until the upload
 * completes or is aborted, so a reload can offer "choose the file to resume".
 */
import type { Media, UploadSession, UploadSessionOptions, } from '@sitesurge/types';
import { cms, } from '../cmsClient';

export type UploadState = 'hashing' | 'uploading' | 'paused' | 'completing' | 'done' | 'error' | 'cancelled';

export interface UploadProgress {
    /** Bytes stored so far (completed parts + bytes of parts in flight). */
    loaded: number;
    total: number;
    /** 0–100. */
    percent: number;
    /** Bytes/second over the last few seconds. */
    speed: number;
    /** Seconds left at the current speed; null when unknown. */
    eta: number | null;
    state: UploadState;
    error: string | null;
}

export interface MultipartUploadOpts {
    options?: UploadSessionOptions;
    onProgress?: (p: UploadProgress,) => void;
    /** Session-id the caller expects to resume. When the server returns a
     *  DIFFERENT session the file's content differs from the one started
     *  earlier — the new session is aborted and the upload fails. */
    expectedSessionId?: string;
    /** Parts in flight at once (default 3). */
    concurrency?: number;
}

/** The persisted record of an unfinished upload. */
export interface StoredUpload {
    sessionId: string;
    fingerprint: string;
    name: string;
    size: number;
}

const STORAGE_KEY = 'sitesurge.uploads';
const MIB = 1024 * 1024;
const URL_BATCH = 20;
const MAX_TRIES = 8;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const PROGRESS_THROTTLE_MS = 200;
const SPEED_WINDOW_MS = 5000;

// ─── localStorage bookkeeping ─────────────────────────────────────────

export function readStoredUploads(): StoredUpload[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY,);
        const list = raw ? JSON.parse(raw,) as unknown : [];
        return Array.isArray(list,) ? list.filter((e,): e is StoredUpload => !!e && typeof e.sessionId === 'string') : [];
    } catch {
        return [];
    }
}

function writeStoredUploads(list: StoredUpload[],): void {
    try {
        if (list.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(list,),);
        else localStorage.removeItem(STORAGE_KEY,);
    } catch { /* storage full / disabled — resume just won't survive a reload */ }
}

export function rememberUpload(entry: StoredUpload,): void {
    writeStoredUploads([...readStoredUploads().filter((e,) => e.sessionId !== entry.sessionId), entry,],);
}

export function forgetUpload(sessionId: string,): void {
    writeStoredUploads(readStoredUploads().filter((e,) => e.sessionId !== sessionId),);
}

// ─── Fingerprint ──────────────────────────────────────────────────────

function toHex(buf: ArrayBuffer,): string {
    return Array.from(new Uint8Array(buf,), (b,) => b.toString(16,).padStart(2, '0',),).join('',);
}

/**
 * `name:size:lastModified:<sha256 hex of first + last 1 MiB>`. The hash part
 * is what rejects a different file that happens to share name and size; it is
 * omitted when `crypto.subtle` is unavailable (insecure origin).
 */
export async function fileFingerprint(file: File,): Promise<string> {
    const base = `${file.name}:${file.size}:${file.lastModified}`;
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return base;
    const head = file.slice(0, Math.min(MIB, file.size,),);
    const tail = file.size > MIB ? file.slice(Math.max(MIB, file.size - MIB,), file.size,) : new Blob([],);
    const bytes = await new Blob([head, tail,],).arrayBuffer();
    return `${base}:${toHex(await subtle.digest('SHA-256', bytes,),)}`;
}

/** Cheap local check before resuming: same name and size as the stored upload. */
export function looksLikeSameFile(entry: { name: string; size: number; }, file: File,): boolean {
    return entry.name === file.name && entry.size === file.size;
}

// ─── Uploader ─────────────────────────────────────────────────────────

class HttpError extends Error {
    constructor(readonly status: number, message: string,) { super(message,); }
}

interface InFlight {
    xhr: XMLHttpRequest;
    loaded: number;
}

const sleep = (ms: number,) => new Promise<void>((r,) => setTimeout(r, ms,));

export class MultipartUpload {
    readonly file: File;
    sessionId: string | null = null;
    media: Media | null = null;

    private opts: MultipartUploadOpts;
    private state: UploadState = 'hashing';
    private error: string | null = null;
    private session: UploadSession | null = null;
    private fingerprint = '';

    private done = new Set<number>();
    private queue: number[] = [];
    private inFlight = new Map<number, InFlight>();
    private attempts = new Map<number, number>();
    private urls = new Map<number, string>();
    private urlFetch: Promise<void> | null = null;
    private doneBytes = 0;

    private autoPaused = false;
    private settle: ((m: Media | null,) => void) | null = null;
    private fail: ((e: Error,) => void) | null = null;
    private samples: { t: number; loaded: number; }[] = [];
    private lastEmit = 0;

    constructor(file: File, opts: MultipartUploadOpts = {},) {
        this.file = file;
        this.opts = opts;
    }

    // ── public API ──

    /** Runs the upload; resolves with the created media, or null when cancelled. */
    start(): Promise<Media | null> {
        return new Promise<Media | null>((resolve, reject,) => {
            this.settle = resolve;
            this.fail = reject;
            window.addEventListener('offline', this.onOffline,);
            window.addEventListener('online', this.onOnline,);
            void this.begin().catch((e,) => this.die(e,));
        },);
    }

    pause(): void {
        if (this.state !== 'uploading' && this.state !== 'hashing') return;
        this.setState('paused',);
        this.abortInFlight();
    }

    /** Continue after a pause or an error (retry budget is reset). */
    resume(): void {
        if (this.state !== 'paused' && this.state !== 'error') return;
        this.autoPaused = false;
        this.error = null;
        this.attempts.clear();
        if (!this.session) {
            // Failed before a session existed — start from the top.
            this.setState('hashing',);
            void this.begin().catch((e,) => this.die(e,));
            return;
        }
        this.setState('uploading',);
        this.pump();
    }

    async cancel(): Promise<void> {
        if (this.state === 'done' || this.state === 'cancelled') return;
        this.setState('cancelled',);
        this.abortInFlight();
        this.cleanup();
        if (this.sessionId) {
            forgetUpload(this.sessionId,);
            try { await cms.media.uploads.abort(this.sessionId,); } catch { /* expires server-side anyway */ }
        }
        this.settle?.(null,);
    }

    progress(): UploadProgress {
        const total = this.file.size;
        let loaded = this.doneBytes;
        for (const f of this.inFlight.values()) loaded += f.loaded;
        loaded = Math.min(loaded, total,);
        const speed = this.speed();
        const eta = speed > 0 && this.state === 'uploading' ? Math.round((total - loaded) / speed,) : null;
        return {
            loaded,
            total,
            percent: total ? Math.min(100, (loaded / total) * 100,) : 100,
            speed,
            eta,
            state: this.state,
            error: this.error,
        };
    }

    // ── flow ──

    private async begin(): Promise<void> {
        this.setState('hashing',);
        this.fingerprint = await fileFingerprint(this.file,);
        if (this.state !== 'hashing') return; // paused/cancelled while hashing
        const session = await cms.media.uploads.create({
            filename: this.file.name,
            mimeType: this.file.type || 'application/octet-stream',
            size: this.file.size,
            fingerprint: this.fingerprint,
            options: this.opts.options,
        },);
        if (this.opts.expectedSessionId && session.id !== this.opts.expectedSessionId) {
            try { await cms.media.uploads.abort(session.id,); } catch { /* best effort */ }
            throw new Error('This is not the same file as the unfinished upload (its contents differ). Choose the original file.',);
        }
        if ((this.state as UploadState) === 'cancelled') {
            // Cancelled while the session was being created.
            try { await cms.media.uploads.abort(session.id,); } catch { /* best effort */ }
            return;
        }
        this.session = session;
        this.sessionId = session.id;
        rememberUpload({ sessionId: session.id, fingerprint: this.fingerprint, name: this.file.name, size: this.file.size, },);

        this.done = new Set(session.uploadedParts,);
        this.doneBytes = 0;
        for (const n of this.done) this.doneBytes += this.partEnd(n,) - this.partStart(n,);
        this.queue = [];
        for (let n = 1; n <= session.partCount; n++) if (!this.done.has(n,)) this.queue.push(n,);

        if (this.state !== 'hashing') return;
        if (!navigator.onLine) {
            this.autoPaused = true;
            this.setState('paused',);
            return;
        }
        this.setState('uploading',);
        this.pump();
    }

    private pump(): void {
        if (this.state !== 'uploading' || !this.session) return;
        const limit = this.opts.concurrency ?? 3;
        while (this.inFlight.size < limit && this.queue.length) {
            const n = this.queue.shift()!;
            void this.sendPart(n,);
        }
        if (!this.queue.length && !this.inFlight.size && this.done.size >= this.session.partCount) {
            void this.finish().catch((e,) => this.die(e,));
        }
    }

    private async sendPart(n: number,): Promise<void> {
        const slot: InFlight = { xhr: new XMLHttpRequest(), loaded: 0, };
        this.inFlight.set(n, slot,);
        try {
            const url = await this.urlFor(n,);
            if (this.state !== 'uploading') throw new Error('stopped',);
            await this.put(slot, url, this.file.slice(this.partStart(n,), this.partEnd(n,),),);
            this.inFlight.delete(n,);
            this.done.add(n,);
            this.doneBytes += this.partEnd(n,) - this.partStart(n,);
            this.emit();
            this.pump();
        } catch (e) {
            this.inFlight.delete(n,);
            if (this.state !== 'uploading') {
                // Paused / cancelled: the part goes back to the front of the queue.
                this.queue.unshift(n,);
                this.emit(true,);
                return;
            }
            if (e instanceof HttpError && e.status === 403) this.urls.delete(n,); // presigned URL expired
            // Offline: the `offline` handler pauses; do not burn a try.
            if (!navigator.onLine) {
                this.queue.unshift(n,);
                return;
            }
            const tries = (this.attempts.get(n,) ?? 0) + 1;
            this.attempts.set(n, tries,);
            if (tries >= MAX_TRIES) {
                this.queue.unshift(n,);
                this.error = `Part ${n} failed after ${MAX_TRIES} tries: ${(e as Error).message}`;
                this.abortInFlight();
                this.setState('error',);
                return;
            }
            // Hold the slot through the backoff so concurrency stays bounded.
            this.inFlight.set(n, slot,);
            slot.loaded = 0;
            await sleep(Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (tries - 1),),);
            this.inFlight.delete(n,);
            this.queue.unshift(n,);
            this.pump();
        }
    }

    private put(slot: InFlight, url: string, body: Blob,): Promise<void> {
        return new Promise<void>((resolve, reject,) => {
            const xhr = slot.xhr = new XMLHttpRequest();
            xhr.open('PUT', url,);
            xhr.upload.addEventListener('progress', (ev,) => {
                slot.loaded = ev.loaded;
                this.emit();
            },);
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) resolve();
                else reject(new HttpError(xhr.status, `HTTP ${xhr.status}`,),);
            },);
            xhr.addEventListener('error', () => reject(new HttpError(0, 'Network error',),),);
            xhr.addEventListener('abort', () => reject(new HttpError(0, 'Aborted',),),);
            xhr.send(body,);
        },);
    }

    /** A presigned URL for part `n`, fetching the next batch (≤ 20) when missing. */
    private async urlFor(n: number,): Promise<string> {
        while (!this.urls.has(n,)) {
            if (!this.urlFetch) {
                const wanted = [n, ...this.queue.filter((q,) => !this.urls.has(q,) && q !== n),].slice(0, URL_BATCH,);
                this.urlFetch = cms.media.uploads.partUrls(this.sessionId!, wanted,)
                    .then((res,) => { for (const u of res.urls) this.urls.set(u.partNumber, u.url,); },)
                    .finally(() => { this.urlFetch = null; },);
            }
            // When the awaited batch was another part's and missed n, loop and fetch ours.
            await this.urlFetch;
        }
        const url = this.urls.get(n,)!;
        this.urls.delete(n,); // one use; a retry re-signs (cheap, and avoids expired URLs)
        return url;
    }

    private async finish(): Promise<void> {
        if (this.state !== 'uploading') return;
        this.setState('completing',);
        const media = await cms.media.uploads.complete(this.sessionId!,);
        this.media = media;
        forgetUpload(this.sessionId!,);
        this.cleanup();
        this.setState('done',);
        this.settle?.(media,);
    }

    private die(e: unknown,): void {
        if (this.state === 'cancelled') return;
        this.error = (e as Error)?.message || 'Upload failed';
        this.abortInFlight();
        this.setState('error',);
        // A wrong-file resume is final; a network/API error can be resumed.
        if (this.opts.expectedSessionId && !this.session) {
            this.cleanup();
            this.fail?.(e instanceof Error ? e : new Error(this.error,),);
        }
    }

    // ── helpers ──

    private partStart(n: number,): number { return (n - 1) * this.session!.partSize; }
    private partEnd(n: number,): number { return Math.min(this.file.size, n * this.session!.partSize,); }

    private abortInFlight(): void {
        for (const f of this.inFlight.values()) {
            try { f.xhr.abort(); } catch { /* ignore */ }
        }
    }

    private cleanup(): void {
        window.removeEventListener('offline', this.onOffline,);
        window.removeEventListener('online', this.onOnline,);
    }

    private onOffline = (): void => {
        if (this.state === 'uploading') {
            this.autoPaused = true;
            this.pause();
        }
    };

    private onOnline = (): void => {
        if (this.autoPaused && this.state === 'paused') this.resume();
    };

    private setState(s: UploadState,): void {
        this.state = s;
        if (s !== 'uploading') this.samples = [];
        this.emit(true,);
    }

    private speed(): number {
        const s = this.samples;
        if (s.length < 2) return 0;
        const a = s[0]!, b = s[s.length - 1]!;
        const dt = (b.t - a.t) / 1000;
        return dt > 0 ? Math.max(0, (b.loaded - a.loaded) / dt,) : 0;
    }

    private emit(force = false,): void {
        const now = Date.now();
        if (this.state === 'uploading') {
            let loaded = this.doneBytes;
            for (const f of this.inFlight.values()) loaded += f.loaded;
            this.samples.push({ t: now, loaded, },);
            while (this.samples.length > 2 && now - this.samples[0]!.t > SPEED_WINDOW_MS) this.samples.shift();
        }
        if (!force && now - this.lastEmit < PROGRESS_THROTTLE_MS) return;
        this.lastEmit = now;
        this.opts.onProgress?.(this.progress(),);
    }
}
