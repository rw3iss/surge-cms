import { describe, expect, it, } from 'vitest';
import { describeQuery, nextSlotId, slotBindingSummary, slotChoices, slotIdError, slotOptionLabel, } from './templateSlots';

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

describe('slotBindingSummary', () => {
    it('summarises each mode', () => {
        expect(slotBindingSummary(undefined,),).toBe('Not set',);
        expect(slotBindingSummary({ mode: 'single', ref: '', },),).toBe('Not set',);
        expect(slotBindingSummary({ mode: 'single', ref: 'x', },),).toBe('1 selected',);
        expect(slotBindingSummary({ mode: 'list', refs: ['a', 'b', 'c',], },),).toBe('3 selected',);
        expect(slotBindingSummary({ mode: 'query', query: { limit: 6, }, },),).toBe('Live query: newest 6',);
    },);
    it('describes sort and filters', () => {
        expect(describeQuery({ sortBy: 'title', sortOrder: 'asc', filter: { status: 'active', }, },),)
            .toBe('title ↑, 1 filter',);
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
