/**
 * "Item border radius" — the social block's per-POST rounding.
 *
 * Separate from the block's own Border Radius because they are different
 * boxes: one rounds the panel, the other rounds each video inside it. Neither
 * can express the other, so conflating them would make an ordinary design
 * (rounded panel, square videos, or the reverse) impossible to state.
 */
import { describe, expect, it, } from 'vitest';
import { resolveSocialItemRadius, } from './socialDisplay';

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
