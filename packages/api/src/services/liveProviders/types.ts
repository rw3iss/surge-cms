/**
 * Server-side live provider ADAPTER contract. A descriptor (registry.ts)
 * describes a provider's settings; an adapter makes it work. A descriptor is
 * `implemented` exactly when an adapter exists for its key (adapters.ts).
 *
 * Adapters are stateless: the provider resource id (e.g. a Cloudflare live
 * input uid) is passed in and handed back, and the caller (services/liveShows)
 * persists it in `posts.type_settings.providerInputId`.
 */
import type { LivePlaybackInfo, LivePublishInfo, } from '@sitesurge/types';

/** A provider's saved config (Settings → Posts → Live Show; secrets included). */
export type LiveProviderConfig = Record<string, unknown>;

/** What an adapter needs to know about the show. */
export interface LiveAdapterPost {
    id: string;
    title: string;
    /** The provider resource already created for this show, if any. */
    providerInputId?: string | null;
}

/** Playback info for a permitted viewer (`available: true` shape). */
export type LiveAdapterPlayback = Required<Pick<LivePlaybackInfo, 'provider' | 'kind' | 'url'>> &
    Pick<LivePlaybackInfo, 'token' | 'iceServers'>;

export interface LiveInputResult {
    /** Provider resource id — persist it (it may differ from the one passed in). */
    inputId: string;
    publish: LivePublishInfo;
    playback: LiveAdapterPlayback;
}

export interface LiveProviderAdapter {
    key: string;
    /** Required config present (cheap, no network). */
    isConfigured(cfg: LiveProviderConfig | undefined,): boolean;
    /** Create the show's provider resource the first time; reuse it after (re-created if it vanished). */
    ensureInput(post: LiveAdapterPost, cfg: LiveProviderConfig,): Promise<LiveInputResult>;
    /** Host ingest. Same as `ensureInput(...).publish`. */
    publishInfo(post: LiveAdapterPost, cfg: LiveProviderConfig,): Promise<LiveInputResult>;
    /** Viewer playback for an EXISTING input; null when the show has no input yet. Never creates one. */
    playbackInfo(post: LiveAdapterPost, cfg: LiveProviderConfig,): Promise<LiveAdapterPlayback | null>;
    /** Release the provider resource when the show ends (best-effort; may throw). */
    endInput(post: LiveAdapterPost, cfg: LiveProviderConfig,): Promise<void>;
    /** Settings → Test connection: a read-only call with the saved credentials. */
    testConnection(cfg: LiveProviderConfig,): Promise<{ ok: boolean; message: string; }>;
    /** Origins the BROWSER must reach (WHIP/WHEP) — added to CSP connect-src. */
    cspOrigins?(cfg: LiveProviderConfig,): string[];
}
