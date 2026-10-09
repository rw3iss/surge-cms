/**
 * A recorder of a live show for its replay. `browser` records the host's
 * camera stream on the host's own page and uploads it while live; `server`
 * means the provider/our server records — nothing to do in the browser.
 * Picked by config (`createRecorder`), so a server recorder can replace the
 * browser one without touching the console.
 */
import type { LiveRecording, LiveRecordingMethod, } from '@sitesurge/types';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'finalizing' | 'completed' | 'aborted' | 'error';

export interface RecorderProgress {
    state: RecorderState;
    recordingId: string | null;
    /** Bytes stored in object storage (all parts acknowledged). */
    uploadedBytes: number;
    /** Bytes recorded but not uploaded yet (buffer + queued parts). */
    pendingBytes: number;
    uploadedParts: number;
    /** Last upload / recorder error — uploads keep retrying while recording. */
    error: string | null;
}

export interface LiveRecorder {
    readonly method: LiveRecordingMethod;
    /** Start — or resume the post's open recording (continues its part numbers). */
    start(postId: string, stream: MediaStream,): Promise<void>;
    pause(): void;
    resume(): void;
    /**
     * Stop recording, upload the remainder as the final part and complete the
     * upload. Safe to call again after a failure (retries the finalisation).
     * Resolves null when nothing was recorded (or the method records nothing here).
     */
    stop(): Promise<LiveRecording | null>;
    /** Discard the recording (server multipart aborted, local buffer dropped). */
    abort(): Promise<void>;
    onProgress(cb: (p: RecorderProgress,) => void,): () => void;
}

export const EMPTY_PROGRESS: RecorderProgress = {
    state: 'idle', recordingId: null, uploadedBytes: 0, pendingBytes: 0, uploadedParts: 0, error: null,
};
