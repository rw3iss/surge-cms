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

import { groupColumnTracks, groupSlotWidth, } from './groupLayout';
describe('groupColumnTracks', () => {
    it('null when no slot sets a width', () => {
        expect(groupColumnTracks([undefined, '',], 2,),).toBeNull();
    },);
    it('percentages → shares; unset slots split the rest; fixed stays fixed', () => {
        expect(groupColumnTracks(['80%', '20%',], 2,),).toEqual([{ fr: 80, }, { fr: 20, },],);
        expect(groupColumnTracks(['50%',], 3,),).toEqual([{ fr: 50, }, { fr: 25, }, { fr: 25, },],);
        expect(groupColumnTracks(['300px', undefined,], 2,),).toEqual([{ fixed: '300px', }, { fr: 1, },],);
    },);
    it('only the first `columns` widths size the tracks', () => {
        expect(groupColumnTracks(['30%', '70%', '10%',], 2,),).toEqual([{ fr: 30, }, { fr: 70, },],);
    },);
},);
describe('groupSlotWidth', () => {
    it('Width property, else style width; 100% = unset', () => {
        expect(groupSlotWidth({ width: '40%', }, { width: '10%', },),).toBe('40%',);
        expect(groupSlotWidth({}, { width: '10%', },),).toBe('10%',);
        expect(groupSlotWidth({ width: '100%', }, null,),).toBeUndefined();
    },);
},);
