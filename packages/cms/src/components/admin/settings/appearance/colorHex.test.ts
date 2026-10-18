/** The one hex rule shared by ColorPicker and the Appearance colour panels. */
import { describe, expect, it, } from 'vitest';
import { composeHex, hexAlphaPct, hexBase6, isValidHex, } from './colorHex';

describe('isValidHex', () => {
    it('accepts #rgb, #rrggbb and #rrggbbaa', () => {
        for (const v of ['#abc', '#A1B2C3', '#a1b2c380',]) expect(isValidHex(v,), v,).toBe(true,);
    });
    it('refuses everything else', () => {
        for (const v of ['abc', '#ab', '#abcd', '#abcde', '#a1b2c3d', '#gggggg', 'swatch:x', '',]) expect(isValidHex(v,), v,).toBe(false,);
    });
});

describe('alpha helpers', () => {
    it('round-trips an opacity', () => {
        const hex = composeHex('#112233', 50,);
        expect(hexBase6(hex,),).toBe('#112233',);
        expect(hexAlphaPct(hex,),).toBe(50,);
        expect(composeHex('#112233', 100,),).toBe('#112233',);
    });
});
