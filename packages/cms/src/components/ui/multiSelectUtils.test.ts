/**
 * `toggleSelection` is the one rule that is easy to regress silently: it must
 * always return the selection in OPTIONS order, never in click order, because
 * `MultiSelect` renders chips and `aria-selected` straight off the result.
 */
import { describe, expect, it, } from 'vitest';
import {
    allEnabledValues,
    filterOptions,
    type MultiSelectOption,
    nextActiveIndex,
    orderBySelectionOptions,
    toggleSelection,
} from './multiSelectUtils';

const OPTIONS: MultiSelectOption[] = [
    { value: 'a', label: 'Alpha', },
    { value: 'b', label: 'Bravo', hint: 'second letter', },
    { value: 'c', label: 'Charlie', disabled: true, },
    { value: 'd', label: 'Delta', },
];

describe('toggleSelection', () => {
    it('adds a value, placed by OPTIONS order rather than click order', () => {
        // Clicked Delta then Alpha — the result still reads a, d.
        let selected = toggleSelection([], OPTIONS, 'd',);
        selected = toggleSelection(selected, OPTIONS, 'a',);
        expect(selected,).toEqual(['a', 'd',],);
    },);

    it('removes a value already selected', () => {
        expect(toggleSelection(['a', 'd',], OPTIONS, 'a',),).toEqual(['d',],);
    },);

    it('keeps an unknown (stale) value, trailing the known ones', () => {
        expect(toggleSelection(['stale',], OPTIONS, 'a',),).toEqual(['a', 'stale',],);
    },);
},);

describe('orderBySelectionOptions', () => {
    it('reorders an out-of-order selection to match the options list', () => {
        expect(orderBySelectionOptions(['d', 'a',], OPTIONS,),).toEqual(['a', 'd',],);
    },);

    it('is a no-op on an already-ordered list', () => {
        expect(orderBySelectionOptions(['a', 'b', 'd',], OPTIONS,),).toEqual(['a', 'b', 'd',],);
    },);
},);

describe('allEnabledValues', () => {
    it('excludes disabled options', () => {
        expect(allEnabledValues(OPTIONS,),).toEqual(['a', 'b', 'd',],);
    },);
},);

describe('filterOptions', () => {
    it('returns everything for an empty query', () => {
        expect(filterOptions(OPTIONS, '',),).toEqual(OPTIONS,);
    },);

    it('matches case-insensitively on label', () => {
        expect(filterOptions(OPTIONS, 'bra',).map((o,) => o.value,),).toEqual(['b',],);
    },);

    it('matches on hint too', () => {
        expect(filterOptions(OPTIONS, 'second letter',).map((o,) => o.value,),).toEqual(['b',],);
    },);
},);

describe('nextActiveIndex', () => {
    it('moves to the next option', () => {
        expect(nextActiveIndex(OPTIONS, 0, 1,),).toBe(1,);
    },);

    it('skips a disabled option', () => {
        // index 1 (Bravo) + 1 => index 2 (Charlie, disabled) => index 3 (Delta)
        expect(nextActiveIndex(OPTIONS, 1, 1,),).toBe(3,);
    },);

    it('wraps around at the end', () => {
        expect(nextActiveIndex(OPTIONS, 3, 1,),).toBe(0,);
    },);

    it('wraps around at the start going up', () => {
        expect(nextActiveIndex(OPTIONS, 0, -1,),).toBe(3,);
    },);

    it('returns -1 for an empty list', () => {
        expect(nextActiveIndex([], -1, 1,),).toBe(-1,);
    },);

    it('returns the current index when every option is disabled', () => {
        const allDisabled = OPTIONS.map((o,) => ({ ...o, disabled: true, }),);
        expect(nextActiveIndex(allDisabled, 1, 1,),).toBe(1,);
    },);

    it('lands on the first enabled option from an out-of-range current (e.g. -1)', () => {
        expect(nextActiveIndex(OPTIONS, -1, 1,),).toBe(0,);
    },);
},);
