import { describe, expect, it, vi, } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('./cache', () => ({
    cache: { get: vi.fn(async (k: string,) => store.get(k,) ?? null), set: vi.fn(async (k: string, v: unknown,) => { store.set(k, v,); },), acquireGate: vi.fn(async () => true), },
    CACHE_KEYS: { geoSearch: (q: string,) => `geo:search:${q}`, geoReverse: (a: number, b: number,) => `geo:reverse:${a}:${b}`, geoGate: 'geo:gate', },
}),);
vi.mock('./notifications', () => ({ siteBaseUrl: async () => 'https://example.test', }),);
const { reverse, search, } = await import('./geo');

describe('geo lookups', () => {
    it('a cached reverse lookup keeps the CALLER\'s point, not the one it was stored for', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ lat: '39.9526', lon: '-75.1652', display_name: 'City Hall', },),),);
        vi.stubGlobal('fetch', fetchMock,);
        const first = await reverse(39.9526001, -75.1652001,);
        const second = await reverse(39.9526004, -75.1652004,);
        expect(fetchMock,).toHaveBeenCalledTimes(1,);
        expect(first,).toMatchObject({ lat: 39.9526001, lng: -75.1652001, },);
        expect(second,).toMatchObject({ lat: 39.9526004, lng: -75.1652004, label: 'City Hall', },);
        vi.unstubAllGlobals();
    },);
    it('identical searches in flight share one upstream call', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ lat: '1', lon: '2', display_name: 'X', },],),),);
        vi.stubGlobal('fetch', fetchMock,);
        const [a, b,] = await Promise.all([search('Somewhere Street',), search('somewhere  street',),],);
        expect(fetchMock,).toHaveBeenCalledTimes(1,);
        expect(a,).toEqual(b,);
        vi.unstubAllGlobals();
    },);
    it('bad JSON from upstream is GEO_UNAVAILABLE, not a 500', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>',),),);
        await expect(search('Another Place',),).rejects.toMatchObject({ code: 'GEO_UNAVAILABLE', },);
        vi.unstubAllGlobals();
    },);
},);
