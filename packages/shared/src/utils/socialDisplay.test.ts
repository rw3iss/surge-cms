/**
 * "Item border radius" — the social block's per-POST rounding.
 *
 * Separate from the block's own Border Radius because they are different
 * boxes: one rounds the panel, the other rounds each video inside it. Neither
 * can express the other, so conflating them would make an ordinary design
 * (rounded panel, square videos, or the reverse) impossible to state.
 */
import { describe, expect, it, } from 'vitest';
import { resolveSocialItemBox, resolveSocialItemRadius, resolveSocialTitleAlign, } from './socialDisplay';

describe('resolveSocialItemRadius', () => {
    it('returns the stored value', () => {
        expect(resolveSocialItemRadius({ itemBorderRadius: '8px', },),).toBe('8px',);
    });

    it('keeps a multi-value radius intact', () => {
        // The shape that prompted this: rounding only the bottom corners.
        expect(resolveSocialItemRadius({ itemBorderRadius: '0px 0px 15px 15px', },),)
            .toBe('0px 0px 15px 15px',);
    });

    it('trims surrounding whitespace', () => {
        expect(resolveSocialItemRadius({ itemBorderRadius: '  8px  ', },),).toBe('8px',);
    });

    it.each([undefined, null, '', '   ',],)('is undefined for %j', (v,) => {
        // Undefined, not '', so a caller can use `??` to fall through to the
        // block radius without an empty string winning.
        expect(resolveSocialItemRadius({ itemBorderRadius: v, },),).toBeUndefined();
    },);

    it('is undefined for a block with no settings at all', () => {
        expect(resolveSocialItemRadius(null,),).toBeUndefined();
        expect(resolveSocialItemRadius(undefined,),).toBeUndefined();
        expect(resolveSocialItemRadius({},),).toBeUndefined();
    });

    it('does NOT inherit the block-level radius', () => {
        // Empty means "square posts", not "same as the block". A rounded panel
        // holding square videos is a normal design and has to stay sayable.
        expect(resolveSocialItemRadius({ borderRadius: '15px', } as never,),).toBeUndefined();
    });
});

describe('resolveSocialItemBox', () => {
    it('reads every Item setting', () => {
        expect(resolveSocialItemBox({
            itemWidth: '300px',
            itemHeight: '200px',
            itemGap: '1.5rem',
            itemBorderRadius: '8px',
        },),).toEqual({ width: '300px', height: '200px', gap: '1.5rem', borderRadius: '8px', },);
    });

    it('keeps a clamp() intact rather than trying to understand it', () => {
        // These are CSS values passed through, not numbers to reason about.
        expect(resolveSocialItemBox({ itemWidth: 'clamp(200px,80vw,800px)', },).width,)
            .toBe('clamp(200px,80vw,800px)',);
    });

    it('turns empty and whitespace values into undefined', () => {
        // So a caller can `??` past them; an empty string would win and emit
        // `width:` into the markup.
        const box = resolveSocialItemBox({ itemWidth: '', itemHeight: '   ', itemGap: undefined, },);
        expect(box,).toEqual({
            width: undefined,
            height: undefined,
            gap: undefined,
            borderRadius: undefined,
        },);
    });

    it('is all-undefined for a block with no settings', () => {
        for (const v of [null, undefined, {},]) {
            expect(resolveSocialItemBox(v,),).toEqual({
                width: undefined,
                height: undefined,
                gap: undefined,
                borderRadius: undefined,
            },);
        }
    });

    it('backs resolveSocialItemRadius, so the two cannot disagree', () => {
        const s = { itemBorderRadius: '8px', };
        expect(resolveSocialItemRadius(s,),).toBe(resolveSocialItemBox(s,).borderRadius,);
    });
});

describe('resolveSocialTitleAlign', () => {
    it('defaults to centre, including for every block saved before the setting', () => {
        for (const v of [undefined, null, {}, { titleAlign: '', }, { titleAlign: 'bogus', },]) {
            expect(resolveSocialTitleAlign(v as never,),).toBe('center',);
        }
    });

    it('honours left / center / right', () => {
        expect(resolveSocialTitleAlign({ titleAlign: 'left', },),).toBe('left',);
        expect(resolveSocialTitleAlign({ titleAlign: 'center', },),).toBe('center',);
        expect(resolveSocialTitleAlign({ titleAlign: 'right', },),).toBe('right',);
    });
});
