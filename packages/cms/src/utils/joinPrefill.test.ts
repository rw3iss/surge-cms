import { beforeEach, describe, expect, it, vi, } from 'vitest';
import { saveJoinPrefill, takeJoinPrefill, } from './joinPrefill';

const store = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
    getItem: (k: string,) => store.get(k,) ?? null,
    setItem: (k: string, v: string,) => void store.set(k, v,),
    removeItem: (k: string,) => void store.delete(k,),
},);

describe('join prefill', () => {
    beforeEach(() => store.clear(),);
    it('hands the details over once', () => {
        saveJoinPrefill({ name: 'Ann', email: 'ann@x.com', phone: '555', },);
        expect(takeJoinPrefill(),).toEqual({ name: 'Ann', email: 'ann@x.com', phone: '555', },);
        expect(takeJoinPrefill(),).toBeNull();
    },);
    it('stores nothing when empty and expires', () => {
        saveJoinPrefill({},);
        expect(takeJoinPrefill(),).toBeNull();
        store.set('sitesurge.join.prefill', JSON.stringify({ email: 'a@b.c', at: Date.now() - 31 * 60_000, },),);
        expect(takeJoinPrefill(),).toBeNull();
    },);
},);
