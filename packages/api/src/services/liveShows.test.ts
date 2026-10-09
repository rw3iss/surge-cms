import { beforeEach, describe, expect, it, vi, } from 'vitest';

const m = vi.hoisted(() => ({
    row: null as Record<string, unknown> | null,
    access: 'ok' as string,
    settings: {
        live: {
            provider: 'cloudflare_stream' as string | null,
            providers: { cloudflare_stream: { accountId: 'a', apiToken: 't', customerSubdomain: 'customer-x', }, } as Record<string, Record<string, unknown>>,
        },
    },
    playbackInfo: vi.fn(),
    publishInfo: vi.fn(),
    dbQuery: vi.fn(),
    setCsp: vi.fn(),
}),);

vi.mock('./liveRooms/state', () => ({
    loadLivePost: () => Promise.resolve(m.row,),
    isLivePost: () => true,
    effectiveStatus: (r: { liveEndedAt?: unknown; liveStatus?: string; },) => (r.liveEndedAt ? 'ended' : r.liveStatus ?? 'idle'),
}),);
vi.mock('./liveRooms/access', () => ({ viewAccess: () => Promise.resolve(m.access,), }),);
vi.mock('./postSettings', () => ({ getPostsSettings: () => Promise.resolve(m.settings,), }),);
vi.mock('./cache', () => ({ cache: { invalidatePostCache: vi.fn(), }, }),);
vi.mock('../db', () => ({ query: m.dbQuery, }),);
vi.mock('../middleware/csp.js', () => ({ setLiveProviderCspOrigins: m.setCsp, }),);
vi.mock('./liveProviders', async () => {
    const real = await vi.importActual<typeof import('./liveProviders/registry')>('./liveProviders/registry',);
    const adapter = {
        key: 'cloudflare_stream',
        isConfigured: (c: Record<string, unknown>,) => !!c.accountId,
        publishInfo: m.publishInfo,
        playbackInfo: m.playbackInfo,
        cspOrigins: () => ['https://customer-x.cloudflarestream.com',],
    };
    return { getLiveProvider: real.getLiveProvider, getAdapter: (k: string,) => (k === 'cloudflare_stream' ? adapter : undefined), };
},);

import { playback, publish, } from './liveShows';

const POST = '11111111-1111-4111-8111-111111111111';
const WHEP = { provider: 'cloudflare_stream', kind: 'whep', url: 'https://customer-x.cloudflarestream.com/in1/webRTC/play', token: null, };

beforeEach(() => {
    vi.clearAllMocks();
    m.access = 'ok';
    m.row = { id: POST, title: 'Show', liveStatus: 'live', liveEndedAt: null, typeSettings: { providerInputId: 'in1', }, };
    m.settings.live.provider = 'cloudflare_stream';
    m.playbackInfo.mockResolvedValue(WHEP,);
},);

describe('playback gating', () => {
    it('returns WHEP info to a permitted viewer while live or paused', async () => {
        expect(await playback(POST, null,),).toEqual({ available: true, ...WHEP, },);
        m.row!.liveStatus = 'paused';
        expect((await playback(POST, null,)).available,).toBe(true,);
        expect(m.setCsp,).toHaveBeenCalledWith(expect.arrayContaining(['https://customer-x.cloudflarestream.com',],),);
    },);

    it('locked viewers get reason forbidden and no URL', async () => {
        m.access = 'forbidden';
        expect(await playback(POST, null,),).toEqual({ available: false, reason: 'forbidden', },);
        m.access = 'unauthorized';
        expect(await playback(POST, null,),).toEqual({ available: false, reason: 'forbidden', },);
        expect(m.playbackInfo,).not.toHaveBeenCalled();
    },);

    it('reports not_live / ended / no_provider / not_configured', async () => {
        m.row!.liveStatus = 'idle';
        expect((await playback(POST, null,)).reason,).toBe('not_live',);
        m.row!.liveStatus = 'live';
        m.row!.liveEndedAt = new Date();
        expect((await playback(POST, null,)).reason,).toBe('ended',);
        m.row!.liveEndedAt = null;
        m.settings.live.provider = null;
        expect((await playback(POST, null,)).reason,).toBe('no_provider',);
        m.settings.live.provider = 'livekit';
        expect((await playback(POST, null,)).reason,).toBe('not_configured',);
        m.settings.live.provider = 'cloudflare_stream';
        m.playbackInfo.mockResolvedValueOnce(null,);
        expect((await playback(POST, null,)).reason,).toBe('not_live',);
    },);

    it('404s a show the viewer may not see at all', async () => {
        m.access = 'not_found';
        await expect(playback(POST, null,),).rejects.toThrow(/not found/,);
    },);
},);

describe('publish', () => {
    it('persists a newly created input id and returns the WHIP info', async () => {
        m.row!.typeSettings = {};
        m.publishInfo.mockResolvedValue({
            inputId: 'in9',
            publish: { provider: 'cloudflare_stream', kind: 'whip', url: 'https://customer-x.cloudflarestream.com/S/webRTC/publish', },
            playback: WHEP,
        },);
        const r = await publish(POST,);
        expect(r.kind,).toBe('whip',);
        expect(m.dbQuery,).toHaveBeenCalledWith(expect.stringContaining('UPDATE posts',), [POST, JSON.stringify({ providerInputId: 'in9', },),],);
    },);

    it('refuses an ended show and a missing provider', async () => {
        m.row!.liveEndedAt = new Date();
        await expect(publish(POST,),).rejects.toThrow(/ended/,);
        m.row!.liveEndedAt = null;
        m.settings.live.provider = null;
        await expect(publish(POST,),).rejects.toThrow(/No live provider/,);
    },);
},);
