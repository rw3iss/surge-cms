import { describe, expect, it, } from 'vitest';
import { createPendingLookups, } from './pendingLookups';

const later = <T,>(v: T, ms: number, fail = false,) => new Promise<T>((res, rej,) => setTimeout(() => (fail ? rej(new Error('x',),) : res(v,)), ms,),);

describe('createPendingLookups', () => {
    it('settles at once with nothing running', async () => {
        const t = createPendingLookups();
        await t.settled();
        expect(t.count(),).toBe(0,);
    },);
    it('waits for running lookups, failed ones included, and reports the count', async () => {
        const counts: number[] = [];
        const t = createPendingLookups((n,) => counts.push(n,),);
        let done = false;
        void t.track(later(1, 20,),).then(() => { done = true; },);
        void t.track(later(1, 10, true,),).catch(() => {},);
        expect(t.count(),).toBe(2,);
        await t.settled();
        expect(done,).toBe(true,);
        expect(t.count(),).toBe(0,);
        expect(counts.at(-1,),).toBe(0,);
    },);
    it('also waits for a lookup started while waiting', async () => {
        const t = createPendingLookups();
        let second = false;
        void t.track(later(1, 10,),).then(() => { void t.track(later(1, 10,),).then(() => { second = true; },); },);
        await t.settled();
        expect(second,).toBe(true,);
    },);
    it('gives up after maxMs', async () => {
        const t = createPendingLookups();
        void t.track(new Promise(() => {},),);
        const start = Date.now();
        await t.settled(30,);
        expect(Date.now() - start,).toBeLessThan(500,);
        expect(t.count(),).toBe(1,);
    },);
},);
