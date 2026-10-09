/**
 * Cuts a stream of recorder chunks (Blobs of any size) into upload parts of
 * EXACTLY `partSize` bytes — the S3/R2 multipart rule: every part but the
 * last must be the same size. The remainder (< partSize) stays buffered until
 * more data arrives or `flush()` takes it as the final part. Blob slicing is
 * lazy, so nothing is copied until a part is actually read for upload.
 */
export class PartSlicer {
    private chunks: Blob[] = [];
    private size = 0;

    constructor(readonly partSize: number, private readonly type = '',) {
        if (!Number.isFinite(partSize,) || partSize <= 0) throw new Error(`Invalid part size: ${partSize}`,);
    }

    /** Bytes buffered (not yet cut into a part). */
    get pendingBytes(): number { return this.size; }

    /** Add a chunk; returns every complete part it finished (possibly none). */
    push(chunk: Blob,): Blob[] {
        if (!chunk.size) return [];
        this.chunks.push(chunk,);
        this.size += chunk.size;
        if (this.size < this.partSize) return [];

        let buffer = new Blob(this.chunks, { type: this.type, },);
        const parts: Blob[] = [];
        while (buffer.size >= this.partSize) {
            parts.push(buffer.slice(0, this.partSize, this.type,),);
            buffer = buffer.slice(this.partSize, buffer.size, this.type,);
        }
        this.chunks = buffer.size ? [buffer,] : [];
        this.size = buffer.size;
        return parts;
    }

    /** Take what is left as the final part (null when empty). */
    flush(): Blob | null {
        if (!this.size) return null;
        const last = new Blob(this.chunks, { type: this.type, },);
        this.chunks = [];
        this.size = 0;
        return last;
    }
}
