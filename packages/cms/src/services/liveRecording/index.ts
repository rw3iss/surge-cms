/**
 * Recorder factory: the recording METHOD decides where a live show is
 * recorded. `browser` → `BrowserRecorder`; `server` (provider / our server
 * records) and `none` → a no-op, so the console code is the same either way.
 */
import type { LiveRecording, LiveRecordingMethod, } from '@sitesurge/types';
import { BrowserRecorder, } from './browserRecorder';
import type { LiveRecorder, RecorderProgress, } from './types';
import { EMPTY_PROGRESS, } from './types';

export { discardStoredRecording, finishStoredRecording, isOpenRecording, } from './browserRecorder';
export type { LiveRecorder, RecorderProgress, RecorderState, } from './types';
export { EMPTY_PROGRESS, } from './types';

class NoopRecorder implements LiveRecorder {
    constructor(readonly method: LiveRecordingMethod,) {}
    async start(): Promise<void> {}
    pause(): void {}
    resume(): void {}
    async stop(): Promise<LiveRecording | null> { return null; }
    async abort(): Promise<void> {}
    onProgress(cb: (p: RecorderProgress,) => void,): () => void {
        cb(EMPTY_PROGRESS,);
        return () => {};
    }
}

export function createRecorder(method: LiveRecordingMethod,): LiveRecorder {
    return method === 'browser' ? new BrowserRecorder() : new NoopRecorder(method,);
}
