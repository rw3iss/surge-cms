import { describe, expect, it, } from 'vitest';
import { cssLength, } from './blockStyleCss';

describe('cssLength', () => {
    it('treats a bare number as px', () => {
        expect(cssLength(300,),).toBe('300px',);
        expect(cssLength('300',),).toBe('300px',);
        expect(cssLength(' 12.5 ',),).toBe('12.5px',);
    });
    it('passes a value with a unit through (never 300pxpx)', () => {
        expect(cssLength('300px',),).toBe('300px',);
        expect(cssLength('50vh',),).toBe('50vh',);
        expect(cssLength('calc(100% - 2rem)',),).toBe('calc(100% - 2rem)',);
    });
    it('omits empty values', () => {
        for (const v of ['', '  ', null, undefined, 0, NaN,]) expect(cssLength(v,),).toBeUndefined();
    });
});
