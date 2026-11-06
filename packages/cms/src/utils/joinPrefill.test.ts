import { beforeEach, describe, expect, it, vi, } from 'vitest';
import { saveJoinPrefill, takeJoinPrefill, } from './joinPrefill';

const store = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
    getItem: (k: string,) => store.get(k,) ?? null,
    setItem: (k: string, v: string,) => { store.set(k, v,); },
    removeItem: (k: string,) => { store.delete(k,); },
},);

describe('joinPrefill', () => {
    beforeEach(() => { store.clear(); vi.useRealTimers(); },);

    it('is taken once', () => {
        saveJoinPrefill({ name: 'Ann', email: 'ann@x.com', },);
        expect(takeJoinPrefill(),).toEqual({ name: 'Ann', email: 'ann@x.com', phone: null, },);
        expect(takeJoinPrefill(),).toBeNull();
    },);
    it('expires after 30 minutes', () => {
        vi.useFakeTimers();
        saveJoinPrefill({ email: 'ann@x.com', },);
        vi.advanceTimersByTime(31 * 60_000,);
        expect(takeJoinPrefill(),).toBeNull();
    },);
    it('an empty hand-off clears an older one', () => {
        saveJoinPrefill({ email: 'old@x.com', },);
        saveJoinPrefill({},);
        expect(takeJoinPrefill(),).toBeNull();
    },);
    it('ignores non-string values from storage', () => {
        store.set('sitesurge.join.prefill', JSON.stringify({ name: { x: 1, }, email: 'a@x.com', at: Date.now(), },),);
        expect(takeJoinPrefill(),).toEqual({ name: null, email: 'a@x.com', phone: null, },);
    },);
},);
