/**
 * Shared WHIP / WHEP plumbing (RFC 9725 / draft-ietf-wish-whep): one SDP
 * offer → answer exchange over HTTP, non-trickle (the offer carries every ICE
 * candidate gathered so far), plus the reconnect backoff both sides use.
 */
import type { LiveConnectionState, } from './types';

/** Wait for ICE gathering to finish, or `timeoutMs` — whichever comes first. */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2000,): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve,) => {
        const done = () => {
            clearTimeout(timer,);
            pc.removeEventListener('icegatheringstatechange', check,);
            resolve();
        };
        const check = () => { if (pc.iceGatheringState === 'complete') done(); };
        const timer = setTimeout(done, timeoutMs,);
        pc.addEventListener('icegatheringstatechange', check,);
    },);
}

export interface SdpExchangeResult {
    answer: string;
    /** Absolute URL of the session resource (`Location`), DELETEd on stop. */
    resourceUrl: string | null;
}

function authHeaders(token?: string | null,): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}`, } : {};
}

/** POST the offer as `application/sdp`; the answer comes back the same way. */
export async function exchangeSdp(url: string, offer: string, token?: string | null,): Promise<SdpExchangeResult> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp', ...authHeaders(token,), },
        body: offer,
    },);
    if (!res.ok) {
        const detail = await res.text().catch(() => '',);
        throw new Error(`Stream endpoint refused the connection (HTTP ${res.status}${detail ? `: ${detail.slice(0, 200,)}` : ''})`,);
    }
    const answer = await res.text();
    if (!answer.trim()) throw new Error('Stream endpoint returned an empty answer.',);
    const location = res.headers.get('Location',);
    let resourceUrl: string | null = null;
    if (location) {
        try {
            resourceUrl = new URL(location, url,).toString();
        } catch {
            resourceUrl = null;
        }
    }
    return { answer, resourceUrl, };
}

/** End the session on the server (best effort — the provider times it out anyway). */
export async function deleteResource(url: string | null, token?: string | null,): Promise<void> {
    if (!url) return;
    try {
        await fetch(url, { method: 'DELETE', headers: authHeaders(token,), keepalive: true, },);
    } catch {
        // Gone already / offline — nothing to do.
    }
}

/** 1 s, 2 s, 4 s … capped at 15 s. */
export function backoffMs(attempt: number,): number {
    return Math.min(15000, 1000 * 2 ** Math.max(0, attempt - 1,),);
}

/** Give up after this many reconnect attempts in a row. */
export const MAX_RECONNECTS = 10;
/** A `disconnected` peer often recovers on its own; wait this long first. */
export const DISCONNECT_GRACE_MS = 4000;

/** Listener set for `onState`. */
export function stateEmitter() {
    const subs = new Set<(s: LiveConnectionState, e?: string,) => void>();
    let current: LiveConnectionState = 'idle';
    return {
        get: () => current,
        emit(s: LiveConnectionState, e?: string,) {
            current = s;
            for (const fn of subs) fn(s, e,);
        },
        on(fn: (s: LiveConnectionState, e?: string,) => void,): () => void {
            subs.add(fn,);
            return () => subs.delete(fn,);
        },
    };
}

/**
 * Reorder a transceiver's codecs so H.264 comes first — the codec every viewer
 * (incl. Safari / iOS and Cloudflare's HLS fallback) can decode. No-op where
 * `setCodecPreferences` is unsupported.
 */
export function preferH264(transceiver: RTCRtpTransceiver,): void {
    try {
        const caps = typeof RTCRtpSender !== 'undefined' ? RTCRtpSender.getCapabilities?.('video',) : null;
        if (!caps?.codecs?.length || !transceiver.setCodecPreferences) return;
        const h264 = caps.codecs.filter((c,) => c.mimeType.toLowerCase() === 'video/h264');
        if (!h264.length) return;
        const rest = caps.codecs.filter((c,) => c.mimeType.toLowerCase() !== 'video/h264');
        transceiver.setCodecPreferences([...h264, ...rest,],);
    } catch {
        // Browser rejected the list — keep its default order.
    }
}
