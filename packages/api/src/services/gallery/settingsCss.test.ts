/** S5: the gallery's CSS-value guard refuses escapes and every remote-load form. */
import { describe, expect, it, vi, } from 'vitest';

vi.mock('../settings', () => ({ get: async () => ({}), set: async () => undefined, }),);
vi.mock('../cache', () => ({ cache: {}, CACHE_KEYS: {}, }),);

const { cleanAppearance, cssValue, } = await import('./settings');

describe('cssValue', () => {
    it.each(['12px', 'clamp(1rem, 2vw, 3rem)', '0 auto', 'var(--site-gutter)', '50%',],)('accepts %s', (v,) => {
        expect(cssValue(v, 'Gap',),).toBe(v,);
    });
    it.each([
        '\\75 rl(https://x.test/p.gif)', 'url(https://x)', 'URL (x)', 'expression(alert(1))', '@import "x"',
        '1px; color: red', '1px}', '/* c */', '<b>', '"x"',
    ],)('refuses %s', (v,) => {
        expect(() => cssValue(v, 'Gap',),).toThrow(/not a valid CSS value/,);
    });
});

describe('cleanAppearance', () => {
    it('keeps fit hug, a valid title position + alignment; unknown values fall back', () => {
        const a = cleanAppearance({ fit: 'hug', titlePosition: 'overlay-bottom', titleAlign: 'center', },);
        expect(a,).toMatchObject({ fit: 'hug', titlePosition: 'overlay-bottom', titleAlign: 'center', },);
        const b = cleanAppearance({ titlePosition: 'sideways' as never, titleAlign: 'justify' as never, },);
        expect(b.titlePosition,).toBe('below',);
        expect('titleAlign' in b,).toBe(false,);
    });
    it("'' clears the alignment (inherit)", () => {
        expect('titleAlign' in cleanAppearance({ titleAlign: '', },),).toBe(false,);
    });
});
