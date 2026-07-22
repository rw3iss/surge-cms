import { describe, expect, it, } from 'vitest';
import { blockStyleLayoutCss, } from './blockStyleCss';

// Resolvers mirroring the real call sites (fontStack / toFlexAlign) closely
// enough to assert the mapping shape.
const opts = {
    resolveFont: (v: string | undefined,) => (v ? `'${v}', sans-serif` : undefined),
    resolveHAlign: (v: string | undefined,) =>
        v === 'center' ? 'center' : v === 'end' ? 'flex-end' : v ? 'flex-start' : undefined,
};

describe('blockStyleLayoutCss', () => {
    it('omits everything for an empty style', () => {
        expect(blockStyleLayoutCss({}, opts,),).toEqual({},);
    });

    it('maps typography + text-align', () => {
        const out = blockStyleLayoutCss(
            { textAlign: 'center', fontSize: '18px', lineHeight: '1.6', fontFamily: 'font8', },
            opts,
        );
        expect(out,).toMatchObject({
            'text-align': 'center',
            'font-size': '18px',
            'line-height': '1.6',
            'font-family': "'font8', sans-serif",
        },);
    });

    it('vertical align center → flex column + justify center; top → nothing', () => {
        expect(blockStyleLayoutCss({ verticalAlign: 'center', }, opts,),).toMatchObject({
            display: 'flex',
            'flex-direction': 'column',
            'justify-content': 'center',
        },);
        expect(blockStyleLayoutCss({ verticalAlign: 'bottom', }, opts,)['justify-content'],).toBe('flex-end',);
        expect(blockStyleLayoutCss({ verticalAlign: 'top', }, opts,).display,).toBeUndefined();
    });

    it('applies box sizing, suppressed for group items (min-height still applies)', () => {
        const full = blockStyleLayoutCss(
            { width: '80%', maxWidth: '640px', height: '200px', minHeight: '100px', },
            opts,
        );
        expect(full,).toMatchObject({ width: '80%', 'max-width': '640px', height: '200px', 'min-height': '100px', },);

        const slot = blockStyleLayoutCss(
            { width: '80%', maxWidth: '640px', height: '200px', minHeight: '100px', },
            { ...opts, suppressBox: true, },
        );
        expect(slot.width,).toBeUndefined();
        expect(slot['max-width'],).toBeUndefined();
        expect(slot.height,).toBeUndefined();
        expect(slot['min-height'],).toBe('100px',);
    });

    it('single-value margin auto-centers; multi-value + auto pass through', () => {
        expect(blockStyleLayoutCss({ margin: '16px', }, opts,).margin,).toBe('16px auto',);
        expect(blockStyleLayoutCss({ margin: 'auto', }, opts,).margin,).toBe('auto',);
        expect(blockStyleLayoutCss({ margin: '10px 20px', }, opts,).margin,).toBe('10px 20px',);
    });

    it('horizontal align → --block-h-align var; overflow passthrough', () => {
        const out = blockStyleLayoutCss(
            { horizontalAlign: 'center', overflowX: 'auto', overflowY: 'hidden', },
            opts,
        );
        expect(out['--block-h-align'],).toBe('center',);
        expect(out['overflow-x'],).toBe('auto',);
        expect(out['overflow-y'],).toBe('hidden',);
    });
});
