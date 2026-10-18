import { describe, expect, it, } from 'vitest';
import { findUnsafeBlockStyleKey, isSafeCssUrl, isSafeCssValue, } from './cssSafety';
import { isValidBannerHeight, isValidBannerPositionCustom, } from './bannerPosition';
import { blockCss, } from './blockResponsiveCss';

describe('isSafeCssValue', () => {
    it('accepts ordinary values', () => {
        for (const v of ['10px 0', 'calc(100% - 2rem)', 'var(--x)', '#fff', 'swatch:abc', 'clamp(1rem, 2vw, 3rem)',]) {
            expect(isSafeCssValue(v,), v,).toBe(true,);
        }
    });
    it('refuses anything that escapes or loads', () => {
        for (const v of ['1px;color:red', 'a}b', '</style>', '/* x', 'url(x)', 'URL (x)', 'expression(alert(1))', '@import "x"', '\\75 rl(x)', 'a\nb',]) {
            expect(isSafeCssValue(v,), v,).toBe(false,);
        }
    });
    it('quotes only with allowQuotes and only when balanced', () => {
        expect(isSafeCssValue('"Inter", sans-serif',),).toBe(false,);
        expect(isSafeCssValue('"Inter", sans-serif', { allowQuotes: true, },),).toBe(true,);
        expect(isSafeCssValue('"Inter, sans-serif', { allowQuotes: true, },),).toBe(false,);
    });
});

describe('isSafeCssUrl', () => {
    it('accepts URLs, refuses string escapes and script schemes', () => {
        expect(isSafeCssUrl('https://cdn.example.com/a b.jpg?x=1;y',),).toBe(true,);
        expect(isSafeCssUrl('/uploads/a.png',),).toBe(true,);
        expect(isSafeCssUrl('x");}body{display:none',),).toBe(false,);
        expect(isSafeCssUrl('javascript:alert(1)',),).toBe(false,);
    });
});

describe('banner validators use the shared rule', () => {
    it('refuses url( and expression( that the character whitelist allowed', () => {
        expect(isValidBannerPositionCustom('url(x)',),).toBe(false,);
        expect(isValidBannerHeight('expression(1)',),).toBe(false,);
        expect(isValidBannerHeight('420px',),).toBe(true,);
    });
});

describe('findUnsafeBlockStyleKey', () => {
    it('names the first unsafe key, base or breakpoint', () => {
        expect(findUnsafeBlockStyleKey({ padding: '10px', fontFamily: '"A", serif', },),).toBeNull();
        expect(findUnsafeBlockStyleKey({ padding: '10px;}', },),).toBe('padding',);
        expect(findUnsafeBlockStyleKey({ breakpoints: { mobile: { margin: '</style>', }, }, },),).toBe('breakpoints.mobile.margin',);
    });
    it('ignores non-CSS keys and customCss', () => {
        expect(findUnsafeBlockStyleKey({ name: 'a; b', customCss: 'p{color:red}', },),).toBeNull();
    });
});

describe('blockCss drops unsafe saved values', () => {
    it('never emits a value that would escape the declaration', () => {
        const css = blockCss('b1', { padding: '1px}</style><script>', margin: '4px', backgroundImage: 'x");}', }, [], { resolveColor: (v,) => v, resolveFont: (v,) => v, resolveHAlign: (v,) => v, },) ?? '';
        expect(css,).not.toContain('</style>',);
        expect(css,).not.toContain('x")',);
        expect(css,).toContain('margin:4px',);
    });
});
