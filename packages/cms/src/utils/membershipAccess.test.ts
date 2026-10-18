import { afterEach, beforeEach, describe, expect, it, vi, } from 'vitest';
import { isOpenPath, } from './membershipAccess';
import { rememberChoice, takeChoice, } from './membershipChoice';

describe('isOpenPath', () => {
    it('opens account routes and their sub-paths, with or without a trailing slash', () => {
        expect(isOpenPath('/subscribe', [],),).toBe(true,);
        expect(isOpenPath('/profile/', [],),).toBe(true,);
        expect(isOpenPath('/profile/settings', [],),).toBe(true,);
        expect(isOpenPath('/invite/abc', [],),).toBe(true,);
        expect(isOpenPath('/u/token', [],),).toBe(true,);
    },);
    it('walls everything else unless the page is marked open', () => {
        expect(isOpenPath('/posts', [],),).toBe(false,);
        expect(isOpenPath('/subscriber-news', [],),).toBe(false,); // not a /subscribe sub-path
        expect(isOpenPath('/about/', ['/about',],),).toBe(true,);
        expect(isOpenPath('/', [],),).toBe(false,);
    },);
},);

describe('takeChoice', () => {
    const store = new Map<string, string>();
    beforeEach(() => {
        store.clear();
        vi.stubGlobal('localStorage', {
            getItem: (k: string,) => store.get(k,) ?? null,
            setItem: (k: string, v: string,) => void store.set(k, v,),
            removeItem: (k: string,) => void store.delete(k,),
        },);
    },);
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); },);

    it('returns the choice once, then forgets it', () => {
        rememberChoice({ tier: 't1', price: 'p1', apply: true, },);
        expect(takeChoice(),).toEqual({ tier: 't1', price: 'p1', apply: true, },);
        expect(takeChoice(),).toBeNull();
    },);
    it('expires after a day', () => {
        vi.useFakeTimers();
        rememberChoice({ tier: 't1', },);
        vi.advanceTimersByTime(25 * 60 * 60 * 1000,);
        expect(takeChoice(),).toBeNull();
    },);
},);
