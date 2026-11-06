import { describe, expect, it, } from 'vitest';
import { publicSettingsChanged, } from './pagePublicSettings';

const base = { slug: 'about', status: 'published', systemPage: null, openAccess: false, };

describe('publicSettingsChanged', () => {
    it('is true when the system page key changes', () => {
        expect(publicSettingsChanged(base, { ...base, systemPage: 'home', },),).toBe(true,);
        expect(publicSettingsChanged({ ...base, systemPage: 'home', }, base,),).toBe(true,);
    },);
    it('is true when open access flips', () => {
        expect(publicSettingsChanged(base, { ...base, openAccess: true, },),).toBe(true,);
    },);
    it('is true when a system / open page changes slug or status', () => {
        const home = { ...base, systemPage: 'home', };
        expect(publicSettingsChanged(home, { ...home, slug: 'start', },),).toBe(true,);
        expect(publicSettingsChanged(home, { ...home, status: 'draft', },),).toBe(true,);
        const open = { ...base, openAccess: true, };
        expect(publicSettingsChanged(open, { ...open, slug: 'x', },),).toBe(true,);
    },);
    it('is false for an ordinary page edit', () => {
        expect(publicSettingsChanged(base, { ...base, slug: 'x', status: 'draft', },),).toBe(false,);
        expect(publicSettingsChanged(null, { ...base, },),).toBe(false,);
    },);
    it('a brand-new system page counts', () => {
        expect(publicSettingsChanged(null, { ...base, systemPage: 'shop', },),).toBe(true,);
    },);
},);
