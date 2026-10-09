/**
 * WHIP publisher — sends the host's camera + microphone to a WebRTC-HTTP
 * Ingestion endpoint (Cloudflare Stream, LiveKit ingress, …).
 *
 * Non-trickle: gather ICE (complete or 2 s), POST the offer, apply the answer,
 * keep the `Location` resource and DELETE it on stop. A peer that FAILS — or
 * stays `disconnected` past a grace period — is rebuilt with backoff; the
 * outgoing tracks (incl. one blanked by `replaceTrack(kind, null)`) carry over.
 */
import type { LivePublishInfo, } from '@sitesurge/types';
import type { LiveConnectionState, LivePublisher, } from './types';
import {
    backoffMs, deleteResource, DISCONNECT_GRACE_MS, exchangeSdp, MAX_RECONNECTS, preferH264, stateEmitter,
    waitForIceGathering,
} from './webrtc';

/** Upper bound for the video encoder by camera height (the browser never upscales). */
export function maxVideoBitrate(height: number | undefined,): number {
    const h = height ?? 720;
    if (h >= 1440) return 9_000_000;
    if (h >= 1080) return 6_000_000;
    if (h >= 720) return 3_500_000;
    return 1_500_000;
}

export class WhipPublisher implements LivePublisher {
    private pc: RTCPeerConnection | null = null;
    private stream: MediaStream | null = null;
    private info: LivePublishInfo | null = null;
    private resource: string | null = null;
    private stopped = true;
    private attempt = 0;
    private retryTimer: ReturnType<typeof setTimeout> | undefined;
    private graceTimer: ReturnType<typeof setTimeout> | undefined;
    /** Track overrides from `replaceTrack` (null = blanked), re-applied on reconnect. */
    private overrides = new Map<'audio' | 'video', MediaStreamTrack | null>();
    private lastBytes: { bytes: number; at: number; } | null = null;
    private readonly state = stateEmitter();

    onState(cb: (s: LiveConnectionState, e?: string,) => void,): () => void { return this.state.on(cb,); }

    async start(stream: MediaStream, info: LivePublishInfo,): Promise<void> {
        if (info.kind !== 'whip') throw new Error(`Unsupported publish kind: ${String(info.kind,)}`,);
        this.stream = stream;
        this.info = info;
        this.stopped = false;
        this.attempt = 0;
        this.overrides.clear();
        this.state.emit('connecting',);
        try {
            await this.connect();
        } catch (err) {
            this.state.emit('failed', (err as Error).message,);
            await this.teardownPeer();
            this.stopped = true;
            throw err;
        }
    }

    private trackFor(kind: 'audio' | 'video',): MediaStreamTrack | null {
        if (this.overrides.has(kind,)) return this.overrides.get(kind,) ?? null;
        const s = this.stream!;
        return (kind === 'video' ? s.getVideoTracks() : s.getAudioTracks())[0] ?? null;
    }

    private async connect(): Promise<void> {
        const info = this.info!;
        const stream = this.stream!;
        const pc = new RTCPeerConnection({ iceServers: info.iceServers ?? [], bundlePolicy: 'max-bundle', },);
        this.pc = pc;

        for (const kind of ['video', 'audio',] as const) {
            const source = (kind === 'video' ? stream.getVideoTracks() : stream.getAudioTracks())[0];
            if (!source) continue;
            const height = kind === 'video' ? source.getSettings?.().height : undefined;
            const tr = pc.addTransceiver(source, {
                direction: 'sendonly',
                streams: [stream,],
                sendEncodings: kind === 'video' ? [{ maxBitrate: maxVideoBitrate(height,), },] : undefined,
            },);
            if (kind === 'video') preferH264(tr,);
            const current = this.trackFor(kind,);
            if (current !== source) await tr.sender.replaceTrack(current,);
        }

        pc.addEventListener('connectionstatechange', () => this.onPeerState(pc,),);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer,);
        await waitForIceGathering(pc,);
        if (this.pc !== pc || this.stopped) return;
        const { answer, resourceUrl, } = await exchangeSdp(info.url, pc.localDescription?.sdp ?? offer.sdp ?? '', info.token,);
        if (this.pc !== pc || this.stopped) {
            void deleteResource(resourceUrl, info.token,);
            return;
        }
        this.resource = resourceUrl;
        await pc.setRemoteDescription({ type: 'answer', sdp: answer, },);
    }

    private onPeerState(pc: RTCPeerConnection,) {
        if (pc !== this.pc || this.stopped) return;
        clearTimeout(this.graceTimer,);
        switch (pc.connectionState) {
            case 'connected':
                this.attempt = 0;
                this.state.emit('live',);
                break;
            case 'disconnected':
                this.state.emit('reconnecting',);
                this.graceTimer = setTimeout(() => {
                    if (this.pc === pc && pc.connectionState !== 'connected') this.scheduleReconnect();
                }, DISCONNECT_GRACE_MS,);
                break;
            case 'failed':
                this.scheduleReconnect();
                break;
            default:
                break;
        }
    }

    private scheduleReconnect() {
        if (this.stopped) return;
        clearTimeout(this.retryTimer,);
        this.attempt++;
        if (this.attempt > MAX_RECONNECTS) {
            this.state.emit('failed', 'The connection to the stream provider was lost.',);
            void this.teardownPeer();
            return;
        }
        this.state.emit('reconnecting',);
        this.retryTimer = setTimeout(async () => {
            if (this.stopped) return;
            await this.teardownPeer();
            try {
                await this.connect();
            } catch {
                this.scheduleReconnect();
            }
        }, backoffMs(this.attempt,),);
    }

    async replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null,): Promise<void> {
        this.overrides.set(kind, track,);
        const tr = this.pc?.getTransceivers().find((t,) => t.receiver.track?.kind === kind || t.sender.track?.kind === kind);
        if (tr) await tr.sender.replaceTrack(track,);
    }

    async getBitrate(): Promise<number | null> {
        const pc = this.pc;
        if (!pc) return null;
        const stats = await pc.getStats();
        let bytes = 0;
        stats.forEach((r: RTCStats & { kind?: string; bytesSent?: number; },) => {
            if (r.type === 'outbound-rtp') bytes += r.bytesSent ?? 0;
        },);
        const now = performance.now();
        const prev = this.lastBytes;
        this.lastBytes = { bytes, at: now, };
        if (!prev || bytes < prev.bytes || now <= prev.at) return null;
        return Math.round(((bytes - prev.bytes) * 8) / (now - prev.at),); // bits/ms = kbit/s
    }

    private async teardownPeer() {
        const pc = this.pc;
        const resource = this.resource;
        this.pc = null;
        this.resource = null;
        this.lastBytes = null;
        pc?.close();
        await deleteResource(resource, this.info?.token,);
    }

    async stop(): Promise<void> {
        this.stopped = true;
        clearTimeout(this.retryTimer,);
        clearTimeout(this.graceTimer,);
        await this.teardownPeer();
        this.state.emit('closed',);
    }
}
