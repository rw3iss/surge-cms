import { afterEach, beforeEach, describe, expect, it, vi, } from 'vitest';
import { getPublisher, getViewer, } from './index';
import { exchangeSdp, } from './webrtc';
import { WhepViewer, } from './whep';
import { WhipPublisher, } from './whip';

class FakeTrack {
    constructor(public kind: 'audio' | 'video',) {}
    getSettings() { return { height: 1080, }; }
}

class FakeStream {
    tracks: FakeTrack[];
    constructor(tracks: FakeTrack[] = [],) { this.tracks = tracks; }
    getVideoTracks() { return this.tracks.filter((t,) => t.kind === 'video'); }
    getAudioTracks() { return this.tracks.filter((t,) => t.kind === 'audio'); }
    getTracks() { return this.tracks; }
    addTrack(t: FakeTrack,) { this.tracks.push(t,); }
}

class FakePeer {
    static last: FakePeer | null = null;
    transceivers: { kindOrTrack: unknown; init: Record<string, unknown>; sender: { track: unknown; replaceTrack: (t: unknown,) => Promise<void>; }; receiver: { track: { kind: string; }; }; setCodecPreferences?: () => void; }[] = [];
    localDescription: { type: string; sdp: string; } | null = null;
    remoteDescription: { type: string; sdp: string; } | null = null;
    iceGatheringState = 'complete';
    connectionState = 'new';
    closed = false;
    private listeners: Record<string, ((e: unknown,) => void)[]> = {};
    constructor(public config: unknown,) { FakePeer.last = this; }
    addTransceiver(kindOrTrack: unknown, init: Record<string, unknown>,) {
        const kind = typeof kindOrTrack === 'string' ? kindOrTrack : (kindOrTrack as FakeTrack).kind;
        const sender = { track: typeof kindOrTrack === 'string' ? null : kindOrTrack, replaceTrack: async (t: unknown,) => { sender.track = t; }, };
        const tr = { kindOrTrack, init, sender, receiver: { track: { kind, }, }, };
        this.transceivers.push(tr,);
        return tr;
    }
    getTransceivers() { return this.transceivers; }
    addEventListener(type: string, fn: (e: unknown,) => void,) { (this.listeners[type] ??= []).push(fn,); }
    removeEventListener() {}
    fire(type: string, e?: unknown,) { for (const fn of this.listeners[type] ?? []) fn(e,); }
    async createOffer() { return { type: 'offer', sdp: 'v=0 offer', }; }
    async setLocalDescription(d: { type: string; sdp: string; },) { this.localDescription = d; }
    async setRemoteDescription(d: { type: string; sdp: string; },) { this.remoteDescription = d; }
    close() { this.closed = true; }
}

const fetchMock = vi.fn();

beforeEach(() => {
    vi.stubGlobal('RTCPeerConnection', FakePeer,);
    vi.stubGlobal('MediaStream', FakeStream,);
    vi.stubGlobal('fetch', fetchMock,);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_url: string, init: { method: string; },) =>
        init.method === 'DELETE'
            ? new Response(null, { status: 200, },)
            : new Response('v=0 answer', { status: 201, headers: { Location: '/whip/session/abc', 'Content-Type': 'application/sdp', }, },)
    );
},);

afterEach(() => {
    vi.unstubAllGlobals();
},);

describe('exchangeSdp', () => {
    it('POSTs application/sdp with the bearer token and resolves Location against the endpoint', async () => {
        const r = await exchangeSdp('https://live.example.com/abc/webRTC/publish', 'OFFER', 'tok',);
        const [url, init,] = fetchMock.mock.calls[0];
        expect(url,).toBe('https://live.example.com/abc/webRTC/publish',);
        expect(init.method,).toBe('POST',);
        expect(init.headers['Content-Type'],).toBe('application/sdp',);
        expect(init.headers.Authorization,).toBe('Bearer tok',);
        expect(init.body,).toBe('OFFER',);
        expect(r,).toEqual({ answer: 'v=0 answer', resourceUrl: 'https://live.example.com/whip/session/abc', },);
    });

    it('omits Authorization without a token and throws on an HTTP error', async () => {
        fetchMock.mockResolvedValueOnce(new Response('nope', { status: 403, },),);
        await expect(exchangeSdp('https://x.test/whip', 'O',),).rejects.toThrow(/HTTP 403/,);
        expect(fetchMock.mock.calls[0][1].headers.Authorization,).toBeUndefined();
    });
});

describe('WhipPublisher', () => {
    it('sends every camera track sendonly, applies the answer and DELETEs the session on stop', async () => {
        const pub = new WhipPublisher();
        const states: string[] = [];
        pub.onState((s,) => states.push(s,),);
        const stream = new FakeStream([new FakeTrack('video',), new FakeTrack('audio',),],);
        await pub.start(stream as unknown as MediaStream, { provider: 'cloudflare_stream', kind: 'whip', url: 'https://cf.test/in/publish', token: 't', },);

        const pc = FakePeer.last!;
        expect(pc.transceivers.map((t,) => t.init.direction),).toEqual(['sendonly', 'sendonly',],);
        expect((pc.transceivers[0].init.sendEncodings as { maxBitrate: number; }[])[0].maxBitrate,).toBe(6_000_000,);
        expect(pc.remoteDescription,).toEqual({ type: 'answer', sdp: 'v=0 answer', },);

        pc.connectionState = 'connected';
        pc.fire('connectionstatechange',);
        expect(states,).toContain('live',);

        await pub.replaceTrack('video', null,);
        expect(pc.transceivers[0].sender.track,).toBeNull();

        await pub.stop();
        expect(pc.closed,).toBe(true,);
        const del = fetchMock.mock.calls.find(([, init,],) => init.method === 'DELETE');
        expect(del?.[0],).toBe('https://cf.test/whip/session/abc',);
        expect(states.at(-1,),).toBe('closed',);
    });

    it('reports failure when the endpoint refuses', async () => {
        fetchMock.mockResolvedValueOnce(new Response('bad', { status: 401, },),);
        const pub = new WhipPublisher();
        await expect(pub.start(new FakeStream([new FakeTrack('video',),],) as unknown as MediaStream, { provider: 'x', kind: 'whip', url: 'https://cf.test/p', },),)
            .rejects.toThrow(/401/,);
    });
});

describe('WhepViewer', () => {
    it('offers recvonly video + audio and attaches incoming tracks to the <video>', async () => {
        const viewer = new WhepViewer();
        const video = { srcObject: null as unknown, play: vi.fn(async () => {},), } as unknown as HTMLVideoElement;
        await viewer.start({ available: true, kind: 'whep', provider: 'cloudflare_stream', url: 'https://cf.test/out/play', }, video,);

        const pc = FakePeer.last!;
        expect(pc.transceivers.map((t,) => [t.kindOrTrack, t.init.direction,]),).toEqual([['video', 'recvonly',], ['audio', 'recvonly',],],);
        expect(fetchMock.mock.calls[0][1].body,).toBe('v=0 offer',);
        expect(pc.remoteDescription?.sdp,).toBe('v=0 answer',);

        pc.fire('track', { track: new FakeTrack('video',), },);
        pc.fire('track', { track: new FakeTrack('audio',), },);
        expect((video.srcObject as unknown as FakeStream).tracks.length,).toBe(2,);

        await viewer.stop();
        expect(video.srcObject,).toBeNull();
        expect(fetchMock.mock.calls.some(([, init,],) => init.method === 'DELETE'),).toBe(true,);
    });

    it('rejects playback info that is not WHEP', async () => {
        const viewer = new WhepViewer();
        await expect(viewer.start({ available: true, kind: 'hls', url: 'x', }, {} as HTMLVideoElement,),).rejects.toThrow();
    });
});

describe('registry', () => {
    it('maps cloudflare_stream to WHIP/WHEP and unknown providers to null', () => {
        expect(getPublisher('cloudflare_stream',),).toBeInstanceOf(WhipPublisher,);
        expect(getViewer('cloudflare_stream',),).toBeInstanceOf(WhepViewer,);
        expect(getPublisher('nope',),).toBeNull();
        expect(getViewer(null,),).toBeNull();
    });
});
