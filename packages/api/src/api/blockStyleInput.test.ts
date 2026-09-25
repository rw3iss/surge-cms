/**
 * The Custom CSS size cap.
 *
 * The block `style` bag is deliberately open — a new style control must not
 * need five route modules edited before it can be saved. That openness is
 * exactly why the one field an operator can paste unbounded text into needs
 * its own guard.
 */
import { describe, expect, it, } from 'vitest';
import { BLOCK_CUSTOM_CSS_MAX, blockStyleRecord, } from './blockStyleInput';

const css = (n: number,) => 'a'.repeat(n,);

describe('blockStyleRecord', () => {
    it('accepts an unknown property, so a new style control needs no route change', () => {
        expect(blockStyleRecord.safeParse({ someFutureProp: 'x', },).success,).toBe(true,);
    });

    it('accepts custom CSS at the limit', () => {
        expect(blockStyleRecord.safeParse({ customCss: css(BLOCK_CUSTOM_CSS_MAX,), },).success,).toBe(true,);
    });

    it('rejects custom CSS one character over', () => {
        expect(blockStyleRecord.safeParse({ customCss: css(BLOCK_CUSTOM_CSS_MAX + 1,), },).success,).toBe(false,);
    });

    it('rejects oversized custom CSS inside a BREAKPOINT bag too', () => {
        // Same editor, different key — a cap covering only the default is
        // sidestepped by changing the breakpoint dropdown first.
        const r = blockStyleRecord.safeParse({
            breakpoints: { mobile: { customCss: css(BLOCK_CUSTOM_CSS_MAX + 1,), }, },
        },);
        expect(r.success,).toBe(false,);
    });

    it('accepts a breakpoint bag within the limit', () => {
        expect(
            blockStyleRecord.safeParse({ breakpoints: { mobile: { customCss: 'p{color:red}', }, }, },).success,
        ).toBe(true,);
    });

    it('is unbothered by a malformed breakpoints value', () => {
        // A guard that throws on odd input would turn a bad request into a 500.
        for (const bps of [null, 'nope', 42, { mobile: null, }, { mobile: 'x', },]) {
            expect(() => blockStyleRecord.safeParse({ breakpoints: bps, },)).not.toThrow();
        }
    });

    it('leaves a non-string customCss to the renderer rather than rejecting', () => {
        // The render path already ignores a non-string; failing the whole save
        // over it would be a worse outcome than ignoring one bad key.
        expect(blockStyleRecord.safeParse({ customCss: 42, },).success,).toBe(true,);
    });
});
