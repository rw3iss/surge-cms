import { beforeEach, describe, expect, it, vi, } from 'vitest';
import { CacheManager, } from './cacheManager';
import { MemoryAdapter, } from './adapters/memory';

function mgr() { return new CacheManager({ adapter: new MemoryAdapter(), enabled: true, defaultTtl: 1000, },); }

describe('CacheManager.read (SWR)', () => {
    it('miss → calls fetcher, caches, returns value', async () => {
        const c = mgr();
        const fetcher = vi.fn().mockResolvedValue('V',);
        expect(await c.read('k', fetcher, {},),).toBe('V',);
        expect(fetcher,).toHaveBeenCalledOnce();
    },);
    it('fresh hit → returns cached WITHOUT calling fetcher', async () => {
        const c = mgr();
        const fetcher = vi.fn().mockResolvedValue('V',);
        await c.read('k', fetcher,);
        const fetcher2 = vi.fn().mockResolvedValue('V2',);
        expect(await c.read('k', fetcher2,),).toBe('V',);
        expect(fetcher2,).not.toHaveBeenCalled();
    },);
    it('stale hit → returns stale immediately AND revalidates in background, notifying subscribers', async () => {
        const c = new CacheManager({ adapter: new MemoryAdapter(), enabled: true, defaultTtl: 0, }); // instantly stale
        const sub = vi.fn();
        await c.read('k', vi.fn().mockResolvedValue('OLD',),);
        c.subscribe('k', sub,);
        const fresh = vi.fn().mockResolvedValue('NEW',);
        const returned = await c.read('k', fresh,);
        expect(returned,).toBe('OLD',); // stale-while-revalidate
        await new Promise((r,) => setTimeout(r, 10,),);
        expect(fresh,).toHaveBeenCalled();
        expect(sub,).toHaveBeenCalledWith('NEW',);
    },);
    it('cache:false bypasses read and write', async () => {
        const c = mgr();
        const f1 = vi.fn().mockResolvedValue('A',); await c.read('k', f1, { cache: false, },);
        const f2 = vi.fn().mockResolvedValue('B',);
        expect(await c.read('k', f2, { cache: false, },),).toBe('B',);
        expect(f2,).toHaveBeenCalled();
    },);
    it('invalidatePrefix drops keys and revalidates on next read', async () => {
        const c = mgr();
        await c.read('cms:posts:list:', vi.fn().mockResolvedValue('OLD',),);
        await c.invalidatePrefix('cms:posts:',);
        const f = vi.fn().mockResolvedValue('NEW',);
        expect(await c.read('cms:posts:list:', f,),).toBe('NEW',);
        expect(f,).toHaveBeenCalled();
    },);
    it('disabled manager always calls fetcher', async () => {
        const c = new CacheManager({ adapter: new MemoryAdapter(), enabled: false, defaultTtl: 1000, });
        const f = vi.fn().mockResolvedValue('X',);
        await c.read('k', f,); await c.read('k', f,);
        expect(f,).toHaveBeenCalledTimes(2,);
    },);
},);

describe('CacheManager.read — failing background revalidation', () => {
    /**
     * A stale entry whose refresh 404s must not produce an unhandled rejection.
     *
     * This is what filled the admin console with `Uncaught (in promise): Product
     * "<uuid>" not found`. The caller had already been handed the cached value
     * and returned, so its try/catch could never see the background promise —
     * the rejection escaped to the window with no call site able to catch it.
     */
    it('does not leak an unhandled rejection when the background refresh fails', async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (e: unknown,) => { unhandled.push(e,); };
        // Reached through globalThis: this package has no @types/node, and a
        // bare `process` reference fails the build even though the test runs.
        const proc = (globalThis as {
            process?: {
                on: (ev: string, cb: (e: unknown,) => void,) => void;
                off: (ev: string, cb: (e: unknown,) => void,) => void;
            };
        }).process;
        proc?.on('unhandledRejection', onUnhandled,);

        try {
            const c = new CacheManager({ adapter: new MemoryAdapter(), enabled: true, defaultTtl: 0, },);
            await c.read('k', vi.fn().mockResolvedValue('OLD',),);

            const failing = vi.fn().mockRejectedValue(new Error('Product "abc" not found',),);
            // The caller still gets the cached value rather than an error.
            await expect(c.read('k', failing,),).resolves.toBe('OLD',);

            // Give the rejection a chance to be reported if it were unguarded.
            await new Promise((r,) => setTimeout(r, 30,),);
            expect(failing,).toHaveBeenCalled();
            expect(unhandled,).toEqual([],);
        } finally {
            proc?.off('unhandledRejection', onUnhandled,);
        }
    },);

    it('keeps serving the stale value, and retries on the next read', async () => {
        const c = new CacheManager({ adapter: new MemoryAdapter(), enabled: true, defaultTtl: 0, },);
        await c.read('k', vi.fn().mockResolvedValue('OLD',),);

        const failing = vi.fn().mockRejectedValue(new Error('boom',),);
        expect(await c.read('k', failing,),).toBe('OLD',);
        await new Promise((r,) => setTimeout(r, 20,),);

        // A failed refresh must not poison the entry: once the record is back,
        // the next read picks it up.
        const ok = vi.fn().mockResolvedValue('NEW',);
        expect(await c.read('k', ok,),).toBe('OLD',);   // still SWR
        await new Promise((r,) => setTimeout(r, 20,),);
        expect(ok,).toHaveBeenCalled();
        expect(await c.read('k', vi.fn().mockResolvedValue('X',),),).toBe('NEW',);
    },);

    it('still rejects when there is NO cached value to fall back on', async () => {
        // Only the BACKGROUND path is swallowed. A cold read has nothing to
        // return, so the caller must still see the failure.
        const c = new CacheManager({ adapter: new MemoryAdapter(), enabled: true, defaultTtl: 1000, },);
        const failing = vi.fn().mockRejectedValue(new Error('Product "abc" not found',),);
        await expect(c.read('cold', failing,),).rejects.toThrow('not found',);
    },);
},);

describe('CacheManager staleness bound', () => {
    /** Adapter pre-loaded with one entry whose expiry is `agoMs` in the past. */
    function withAged(agoMs: number, value = 'OLD',) {
        const adapter = new MemoryAdapter();
        const now = Date.now();
        void adapter.set('k', { value, storedAt: now - agoMs - 1000, expiresAt: now - agoMs, },);
        return adapter;
    }

    it('blocks and returns FRESH once an entry is past the bound', async () => {
        // The bug: an entry that expired 22 hours ago was served indefinitely,
        // because read() returned any cached value and the caller never saw
        // the background refresh.
        const c = new CacheManager({
            adapter: withAged(22 * 3600_000,), enabled: true, defaultTtl: 1000, maxStaleMs: 300_000,
        },);
        const fresh = vi.fn().mockResolvedValue('NEW',);
        expect(await c.read('k', fresh,),).toBe('NEW',);
        expect(fresh,).toHaveBeenCalledOnce();
    },);

    it('still serves stale-while-revalidate INSIDE the bound', async () => {
        // The bound must not destroy SWR — a mildly stale entry should still
        // paint instantly and refresh behind.
        const c = new CacheManager({
            adapter: withAged(10_000,), enabled: true, defaultTtl: 1000, maxStaleMs: 300_000,
        },);
        const fresh = vi.fn().mockResolvedValue('NEW',);
        expect(await c.read('k', fresh,),).toBe('OLD',);
        await new Promise((r,) => setTimeout(r, 10,),);
        expect(fresh,).toHaveBeenCalled();
    },);

    it('falls back to the stale value when the blocking fetch fails', async () => {
        // Offline or a server blip: very old data beats an error, since the
        // caller had a usable value a moment ago.
        const c = new CacheManager({
            adapter: withAged(22 * 3600_000,), enabled: true, defaultTtl: 1000, maxStaleMs: 300_000,
        },);
        const failing = vi.fn().mockRejectedValue(new Error('offline',),);
        expect(await c.read('k', failing,),).toBe('OLD',);
        expect(failing,).toHaveBeenCalled();
    },);

    it('treats an entry with no expiresAt as too stale', async () => {
        const adapter = new MemoryAdapter();
        void adapter.set('k', { value: 'OLD', storedAt: Date.now(), } as never,);
        const c = new CacheManager({ adapter, enabled: true, defaultTtl: 1000, },);
        expect(await c.read('k', vi.fn().mockResolvedValue('NEW',),),).toBe('NEW',);
    },);

    it('keeps ttl:0 as pure SWR rather than always blocking', async () => {
        // ttl:0 means "serve instantly, always refresh behind". A bound
        // expressed as a MULTIPLE of the ttl would collapse to zero here and
        // silently turn that setting into "always block".
        const c = new CacheManager({ adapter: new MemoryAdapter(), enabled: true, defaultTtl: 0, },);
        await c.read('k', vi.fn().mockResolvedValue('OLD',),);
        expect(await c.read('k', vi.fn().mockResolvedValue('NEW',),),).toBe('OLD',);
    },);

    it('writes the refreshed value so the next read is fresh', async () => {
        const c = new CacheManager({
            adapter: withAged(22 * 3600_000,), enabled: true, defaultTtl: 60_000, maxStaleMs: 300_000,
        },);
        await c.read('k', vi.fn().mockResolvedValue('NEW',),);
        const second = vi.fn().mockResolvedValue('NEWER',);
        expect(await c.read('k', second,),).toBe('NEW',);
        expect(second,).not.toHaveBeenCalled();
    },);
},);

describe('CacheManager staleness bound — measured from expiry', () => {
    it('allows the full stale window regardless of how long the entry was fresh', async () => {
        // A long-lived entry (10min ttl) that expired only 10s ago is barely
        // stale and must still serve instantly. Measuring the bound from
        // `storedAt` instead of `expiresAt` would count the 10 minutes it
        // spent FRESH against the 5-minute stale allowance and block here —
        // pulling blocking fetches a whole TTL earlier than intended.
        const adapter = new MemoryAdapter();
        const now = Date.now();
        const ttl = 600_000;
        void adapter.set('k', { value: 'OLD', storedAt: now - ttl - 10_000, expiresAt: now - 10_000, },);
        const c = new CacheManager({ adapter, enabled: true, defaultTtl: ttl, maxStaleMs: 300_000, },);
        const fresh = vi.fn().mockResolvedValue('NEW',);
        expect(await c.read('k', fresh,),).toBe('OLD',);
    },);
},);
