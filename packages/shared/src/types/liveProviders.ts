/**
 * Live-stream PROVIDERS (100ms, Cloudflare, LiveKit, …) — who carries a Live
 * Show's video. The CMS never streams video itself: the host's webcam is
 * published to the provider and viewers watch from it; our own WebSocket room
 * carries chat, reactions and host commands.
 *
 * A provider is described once by a `LiveProviderDescriptor` (server
 * registry, `services/liveProviders/`); the admin settings form is generated
 * from its `fields`, so adding a provider needs no admin UI work.
 */

export type LiveProviderFieldType = 'text' | 'secret' | 'url' | 'select' | 'toggle';

export interface LiveProviderField {
    key: string;
    label: string;
    type: LiveProviderFieldType;
    required?: boolean;
    help?: string;
    placeholder?: string;
    options?: { value: string; label: string; }[];
    default?: string | boolean;
}

export interface LiveProviderCapabilities {
    /** Host publishes from the browser (WebRTC). */
    browserPublish: boolean;
    /** Sub-second WebRTC viewing. */
    webrtcViewing: boolean;
    /** HLS viewing for large audiences. */
    hlsViewing: boolean;
    /** Server-side recording. */
    recording: boolean;
    /** Recording can be written to our own S3/R2 bucket. */
    recordingToOwnBucket: boolean;
    /** Remote guests can join the stage. */
    guests: boolean;
}

export interface LiveProviderDescriptor {
    key: string;
    label: string;
    description: string;
    website: string;
    docsUrl?: string;
    /** Pricing summary shown under the select (from the provider research). */
    pricingNote?: string;
    capabilities: LiveProviderCapabilities;
    fields: LiveProviderField[];
    /** The SDK adapter is implemented (else: settings only, not usable yet). */
    implemented: boolean;
}

/** `posts_settings` keyed row. */
export interface PostsSettings {
    general: {
        /** Type the "New post" picker highlights / `/admin/posts/new` uses. */
        defaultPostType: string;
    };
    /** Per post type options (only types that declare some get a tab). */
    types: Record<string, Record<string, unknown>>;
    live: {
        /** Active provider key, or null = no provider (stage placeholder). */
        provider: string | null;
        /** Config per provider key (secrets masked on read). */
        providers: Record<string, Record<string, unknown>>;
    };
}

// ─── Runtime contract (server ↔ browser) ──────────────────────────────

/** POST /posts/:id/live/publish (host) — where the host's browser sends its stream. */
export interface LivePublishInfo {
    provider: string;
    /** `whip`: POST an SDP offer to `url` (WebRTC-HTTP Ingestion). */
    kind: 'whip';
    url: string;
    /** Bearer token for the WHIP endpoint, when the provider needs one. */
    token?: string | null;
    iceServers?: { urls: string | string[]; username?: string; credential?: string; }[];
}

/**
 * GET /posts/:id/live/playback (viewer) — how to watch the live stream now.
 * Only returned to viewers allowed to watch the post (subscription gate);
 * `available: false` with a reason otherwise (not live yet, no provider…).
 */
export interface LivePlaybackInfo {
    available: boolean;
    reason?: 'not_live' | 'no_provider' | 'not_configured' | 'ended' | 'forbidden';
    provider?: string;
    /** `whep`: WebRTC-HTTP Egress (sub-second); `hls`: an HLS URL. */
    kind?: 'whep' | 'hls';
    url?: string;
    token?: string | null;
    iceServers?: LivePublishInfo['iceServers'];
}

/** How a live show is recorded for replay. */
export type LiveRecordingMethod = 'browser' | 'server' | 'none';

export type LiveRecordingStatus = 'recording' | 'finalizing' | 'completed' | 'aborted' | 'failed';

/**
 * A browser recording of a live show (method `browser`): the host page records
 * the camera stream with MediaRecorder and uploads it in equal-size parts to
 * object storage while live (S3/R2 multipart — every part but the last must be
 * `partSize` bytes). Completing it creates a video media item that the video
 * pipeline encodes into the replay.
 */
export interface LiveRecording {
    id: string;
    postId: string;
    status: LiveRecordingStatus;
    mimeType: string;
    partSize: number;
    /** Part numbers already stored (resume after a reload/crash). */
    uploadedParts: number[];
    uploadedBytes: number;
    mediaId: string | null;
    error: string | null;
    createdAt: string;
    updatedAt: string;
}

/** `type_settings` keys a live post gains at runtime (besides LivePostSettings). */
export interface LiveRuntimeSettings {
    /** Provider resource (e.g. Cloudflare live input uid) — server use. */
    providerInputId?: string | null;
    /** The replay: media id of the encoded recording. */
    recordingMediaId?: string | null;
}
