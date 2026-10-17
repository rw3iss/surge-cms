import { describe, expect, it, } from 'vitest';
import { nextSlotId, slotChoices, slotIdError, slotOptionLabel, templateDataSourceState, } from './templateSlots';

describe('slotIdError', () => {
    it('accepts a valid unique id', () => {
        expect(slotIdError('photos', ['posts',],),).toBeNull();
        expect(slotIdError('a_1', [],),).toBeNull();
    },);
    it('rejects empty, bad format, too long', () => {
        expect(slotIdError('', [],),).toMatch(/required/,);
        expect(slotIdError('1abc', [],),).toMatch(/letter/,);
        expect(slotIdError('a-b', [],),).toMatch(/letter/,);
        expect(slotIdError(`a${'b'.repeat(40,)}`, [],),).toMatch(/40/,);
    },);
    it('rejects duplicates case-insensitively', () => {
        expect(slotIdError('Photos', ['photos',],),).toMatch(/already/,);
    },);
},);

describe('nextSlotId', () => {
    it('skips used ids', () => {
        expect(nextSlotId([],),).toBe('slot1',);
        expect(nextSlotId([{ id: 'slot2', },],),).toBe('slot3',);
        expect(nextSlotId([{ id: 'a', }, { id: 'slot3', },],),).toBe('slot4',);
    },);
},);

describe('slot labels + choices', () => {
    it('labels with the type and array marker', () => {
        expect(slotOptionLabel({ id: 'photos', entityType: 'gallery_item', array: true, },),).toBe('photos (gallery_item[])',);
    },);
    it('flags incompatible types', () => {
        const r = slotChoices([
            { id: 'a', entityType: 'post', array: true, },
            { id: 'b', entityType: 'gallery_item', array: true, },
        ], 'post',);
        expect(r.map((c,) => c.compatible),).toEqual([true, false,],);
    },);
},);

describe('templateDataSourceState', () => {
    const gi = { entityType: 'gallery_item', mode: 'list' as const, listRender: 'once' as const, };
    it('offers the option only when the template binds the expected type', () => {
        expect(templateDataSourceState(gi, 'gallery_item', 'gallery', false,),).toMatchObject({ offer: true, compatible: true, warning: null, eachHint: null, },);
        expect(templateDataSourceState({ ...gi, entityType: 'post', }, 'gallery_item', 'gallery', false,).offer,).toBe(false,);
        expect(templateDataSourceState(null, 'gallery_item', 'gallery', false,).offer,).toBe(false,);
    },);
    it('keeps a mismatched selection visible with a warning', () => {
        const r = templateDataSourceState({ ...gi, entityType: 'post', }, 'gallery_item', 'gallery', true,);
        expect(r,).toMatchObject({ offer: true, compatible: false, },);
        expect(r.warning,).toBe("Warning: 'gallery' expects 'gallery_item' template data.",);
    },);
    it('hints when a list template repeats per record', () => {
        expect(templateDataSourceState({ ...gi, listRender: 'each', }, 'gallery_item', 'gallery', true,).eachHint,).toMatch(/ONE item each time/,);
        expect(templateDataSourceState({ ...gi, mode: 'single', listRender: 'each', }, 'gallery_item', 'gallery', true,).eachHint,).toBeNull();
    },);
},);
