import { beforeEach, describe, expect, it, vi, } from 'vitest';

/** Minimal Redis double that runs the INCR-with-TTL script's semantics. */
const store = new Map<string, { n: number; ttl: number; }>();
let down = false;
const evalSpy = vi.fn(async (_script: string, _n: number, key: string, ttl: string,) => {
    if (down) throw new Error('down',);
    const e = store.get(key,) ?? { n: 0, ttl: -1, };
    e.n += 1;
    if (e.ttl < 0) e.ttl = Number(ttl,);
    store.set(key, e,);
    return e.n;
},);
vi.mock('../cache', () => ({ getRedis: () => ({ eval: evalSpy, }), }),);

import { allow, rateLimit, } from './spam';

describe('rate limit (S13)', () => {
    beforeEach(() => { store.clear(); down = false; evalSpy.mockClear(); },);

    it('uses ONE atomic script call per hit (no separate EXPIRE)', async () => {
        await allow('k', 3, 60,);
        expect(evalSpy,).toHaveBeenCalledTimes(1,);
        const script = evalSpy.mock.calls[0][0] as string;
        expect(script,).toContain('INCR',);
        expect(script,).toContain("'TTL'",);
        expect(script,).toContain('EXPIRE',);
    },);
    it('gives a key with no TTL one (heals a stuck counter)', async () => {
        store.set('discussions:rl:stuck', { n: 50, ttl: -1, },);
        await allow('stuck', 3, 60,);
        expect(store.get('discussions:rl:stuck',)!.ttl,).toBe(60,);
    },);
    it('throws past the limit and fails open when Redis is down', async () => {
        for (let i = 0; i < 3; i++) await rateLimit('x', 3, 60,);
        await expect(rateLimit('x', 3, 60,),).rejects.toThrow();
        down = true;
        await expect(rateLimit('x', 3, 60,),).resolves.toBeUndefined();
    },);
},);
