import { describe, expect, it, } from 'vitest';
import { groupLayoutOf, groupSlotCount, } from './groupLayout';

describe('groupLayoutOf', () => {
    it('row / column: slots = columns', () => {
        expect(groupLayoutOf({},),).toEqual({ layout: 'horizontal', columns: 2, rows: 1, slots: 2, },);
        expect(groupLayoutOf({ direction: 'vertical', columns: 3, rows: 5, },),).toEqual({ layout: 'vertical', columns: 3, rows: 1, slots: 3, },);
    },);
    it('grid: slots = columns × rows', () => {
        expect(groupLayoutOf({ direction: 'grid', columns: 3, rows: 2, },),).toEqual({ layout: 'grid', columns: 3, rows: 2, slots: 6, },);
        expect(groupSlotCount({ direction: 'grid', columns: 4, },),).toBe(8,);
    },);
    it('clamps and defaults bad values', () => {
        expect(groupLayoutOf({ direction: 'grid', columns: 99, rows: 0, },),).toMatchObject({ columns: 16, rows: 2, },);
        expect(groupLayoutOf({ direction: 'nope', columns: 'x', },),).toMatchObject({ layout: 'horizontal', columns: 2, },);
    },);
},);
