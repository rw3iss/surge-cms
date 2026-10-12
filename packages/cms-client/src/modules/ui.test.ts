import { afterEach, describe, expect, it, vi, } from 'vitest';
import { UiSettingsModule, } from './ui';

const core = { config: { namespace: 'cms', }, } as never;

function fakeStorage() {
    const m = new Map<string, string>();
    return {
        getItem: (k: string,) => m.get(k,) ?? null,
        setItem: (k: string, v: string,) => { m.set(k, v,); },
        removeItem: (k: string,) => { m.delete(k,); },
        dump: () => m,
    };
}

describe('cms.ui (browser-local UI settings)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('stores everything under one namespaced key', () => {
        const ls = fakeStorage();
        vi.stubGlobal('localStorage', ls,);
        const ui = new UiSettingsModule(core,);
        ui.set('banner', { dismissedAt: 1, },);
        ui.merge('banner', { signedUp: true, },);
        expect(ui.get('banner',),).toEqual({ dismissedAt: 1, signedUp: true, },);
        expect([...ls.dump().keys(),],).toEqual(['cms.uiSettings',],);
        ui.remove('banner',);
        expect(ui.get('banner', 'none',),).toBe('none',);
    },);

    it('falls back to memory when localStorage throws', () => {
        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked',); }, setItem: () => { throw new Error('blocked',); }, },);
        const ui = new UiSettingsModule(core,);
        ui.set('x', 1,);
        expect(ui.get('x',),).toBe(1,);
    },);
},);
