/**
 * WHEP viewer — plays a WebRTC-HTTP Egress stream (sub-second latency) into a
 * <video>. recvonly video + audio transceivers, non-trickle offer, the answer
 * applied, incoming tracks gathered into ONE MediaStream on `video.srcObject`.
 * A failed peer is rebuilt with backoff; after too many tries it reports
 * `failed` so the page can ask the server for fresh playback info.
 */
import type { LivePlaybackInfo, } from '@sitesurge/types';
import type { LiveConnectionState, LiveViewer, } from './types';
import {
    backoffMs, deleteResource, DISCONNECT_GRACE_MS, exchangeSdp, MAX_RECONNECTS, stateEmitter, waitForIceGathering,
} from './webrtc';

export class WhepViewer implements LiveViewer {
    private pc: RTCPeerConnection | null = null;
    private info: LivePlaybackInfo | null = null;
    private video: HTMLVideoElement | null = null;
    private resource: string | null = null;
    private stopped = true;
    private attempt = 0;
    private retryTimer: ReturnType<typeof setTimeout> | undefined;
    private graceTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly state = stateEmitter();

    onState(cb: (s: LiveConnectionState, e?: string,) => void,): () => void { return this.state.on(cb,); }

    async start(info: LivePlaybackInfo, video: HTMLVideoElement,): Promise<void> {
        if (!info.available || info.kind !== 'whep' || !info.url) throw new Error('No WebRTC playback available.',);
        this.info = info;
        this.video = video;
        this.stopped = false;
        this.attempt = 0;
        this.state.emit('connecting',);
        try {
            await this.connect();
        } catch (err) {
            // A first-connect failure retries like a dropped peer.
            this.scheduleReconnect((err as Error).message,);
        }
    }

    private async connect(): Promise<void> {
        const info = this.info!;
        const pc = new RTCPeerConnection({ iceServers: info.iceServers ?? [], bundlePolicy: 'max-bundle', },);
        this.pc = pc;
        pc.addTransceiver('video', { direction: 'recvonly', },);
        pc.addTransceiver('audio', { direction: 'recvonly', },);

        const out = new MediaStream();
        pc.addEventListener('track', (e: RTCTrackEvent,) => {
            if (this.pc !== pc || !this.video) return;
            out.addTrack(e.track,);
            if (this.video.srcObject !== out) this.video.srcObject = out;
            void this.video.play().catch(() => {},);
        },);
        pc.addEventListener('connectionstatechange', () => this.onPeerState(pc,),);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer,);
        await waitForIceGathering(pc,);
        if (this.pc !== pc || this.stopped) return;
        const { answer, resourceUrl, } = await exchangeSdp(info.url!, pc.localDescription?.sdp ?? offer.sdp ?? '', info.token,);
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

    private scheduleReconnect(error?: string,) {
        if (this.stopped) return;
        clearTimeout(this.retryTimer,);
        this.attempt++;
        if (this.attempt > MAX_RECONNECTS) {
            this.state.emit('failed', error ?? 'The live stream connection was lost.',);
            void this.teardownPeer();
            return;
        }
        this.state.emit('reconnecting', error,);
        this.retryTimer = setTimeout(async () => {
            if (this.stopped) return;
            await this.teardownPeer();
            try {
                await this.connect();
            } catch (err) {
                this.scheduleReconnect((err as Error).message,);
            }
        }, backoffMs(this.attempt,),);
    }

    private async teardownPeer() {
        const pc = this.pc;
        const resource = this.resource;
        this.pc = null;
        this.resource = null;
        pc?.close();
        await deleteResource(resource, this.info?.token,);
    }

    async stop(): Promise<void> {
        this.stopped = true;
        clearTimeout(this.retryTimer,);
        clearTimeout(this.graceTimer,);
        await this.teardownPeer();
        if (this.video) this.video.srcObject = null;
        this.video = null;
        this.state.emit('closed',);
    }
}
