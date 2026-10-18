import { describe, expect, it, } from 'vitest';
import { withHeight, } from './blockHeights';

describe('withHeight (LRU of HTML block heights)', () => {
    it('records and keeps entries under the cap', () => {
        expect(withHeight({}, 'a', 120, 1,),).toEqual({ a: { h: 120, t: 1, }, },);
    },);
    it('drops the least recently used past the cap (legacy numbers count as oldest)', () => {
        const bag = { old: 90, b: { h: 1, t: 5, }, c: { h: 2, t: 9, }, };
        const out = withHeight(bag, 'd', 3, 10, 3,);
        expect(Object.keys(out,).sort(),).toEqual(['b', 'c', 'd',],);
    },);
},);
