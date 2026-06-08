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
