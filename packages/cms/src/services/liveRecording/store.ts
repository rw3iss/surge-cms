/**
 * IndexedDB backup of a browser recording's NOT-YET-UPLOADED bytes, so a
 * reload or crash mid-show loses at most what the recorder had not delivered
 * yet (one timeslice, ~2 s).
 *
 * Append-only: every recorder chunk is stored with its byte offset in the
 * session; once parts covering a range are uploaded, chunks wholly inside it
 * are deleted and `uploadedThrough` records the cut. On resume the leftover is
 * the stored chunks concatenated, minus the first `uploadedThrough - start`
 * bytes.
 *
 * Best effort by design: no IndexedDB (private mode, old engine, quota) means
 * every call quietly does nothing — the live upload itself is unaffected.
 */

export interface RecordingMeta {
    recordingId: string;
    postId: string;
    mimeType: string;
    partSize: number;
    /** Highest part number confirmed uploaded. */
    lastPart: number;
    /** Session byte offset up to which parts are uploaded. */
    uploadedThrough: number;
    updatedAt: number;
}

interface ChunkRow {
    recordingId: string;
    seq: number;
    start: number;
    blob: Blob;
}

const DB_NAME = 'sitesurge-live-recordings';
const META = 'meta';
const CHUNKS = 'chunks';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null,);
    dbPromise ??= new Promise((resolve,) => {
        try {
            const req = indexedDB.open(DB_NAME, 1,);
            req.addEventListener('upgradeneeded', () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(META,)) db.createObjectStore(META, { keyPath: 'recordingId', },);
                if (!db.objectStoreNames.contains(CHUNKS,)) db.createObjectStore(CHUNKS, { keyPath: ['recordingId', 'seq',], },);
            },);
            req.addEventListener('success', () => resolve(req.result,),);
            req.addEventListener('error', () => resolve(null,),);
            req.addEventListener('blocked', () => resolve(null,),);
        } catch {
            resolve(null,);
        }
    },);
    return dbPromise;
}

function done(tx: IDBTransaction,): Promise<void> {
    return new Promise((resolve, reject,) => {
        tx.addEventListener('complete', () => resolve(),);
        tx.addEventListener('error', () => reject(tx.error,),);
        tx.addEventListener('abort', () => reject(tx.error,),);
    },);
}

function request<T>(req: IDBRequest<T>,): Promise<T> {
    return new Promise((resolve, reject,) => {
        req.addEventListener('success', () => resolve(req.result,),);
        req.addEventListener('error', () => reject(req.error,),);
    },);
}

const chunkRange = (recordingId: string,) =>
    IDBKeyRange.bound([recordingId, -Infinity,], [recordingId, Infinity,],);

async function safely<T>(fn: (db: IDBDatabase,) => Promise<T>, fallback: T,): Promise<T> {
    try {
        const db = await openDb();
        return db ? await fn(db,) : fallback;
    } catch {
        return fallback;
    }
}

export const recordingStore = {
    saveMeta(meta: RecordingMeta,): Promise<void> {
        return safely(async (db,) => {
            const tx = db.transaction(META, 'readwrite',);
            tx.objectStore(META,).put(meta,);
            await done(tx,);
        }, undefined,);
    },

    putChunk(recordingId: string, seq: number, start: number, blob: Blob,): Promise<void> {
        return safely(async (db,) => {
            const tx = db.transaction(CHUNKS, 'readwrite',);
            tx.objectStore(CHUNKS,).put({ recordingId, seq, start, blob, } satisfies ChunkRow,);
            await done(tx,);
        }, undefined,);
    },

    /** Delete chunks that end at or before `offset` (fully uploaded). */
    dropUploaded(recordingId: string, offset: number,): Promise<void> {
        return safely(async (db,) => {
            const tx = db.transaction(CHUNKS, 'readwrite',);
            const store = tx.objectStore(CHUNKS,);
            const rows = await request(store.getAll(chunkRange(recordingId,),) as IDBRequest<ChunkRow[]>,);
            for (const r of rows) if (r.start + r.blob.size <= offset) store.delete([r.recordingId, r.seq,],);
            await done(tx,);
        }, undefined,);
    },

    /** The meta + the bytes not uploaded yet, or null when nothing is stored. */
    loadLeftover(recordingId: string,): Promise<{ meta: RecordingMeta; blob: Blob; } | null> {
        return safely(async (db,) => {
            const tx = db.transaction([META, CHUNKS,], 'readonly',);
            const meta = await request(tx.objectStore(META,).get(recordingId,) as IDBRequest<RecordingMeta | undefined>,);
            const rows = await request(tx.objectStore(CHUNKS,).getAll(chunkRange(recordingId,),) as IDBRequest<ChunkRow[]>,);
            if (!meta) return null;
            rows.sort((a, b,) => a.seq - b.seq);
            const all = new Blob(rows.map((r,) => r.blob), { type: meta.mimeType, },);
            const first = rows[0]?.start ?? meta.uploadedThrough;
            const skip = Math.max(0, meta.uploadedThrough - first,);
            return { meta, blob: all.slice(Math.min(skip, all.size,), all.size, meta.mimeType,), };
        }, null,);
    },

    clear(recordingId: string,): Promise<void> {
        return safely(async (db,) => {
            const tx = db.transaction([META, CHUNKS,], 'readwrite',);
            tx.objectStore(META,).delete(recordingId,);
            tx.objectStore(CHUNKS,).delete(chunkRange(recordingId,),);
            await done(tx,);
        }, undefined,);
    },
};
