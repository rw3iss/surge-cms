import { beforeEach, describe, expect, it, } from 'vitest';
import 'fake-indexeddb/auto';
import { MemoryAdapter, } from './memory';
import { IndexedDbAdapter, } from './indexeddb';
import type { CacheAdapter, CacheEntry, } from '../../types';

const entry = <T>(value: T,): CacheEntry<T> => ({ value, storedAt: 1, expiresAt: 2, });

function contract(name: string, make: () => CacheAdapter,) {
    describe(name, () => {
        let a: CacheAdapter;
        beforeEach(() => { a = make(); });
        it('set/get round-trips', async () => {
            await a.set('cms:posts:list:1', entry({ id: 'p', },),);
            expect((await a.get('cms:posts:list:1',))?.value,).toEqual({ id: 'p', },);
        },);
        it('get missing → null', async () => { expect(await a.get('nope',),).toBeNull(); },);
        it('delete removes one key', async () => {
            await a.set('k', entry(1,),); await a.delete('k',);
            expect(await a.get('k',),).toBeNull();
        },);
        it('deletePrefix removes matching keys only', async () => {
            await a.set('cms:posts:list:1', entry(1,),);
            await a.set('cms:posts:list:2', entry(2,),);
            await a.set('cms:users:list:1', entry(3,),);
            await a.deletePrefix('cms:posts:list:',);
            expect(await a.get('cms:posts:list:1',),).toBeNull();
            expect(await a.get('cms:posts:list:2',),).toBeNull();
            expect((await a.get('cms:users:list:1',))?.value,).toBe(3,);
        },);
    },);
}

contract('MemoryAdapter', () => new MemoryAdapter(),);
contract('IndexedDbAdapter', () => new IndexedDbAdapter('cms-cache-test',),);
