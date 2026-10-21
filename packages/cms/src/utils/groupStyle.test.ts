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

import { groupSlotItemStyle, groupTracks, } from './groupStyle';

describe('groupTracks (column widths from slot widths)', () => {
    it('no widths → null (equal columns)', () => {
        expect(groupTracks([undefined, undefined,], 2,),).toBeNull();
    },);
    it('percentages become proportional fr tracks (gap-safe)', () => {
        expect(groupTracks(['80%', '20%',], 2,),).toBe('minmax(0, 80fr) minmax(0, 20fr)',);
    },);
    it('slots without a width share what is left', () => {
        expect(groupTracks(['50%', undefined, undefined,], 3,),).toBe('minmax(0, 50fr) minmax(0, 25fr) minmax(0, 25fr)',);
    },);
    it('fixed lengths stay fixed; the rest 1fr', () => {
        expect(groupTracks(['300px', undefined,], 2,),).toBe('minmax(0, 300px) minmax(0, 1fr)',);
    },);
    it('a column grid exposes --group-tracks; the slot itself no longer takes the width', () => {
        const parent = { direction: 'horizontal', columns: 2, };
        expect(groupContainerStyle(parent, { slotWidths: ['80%', '20%',], },)['--group-tracks'],).toBe('minmax(0, 80fr) minmax(0, 20fr)',);
        expect(groupSlotItemStyle({ width: '80%', }, parent,).width,).toBeUndefined();
        expect(groupSlotItemStyle({ width: '80%', }, { direction: 'horizontal', },).width,).toBe('80%',);
    },);
},);

describe('nested groups never inherit layout', () => {
    it('every column grid sets its own --group-tracks (no slot widths → equal columns)', () => {
        expect(groupContainerStyle({ direction: 'grid', columns: 1, rows: 2, },)['--group-tracks'],).toBe('repeat(1, minmax(0, 1fr))',);
        expect(groupContainerStyle({ direction: 'horizontal', columns: 3, },)['--group-tracks'],).toBe('repeat(3, minmax(0, 1fr))',);
    },);
},);

describe('groupSlotItemStyle: column groups', () => {
    it('stack slots at content height (no sharing of the group height)', () => {
        expect(groupSlotItemStyle({}, { direction: 'vertical', },).flex,).toBe('0 0 auto',);
        expect(groupSlotItemStyle({ __groupDirection: 'vertical', }, {},).flex,).toBe('0 0 auto',);
        expect(groupSlotItemStyle({}, { direction: 'horizontal', },).flex,).toBe('1 1 0',);
    },);
},);
