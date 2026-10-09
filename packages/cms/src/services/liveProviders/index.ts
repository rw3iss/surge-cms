/**
 * Registry: provider key (`PostsSettings.live.provider`) → the browser-side
 * publisher / viewer that speaks its protocol. A provider without an entry
 * (not implemented yet) returns null — callers show the placeholder stage.
 */
import type { LivePublisher, LiveViewer, } from './types';
import { WhepViewer, } from './whep';
import { WhipPublisher, } from './whip';

export type { LiveConnectionState, LivePublisher, LiveViewer, } from './types';

const PUBLISHERS: Record<string, () => LivePublisher> = {
    cloudflare_stream: () => new WhipPublisher(),
};

const VIEWERS: Record<string, () => LiveViewer> = {
    cloudflare_stream: () => new WhepViewer(),
};

export function getPublisher(provider: string | null | undefined,): LivePublisher | null {
    return provider && PUBLISHERS[provider] ? PUBLISHERS[provider]() : null;
}

export function getViewer(provider: string | null | undefined,): LiveViewer | null {
    return provider && VIEWERS[provider] ? VIEWERS[provider]() : null;
}

/** The browser can publish/play for this provider. */
export function hasBrowserClient(provider: string | null | undefined,): boolean {
    return !!provider && provider in PUBLISHERS;
}

/** A viewer exists for this provider's WebRTC playback. */
export function hasViewer(provider: string | null | undefined,): boolean {
    return !!provider && provider in VIEWERS;
}
