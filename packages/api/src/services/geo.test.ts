import { describe, expect, it, vi, } from 'vitest';

// No Redis in unit tests: the cross-process gate always opens.
vi.mock('./cache', () => ({
    cache: { get: vi.fn(async () => null), set: vi.fn(async () => undefined), acquireGate: vi.fn(async () => true), },
    CACHE_KEYS: { geoSearch: (q: string,) => `geo:search:${q}`, geoReverse: (a: number, b: number,) => `geo:reverse:${a}:${b}`, geoGate: 'geo:gate', },
}),);

const { shortLabelOf, } = await import('./geo');

describe('shortLabelOf', () => {
    it('builds venue, street, city, region', () => {
        expect(shortLabelOf({
            name: 'Philadelphia City Hall', display_name: 'long',
            address: { house_number: '1400', road: 'John F Kennedy Blvd', city: 'Philadelphia', state: 'Pennsylvania', postcode: '19107', },
        },),).toBe('Philadelphia City Hall, 1400 John F Kennedy Blvd, Philadelphia, Pennsylvania 19107',);
    },);
    it('falls back to the display name with too little detail', () => {
        expect(shortLabelOf({ display_name: 'Atlantic Ocean', address: {}, },),).toBe('Atlantic Ocean',);
    },);
},);

describe('throttled', () => {
    it('runs calls one at a time, in order, and refuses a full queue', async () => {
        vi.useFakeTimers();
        try {
            const { throttled, MAX_QUEUED, } = await import('./geo');
            const order: number[] = [];
            let release!: () => void;
            const gate = new Promise<void>((r,) => { release = r; },);
            const calls = [throttled(async () => { await gate; order.push(0,); },),];
            for (let i = 1; i < MAX_QUEUED; i++) calls.push(throttled(async () => { order.push(i,); },),);
            await expect(throttled(async () => undefined,),).rejects.toMatchObject({ code: 'GEO_BUSY', },);
            release();
            await vi.runAllTimersAsync();
            await Promise.all(calls,);
            expect(order,).toEqual(Array.from({ length: MAX_QUEUED, }, (_, i,) => i,),);
            // The queue drained: a new call is accepted again.
            const again = throttled(async () => 'ok',);
            await vi.runAllTimersAsync();
            expect(await again,).toBe('ok',);
        } finally {
            vi.useRealTimers();
        }
    },);
},);
