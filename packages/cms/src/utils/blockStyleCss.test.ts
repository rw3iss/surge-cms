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

/**
 * Text Align has to reach the MEDIA block types too.
 *
 * image / video / document / url_link / campaign / gallery / form lay their
 * inner out as a flex column, where horizontal position is `align-items` and
 * `text-align` moves nothing. That rule hardcoded `center`, so those blocks
 * ignored Text Align on the web while the email renderer honoured it — the
 * same block, aligned two different ways, by construction.
 */
describe('--block-align-items', () => {
    it.each([
        ['left', 'flex-start',],
        ['start', 'flex-start',],
        ['center', 'center',],
        ['right', 'flex-end',],
        ['end', 'flex-end',],
    ],)('maps text-align %s → %s', (align, expected,) => {
        const out = blockStyleLayoutCss({ textAlign: align, }, opts,);
        expect(out['--block-align-items'],).toBe(expected,);
    },);

    it('still emits text-align itself', () => {
        // The variable is an ADDITION — inline content still needs the real
        // property.
        const out = blockStyleLayoutCss({ textAlign: 'right', }, opts,);
        expect(out['text-align'],).toBe('right',);
    },);

    it('is absent when no text align is saved', () => {
        // Absent means the consuming rule's `center` fallback applies, which is
        // what every existing block relies on.
        const out = blockStyleLayoutCss({ padding: '4px', }, opts,);
        expect(out['--block-align-items'],).toBeUndefined();
    },);

    it('falls back to center for a value with no flex equivalent', () => {
        // `justify` has none — stretching an image across the column is not
        // what justified text means.
        const out = blockStyleLayoutCss({ textAlign: 'justify', }, opts,);
        expect(out['--block-align-items'],).toBe('center',);
    },);
},);
