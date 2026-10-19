import { describe, expect, it, } from 'vitest';
import { groupColumns, groupContainerStyle, groupStacksMobile, } from './groupStyle';

describe('group layout styles', () => {
    it('row with columns → grid of N columns', () => {
        expect(groupColumns({ direction: 'horizontal', columns: 3, },),).toBe(3,);
        expect(groupContainerStyle({ direction: 'horizontal', columns: 3, },).display,).toBe('grid',);
    },);
    it('column → flex column, no forced columns', () => {
        expect(groupColumns({ direction: 'vertical', columns: 3, },),).toBeNull();
        expect(groupContainerStyle({ direction: 'vertical', },)['flex-direction'],).toBe('column',);
    },);
    it('grid → N column tracks (rows come from the slot count), never nowrap-stacked', () => {
        expect(groupColumns({ direction: 'grid', columns: 4, rows: 3, },),).toBe(4,);
        expect(groupContainerStyle({ direction: 'grid', columns: 4, rows: 3, },)['--group-cols'],).toBe('4',);
        expect(groupStacksMobile({ direction: 'grid', wrap: 'nowrap', },),).toBe(false,);
    },);
},);
