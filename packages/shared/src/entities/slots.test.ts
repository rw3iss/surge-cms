import { describe, expect, it, } from 'vitest';
import { autoSlotBinding, bindingIdsIfStatic, capSlotBinding, previewSlotBindings, slotFor, } from './slots';

const slots = [
    { id: 'photos', entityType: 'gallery_item', array: true, },
    { id: 'lead', entityType: 'post', array: false, previewBinding: { mode: 'single' as const, ref: 'p1', }, },
];

describe('slotFor', () => {
    it('finds a filled, compatible slot and caps a non-array binding', () => {
        const r = slotFor({ slots, bindings: { lead: { mode: 'query', query: { limit: 9, }, }, }, }, 'lead', 'post',);
        expect(r,).toEqual({ ok: true, slot: slots[1], binding: { mode: 'query', query: { limit: 1, page: 1, }, }, },);
    },);
    it('reports missing / incompatible / unfilled', () => {
        expect(slotFor({ slots, }, 'x', 'post',),).toMatchObject({ ok: false, reason: 'missing', },);
        expect(slotFor({ slots, }, 'photos', 'post',),).toMatchObject({ ok: false, reason: 'incompatible', },);
        expect(slotFor({ slots, bindings: { photos: { mode: 'list', refs: [], }, }, }, 'photos', 'gallery_item',),).toMatchObject({ ok: false, reason: 'unfilled', },);
        expect(slotFor(undefined, 'photos', 'gallery_item',),).toMatchObject({ ok: false, reason: 'missing', },);
    },);
},);

describe('capSlotBinding / preview', () => {
    it('list → first ref for a non-array slot; array untouched', () => {
        expect(capSlotBinding({ mode: 'list', refs: ['a', 'b',], }, false,),).toEqual({ mode: 'list', refs: ['a',], },);
        expect(capSlotBinding({ mode: 'list', refs: ['a', 'b',], }, true,),).toEqual({ mode: 'list', refs: ['a', 'b',], },);
    },);
    it('preview bindings: previewBinding, else auto (1 or 6)', () => {
        expect(previewSlotBindings(slots,),).toEqual({
            photos: { mode: 'query', query: { limit: 6, }, },
            lead: { mode: 'single', ref: 'p1', },
        },);
        expect(autoSlotBinding(slots[1],),).toEqual({ mode: 'query', query: { limit: 1, }, },);
    },);
},);

describe('bindingIdsIfStatic', () => {
    it('returns ids for single/list, capped, and null for a query', () => {
        expect(bindingIdsIfStatic({ mode: 'single', ref: 'a', },),).toEqual(['a',],);
        expect(bindingIdsIfStatic({ mode: 'list', refs: ['a', '', 'b', 'c',], }, 2,),).toEqual(['a', 'b',],);
        expect(bindingIdsIfStatic({ mode: 'query', query: {}, },),).toBeNull();
        expect(bindingIdsIfStatic(null,),).toBeNull();
    },);
},);
