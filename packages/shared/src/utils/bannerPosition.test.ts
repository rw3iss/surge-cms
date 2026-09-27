import { describe, expect, it, } from 'vitest';
import { isValidBannerPositionCustom, resolveBannerHeight, resolveBannerPosition, } from './bannerPosition';

describe('resolveBannerPosition', () => {
    it('maps the presets', () => {
        expect(resolveBannerPosition('start',),).toBe('center top',);
        expect(resolveBannerPosition('end',),).toBe('center bottom',);
        expect(resolveBannerPosition(undefined,),).toBe('center center',);
    });
    it('uses a valid custom value', () => {
        expect(resolveBannerPosition('custom', ' center 30% ',),).toBe('center 30%',);
        expect(resolveBannerPosition('custom', 'left calc(50% - 20px)',),).toBe('left calc(50% - 20px)',);
    });
    it('falls back when custom is empty or unsafe', () => {
        expect(resolveBannerPosition('custom', '',),).toBe('center center',);
        expect(resolveBannerPosition('custom', 'top; color: red',),).toBe('center center',);
        expect(isValidBannerPositionCustom('url("x")',),).toBe(false,);
    });
});

describe('resolveBannerHeight', () => {
    it('accepts CSS heights', () => {
        expect(resolveBannerHeight('420px',),).toBe('420px',);
        expect(resolveBannerHeight(' clamp(240px, 40vw, 520px) ',),).toBe('clamp(240px, 40vw, 520px)',);
    },);
    it('ignores empty, keyword-only or unsafe values', () => {
        expect(resolveBannerHeight('',),).toBeUndefined();
        expect(resolveBannerHeight('auto',),).toBeUndefined();
        expect(resolveBannerHeight('10px; color:red',),).toBeUndefined();
    },);
},);
