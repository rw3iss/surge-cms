/**
 * BROWSER recorder: MediaRecorder on the host's camera stream (the same
 * MediaStream the WHIP publisher sends), uploaded to object storage WHILE
 * live as an S3/R2 multipart upload.
 *
 * - Chunks arrive every 2 s (`timeslice`); `PartSlicer` cuts them into parts
 *   of exactly `partSize` bytes; parts upload strictly in order, one at a
 *   time, numbered on from the server's `uploadedParts` when resuming.
 * - `stop()` flushes the remainder as the final (short) part, waits for the
 *   queue, then `complete`s — which turns it into a video media item that the
 *   pipeline encodes into the replay.
 * - Every chunk is also kept in IndexedDB until uploaded (`store.ts`), so a
 *   reload can still FINISH the recording with everything this browser held.
 *
 * ONE MediaRecorder per recording: pause/resume never restart it. A new
 * MediaRecorder writes a fresh container header, so its bytes can never be
 * appended to an earlier upload — after a reload the open recording is
 * finished as it stands (`finishStoredRecording`) and, if the show goes on, a
 * NEW recording (a second media item, "part 2") is started. That is why
 * `start()` completes any recording still open before creating its own. A
 * chunk the recorder had not yet delivered when the page died (≤ 2 s) is lost.
 */
import type { LiveRecording, } from '@sitesurge/types';
import { cms, } from '../cmsClient';
import { PartSlicer, } from './partSlicer';
import { recordingStore, } from './store';
import type { LiveRecorder, RecorderProgress, } from './types';
import { EMPTY_PROGRESS, } from './types';
import { putPartWithRetry, } from './upload';

export const TIMESLICE_MS = 2000;
/** Attempts per part once finalising (while live, uploads retry forever). */
const FINAL_ATTEMPTS = 6;

/**
 * H.264 first: the server's QUICK REPLAY copies the H.264 video untouched into
 * a faststart MP4 (audio → AAC), so the replay is ready a minute or two after
 * the show, at camera quality, playable in every browser. MP4/AAC (Safari,
 * recent Chrome/Edge) is ideal; WebM/Matroska with H.264 (Chrome/Edge) works
 * too (Opus is converted). VP9/VP8 (Firefox) still records and encodes, but
 * gets no quick replay — the replay then waits for the first encoded quality.
 */
const MIME_PREFERENCE = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1.4d002a,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/webm;codecs=h264,opus',
    'video/x-matroska;codecs=avc1,opus',
    'video/webm;codecs=avc1,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/mp4',
];

/** Does this recording type get the instant (quick) replay? */
export function isQuickReplayFormat(mime: string,): boolean {
    return /avc1|h264/i.test(mime,) || /^video\/mp4$/i.test(mime.trim(),);
}

/** Human summary of what this browser will record. */
export function recordingFormatInfo(mime = pickRecordingMimeType(),): { mime: string; label: string; quickReplay: boolean; } {
    const quickReplay = isQuickReplayFormat(mime,);
    const container = /mp4/i.test(mime,) ? 'MP4' : /matroska/i.test(mime,) ? 'MKV' : 'WebM';
    const codec = /avc1|h264/i.test(mime,) ? 'H.264' : /vp9/i.test(mime,) ? 'VP9' : /vp8/i.test(mime,) ? 'VP8' : mime ? 'default' : 'browser default';
    const audio = /mp4a|aac/i.test(mime,) ? 'AAC' : /opus/i.test(mime,) ? 'Opus' : '';
    return { mime, label: `${codec}${audio ? ` + ${audio}` : ''} (${container})`, quickReplay, };
}

/** First MediaRecorder type this browser supports ('' = its default). */
export function pickRecordingMimeType(): string {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    return MIME_PREFERENCE.find((t,) => MediaRecorder.isTypeSupported(t,)) ?? '';
}

/** Original-quality target bitrate by camera height. */
export function recordingBitrate(height: number | undefined,): number {
    const h = height ?? 720;
    if (h >= 1080) return 8_000_000;
    if (h >= 720) return 5_000_000;
    return 2_500_000;
}

/** A recording still taking parts (not completed / aborted / failed). */
export const isOpenRecording = (rec: LiveRecording,) => rec.status === 'recording';

/** Part numbers the server already has → the next one to use. */
export const nextPartNumber = (uploaded: number[],) => (uploaded.length ? Math.max(...uploaded,) + 1 : 1);

/**
 * Bytes at the start of a stored leftover that the server already has: the
 * page can die between a part's upload and the local bookkeeping, in which
 * case the server is ahead by whole (full-size) parts.
 */
export function leftoverSkip(serverParts: number[], localLastPart: number, partSize: number,): number {
    const serverLast = serverParts.length ? Math.max(...serverParts,) : 0;
    return Math.max(0, serverLast - localLastPart,) * partSize;
}

interface QueuedPart { n: number; blob: Blob; end: number; }

export class BrowserRecorder implements LiveRecorder {
    readonly method = 'browser' as const;
    private mr: MediaRecorder | null = null;
    private slicer: PartSlicer | null = null;
    private postId = '';
    private rec: LiveRecording | null = null;
    private mimeType = '';
    private queue: QueuedPart[] = [];
    private draining: Promise<void> | null = null;
    private nextPart = 1;
    private seq = 0;
    /** Bytes received this session (incl. a resumed leftover). */
    private received = 0;
    /** Bytes cut into parts this session. */
    private cut = 0;
    private finalizing = false;
    private aborted = false;
    private recorderStopped: Promise<void> | null = null;
    private progress: RecorderProgress = { ...EMPTY_PROGRESS, };
    private subs = new Set<(p: RecorderProgress,) => void>();

    onProgress(cb: (p: RecorderProgress,) => void,): () => void {
        this.subs.add(cb,);
        cb(this.progress,);
        return () => this.subs.delete(cb,);
    }

    private emit(patch: Partial<RecorderProgress>,) {
        const queued = this.queue.reduce((s, p,) => s + p.blob.size, 0,);
        this.progress = { ...this.progress, ...patch, pendingBytes: (this.slicer?.pendingBytes ?? 0) + queued, };
        for (const fn of this.subs) fn(this.progress,);
    }

    async start(postId: string, stream: MediaStream,): Promise<void> {
        if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video (no MediaRecorder).',);
        if (!stream.getTracks().length) throw new Error('No camera stream to record.',);
        this.postId = postId;
        this.mimeType = pickRecordingMimeType();
        // The server's start RESUMES an open recording — never append a new
        // recorder's stream to it: finish that one first.
        const open = await cms.posts.liveRecording.get(postId,);
        if (open && isOpenRecording(open,)) await finishStoredRecording(postId, open,);
        const rec = await cms.posts.liveRecording.start(postId, { mimeType: this.mimeType || 'video/webm', },);
        this.rec = rec;
        this.nextPart = nextPartNumber(rec.uploadedParts,);
        this.slicer = new PartSlicer(rec.partSize, this.mimeType,);
        this.emit({
            state: 'recording', recordingId: rec.id, uploadedBytes: rec.uploadedBytes,
            uploadedParts: rec.uploadedParts.length, error: null,
        },);

        await recordingStore.clear(rec.id,);
        await this.saveMeta(0,);

        const height = stream.getVideoTracks()[0]?.getSettings?.().height;
        const mr = new MediaRecorder(stream, {
            ...(this.mimeType ? { mimeType: this.mimeType, } : {}),
            videoBitsPerSecond: recordingBitrate(height,),
            audioBitsPerSecond: 128_000,
        },);
        this.mr = mr;
        mr.addEventListener('dataavailable', (e: BlobEvent,) => {
            if (!this.aborted && e.data?.size) this.ingest(e.data,);
        },);
        mr.addEventListener('error', (e: Event,) => {
            const err = (e as Event & { error?: DOMException; }).error;
            this.emit({ error: `Recorder error: ${err?.message || err?.name || 'unknown'}`, },);
        },);
        this.recorderStopped = new Promise((resolve,) => mr.addEventListener('stop', () => resolve(), { once: true, },),);
        mr.start(TIMESLICE_MS,);
    }

    private saveMeta(uploadedThrough: number,): Promise<void> {
        if (!this.rec) return Promise.resolve();
        return recordingStore.saveMeta({
            recordingId: this.rec.id, postId: this.postId, mimeType: this.mimeType, partSize: this.rec.partSize,
            lastPart: this.nextPart - 1 - this.queue.length, uploadedThrough, updatedAt: Date.now(),
        },);
    }

    private ingest(blob: Blob,) {
        if (!this.rec || !this.slicer) return;
        void recordingStore.putChunk(this.rec.id, this.seq++, this.received, blob,);
        this.received += blob.size;
        for (const part of this.slicer.push(blob,)) {
            this.cut += part.size;
            this.queue.push({ n: this.nextPart++, blob: part, end: this.cut, },);
        }
        this.emit({},);
        // Errors surface through progress; `stop()` awaits the drain itself.
        void this.kick().catch(() => {},);
    }

    private kick(): Promise<void> {
        this.draining ??= this.drain().finally(() => { this.draining = null; },);
        return this.draining;
    }

    private async drain(): Promise<void> {
        const rec = this.rec!;
        while (this.queue.length && !this.aborted) {
            const part = this.queue[0];
            await putPartWithRetry(this.postId, rec.id, part.n, part.blob, {
                maxAttempts: () => (this.finalizing ? FINAL_ATTEMPTS : Number.POSITIVE_INFINITY),
                cancelled: () => this.aborted,
                onError: (message,) => this.emit({ error: message, },),
            },);
            this.queue.shift();
            this.emit({
                uploadedBytes: this.progress.uploadedBytes + part.blob.size,
                uploadedParts: this.progress.uploadedParts + 1,
                error: null,
            },);
            await this.saveMeta(part.end,);
            void recordingStore.dropUploaded(rec.id, part.end,);
        }
    }

    pause(): void {
        if (this.mr?.state === 'recording') {
            this.mr.pause();
            this.emit({ state: 'paused', },);
        }
    }

    resume(): void {
        if (this.mr?.state === 'paused') {
            this.mr.resume();
            this.emit({ state: 'recording', },);
        }
    }

    async stop(): Promise<LiveRecording | null> {
        const rec = this.rec;
        if (!rec || this.aborted) return null;
        if (this.progress.state === 'completed') return rec;
        this.finalizing = true;
        this.emit({ state: 'finalizing', error: null, },);
        try {
            if (this.mr && this.mr.state !== 'inactive') {
                this.mr.stop();
                await this.recorderStopped;
            }
            this.mr = null;
            const last = this.slicer?.flush();
            if (last) {
                this.cut += last.size;
                this.queue.push({ n: this.nextPart++, blob: last, end: this.cut, },);
            }
            // A drain started while live retries forever; wait for it, then
            // drain again under the finalising attempt limit.
            while (this.queue.length) await this.kick();

            if (!this.progress.uploadedParts) {
                await this.abort();
                return null;
            }
            const done = await cms.posts.liveRecording.complete(this.postId, rec.id,);
            this.rec = done;
            await recordingStore.clear(rec.id,);
            this.emit({ state: 'completed', error: null, },);
            return done;
        } catch (err) {
            this.emit({ state: 'error', error: (err as Error).message || 'Could not finish the recording.', },);
            throw err;
        }
    }

    async abort(): Promise<void> {
        this.aborted = true;
        try {
            if (this.mr && this.mr.state !== 'inactive') this.mr.stop();
        } catch {
            // already stopped
        }
        this.mr = null;
        this.queue = [];
        this.slicer?.flush();
        const rec = this.rec;
        if (rec) {
            await cms.posts.liveRecording.abort(this.postId, rec.id,).catch(() => {},);
            await recordingStore.clear(rec.id,);
        }
        this.emit({ state: 'aborted', },);
    }
}

/**
 * Finish a recording left open by a previous page (crash / reload): upload
 * whatever this browser still holds FOR THAT recording id (bytes of the same
 * MediaRecorder session — nothing else is ever appended), then complete.
 * Works from any browser — one without the local copy completes what the
 * server has. Nothing uploaded at all → the recording is discarded instead.
 */
export async function finishStoredRecording(postId: string, rec: LiveRecording,): Promise<LiveRecording> {
    const leftover = await recordingStore.loadLeftover(rec.id,);
    if (leftover?.blob.size) {
        const skip = leftoverSkip(rec.uploadedParts, leftover.meta.lastPart, rec.partSize,);
        const rest = leftover.blob.slice(Math.min(skip, leftover.blob.size,),);
        const slicer = new PartSlicer(rec.partSize,);
        const parts = rest.size ? [...slicer.push(rest,),] : [];
        const tail = slicer.flush();
        if (tail) parts.push(tail,);
        let n = nextPartNumber(rec.uploadedParts,);
        let through = leftover.meta.uploadedThrough + skip;
        for (const part of parts) {
            await putPartWithRetry(postId, rec.id, n, part, { maxAttempts: FINAL_ATTEMPTS, },);
            through += part.size;
            // Bookkeeping per part, so a failed finish retries only the rest.
            await recordingStore.saveMeta({ ...leftover.meta, lastPart: n, uploadedThrough: through, updatedAt: Date.now(), },);
            n++;
        }
    }
    const fresh = await cms.posts.liveRecording.get(postId,);
    if (fresh && fresh.id === rec.id && !fresh.uploadedParts.length) {
        await discardStoredRecording(postId, rec.id,);
        return { ...fresh, status: 'aborted', };
    }
    const done = await cms.posts.liveRecording.complete(postId, rec.id,);
    await recordingStore.clear(rec.id,);
    return done;
}

/** Discard an open recording (server + local copy). */
export async function discardStoredRecording(postId: string, recordingId: string,): Promise<void> {
    await cms.posts.liveRecording.abort(postId, recordingId,);
    await recordingStore.clear(recordingId,);
}
