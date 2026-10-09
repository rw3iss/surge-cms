/**
 * Browser side of a live-stream provider: how the HOST's camera reaches the
 * provider (`LivePublisher`) and how a VIEWER's <video> plays it back
 * (`LiveViewer`). The server hands out the endpoints (`cms.posts.livePublish`
 * / `livePlayback`); these classes only speak the wire protocol (WHIP/WHEP).
 */
import type { LivePlaybackInfo, LivePublishInfo, } from '@sitesurge/types';

export type LiveConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'failed' | 'closed';

export interface LivePublisher {
    start(stream: MediaStream, info: LivePublishInfo,): Promise<void>;
    /** Swap (or, with `null`, blank) the outgoing track without renegotiating. */
    replaceTrack?(kind: 'audio' | 'video', track: MediaStreamTrack | null,): Promise<void>;
    stop(): Promise<void>;
    /** Subscribe to connection state; returns the unsubscribe. */
    onState(cb: (state: LiveConnectionState, error?: string,) => void,): () => void;
    /** Outgoing bitrate in kbit/s since the previous call (null before the first sample). */
    getBitrate?(): Promise<number | null>;
}

export interface LiveViewer {
    start(info: LivePlaybackInfo, video: HTMLVideoElement,): Promise<void>;
    stop(): Promise<void>;
    onState(cb: (state: LiveConnectionState, error?: string,) => void,): () => void;
}
