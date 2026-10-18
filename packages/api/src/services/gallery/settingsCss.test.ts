/** S5: the gallery's CSS-value guard refuses escapes and every remote-load form. */
import { describe, expect, it, vi, } from 'vitest';

vi.mock('../settings', () => ({ get: async () => ({}), set: async () => undefined, }),);
vi.mock('../cache', () => ({ cache: {}, CACHE_KEYS: {}, }),);

const { cssValue, } = await import('./settings');

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
