import { afterEach, beforeEach, describe, expect, it, vi, } from 'vitest';
import { _resetPlaybackCache, cloudflareStreamAdapter as cf, customerOrigin, describeCfError, } from './cloudflareStream';
import { LIVE_PROVIDERS, } from './registry';

const CFG = { accountId: 'acc1', apiToken: 'tok', customerSubdomain: 'customer-abc.cloudflarestream.com', };
const POST = { id: 'p1', title: 'My show', providerInputId: null as string | null, };
const INPUT = {
    uid: 'in1',
    webRTC: { url: 'https://customer-abc.cloudflarestream.com/SECRET/webRTC/publish', },
    webRTCPlayback: { url: 'https://customer-abc.cloudflarestream.com/in1/webRTC/play', },
};

const json = (status: number, body: unknown,) => new Response(JSON.stringify(body,), { status, headers: { 'Content-Type': 'application/json', }, },);
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock,);
    _resetPlaybackCache();
},);
afterEach(() => vi.unstubAllGlobals(),);

describe('cloudflare stream adapter', () => {
    it('is the only implemented provider (derived from the adapter list)', () => {
        expect(LIVE_PROVIDERS.filter((p,) => p.implemented).map((p,) => p.key),).toEqual(['cloudflare_stream',],);
        const f = LIVE_PROVIDERS.find((p,) => p.key === 'cloudflare_stream',)!.fields.map((x,) => x.key);
        expect(f,).toContain('recordingMethod',);
        expect(f,).not.toContain('recordingMode',);
    },);

    it('creates a live input the first time and extracts WHIP / WHEP urls', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { success: true, result: INPUT, },),);
        const r = await cf.ensureInput(POST, CFG,);
        expect(r.inputId,).toBe('in1',);
        expect(r.publish,).toMatchObject({ kind: 'whip', url: INPUT.webRTC.url, provider: 'cloudflare_stream', },);
        expect(r.playback,).toMatchObject({ kind: 'whep', url: INPUT.webRTCPlayback.url, },);
        const [url, init,] = fetchMock.mock.calls[0]!;
        expect(url,).toBe('https://api.cloudflare.com/client/v4/accounts/acc1/stream/live_inputs',);
        expect(init.method,).toBe('POST',);
        expect(init.headers.Authorization,).toBe('Bearer tok',);
        expect(JSON.parse(init.body,),).toEqual({ meta: { name: 'My show', postId: 'p1', }, recording: { mode: 'off', }, },);
    },);

    it('reuses an existing input, and re-creates one that vanished', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { success: true, result: INPUT, },),);
        expect((await cf.ensureInput({ ...POST, providerInputId: 'in1', }, CFG,)).inputId,).toBe('in1',);
        expect(fetchMock.mock.calls[0]![1].method,).toBe('GET',);

        fetchMock.mockResolvedValueOnce(json(404, { success: false, errors: [{ message: 'not found', },], },),);
        fetchMock.mockResolvedValueOnce(json(200, { success: true, result: { ...INPUT, uid: 'in2', }, },),);
        expect((await cf.ensureInput({ ...POST, providerInputId: 'gone', }, CFG,)).inputId,).toBe('in2',);
    },);

    it('maps auth / account errors to readable messages', async () => {
        fetchMock.mockResolvedValueOnce(json(403, { success: false, errors: [{ code: 10000, message: 'Authentication error', },], },),);
        await expect(cf.ensureInput(POST, CFG,),).rejects.toThrow(/Stream:Edit/,);
        fetchMock.mockResolvedValueOnce(json(404, { success: false, errors: [], },),);
        await expect(cf.ensureInput(POST, CFG,),).rejects.toThrow(/Account ID/,);
        expect(describeCfError(500, null,),).toMatch(/error 500/,);
    },);

    it('playback never creates an input and memoises the WHEP url', async () => {
        expect(await cf.playbackInfo(POST, CFG,),).toBeNull();
        expect(fetchMock,).not.toHaveBeenCalled();
        fetchMock.mockResolvedValueOnce(json(200, { success: true, result: INPUT, },),);
        const a = await cf.playbackInfo({ ...POST, providerInputId: 'in1', }, CFG,);
        const b = await cf.playbackInfo({ ...POST, providerInputId: 'in1', }, CFG,);
        expect(a?.url,).toBe(INPUT.webRTCPlayback.url,);
        expect(b,).toEqual(a,);
        expect(fetchMock,).toHaveBeenCalledTimes(1,);
    },);

    it('testConnection lists inputs and reports failures without throwing', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { success: true, result: [INPUT,], },),);
        expect(await cf.testConnection(CFG,),).toMatchObject({ ok: true, },);
        fetchMock.mockResolvedValueOnce(json(401, { success: false, errors: [], },),);
        const r = await cf.testConnection(CFG,);
        expect(r.ok,).toBe(false,);
        expect(r.message,).toMatch(/Stream:Edit/,);
    },);

    it('endInput deletes the input; a missing one is fine', async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 200, },),);
        await cf.endInput({ ...POST, providerInputId: 'in1', }, CFG,);
        expect(fetchMock.mock.calls[0]![1].method,).toBe('DELETE',);
        fetchMock.mockResolvedValueOnce(json(404, {},),);
        await expect(cf.endInput({ ...POST, providerInputId: 'in1', }, CFG,),).resolves.toBeUndefined();
    },);

    it('normalises the customer subdomain to a CSP origin', () => {
        expect(customerOrigin('customer-abc',),).toBe('https://customer-abc.cloudflarestream.com',);
        expect(customerOrigin('https://customer-abc.cloudflarestream.com/x',),).toBe('https://customer-abc.cloudflarestream.com',);
        expect(customerOrigin('',),).toBeNull();
        expect(cf.cspOrigins!(CFG,),).toEqual(['https://customer-abc.cloudflarestream.com',],);
    },);
},);
