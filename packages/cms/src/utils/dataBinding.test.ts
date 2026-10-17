import { describe, expect, it, } from 'vitest';
import {
    bindingFromPick, bindingRefs, dataBindingSummary, describeQuery, recordLabel, saveLineText, toggleRef,
} from './dataBinding';

describe('bindingFromPick', () => {
    const query = { search: 'x', limit: 6, };
    it('a selection wins over the query', () => {
        expect(bindingFromPick({ selectedRefs: ['a', 'b',], query, allowMultiple: true, allowQuery: true, },),)
            .toEqual({ mode: 'list', refs: ['a', 'b',], },);
    },);
    it('single when only one is allowed', () => {
        expect(bindingFromPick({ selectedRefs: ['a',], query, allowMultiple: false, allowQuery: true, },),)
            .toEqual({ mode: 'single', ref: 'a', },);
    },);
    it('no selection → live query (limit 1 for a single)', () => {
        expect(bindingFromPick({ selectedRefs: [], query, allowMultiple: true, allowQuery: true, },),)
            .toEqual({ mode: 'query', query, },);
        expect(bindingFromPick({ selectedRefs: [], query, allowMultiple: false, allowQuery: true, },),)
            .toEqual({ mode: 'query', query: { search: 'x', limit: 1, }, },);
    },);
    it('no selection and no query allowed → null', () => {
        expect(bindingFromPick({ selectedRefs: [], query, allowMultiple: true, allowQuery: false, },),).toBeNull();
    },);
},);

describe('toggleRef', () => {
    it('adds in pick order, removes, replaces for single, honours max', () => {
        expect(toggleRef(['a',], 'b', true,),).toEqual(['a', 'b',],);
        expect(toggleRef(['a', 'b',], 'a', true,),).toEqual(['b',],);
        expect(toggleRef(['a',], 'b', false,),).toEqual(['b',],);
        expect(toggleRef(['a', 'b',], 'c', true, 2,),).toEqual(['a', 'b',],);
    },);
},);

describe('summaries', () => {
    it('describes a query with its clauses', () => {
        expect(describeQuery({ limit: 6, },),).toBe('newest 6',);
        expect(describeQuery({ sortBy: 'title', sortOrder: 'asc', filter: { status: { op: 'eq', value: 'active', }, }, search: 'cat', },),)
            .toBe('title ↑ · status = active · search "cat"',);
    },);
    it('summarises each binding', () => {
        expect(dataBindingSummary(undefined,),).toBe('Not set',);
        expect(dataBindingSummary({ mode: 'list', refs: [], }, undefined, 'Auto',),).toBe('Auto',);
        expect(dataBindingSummary({ mode: 'single', ref: 'x', },),).toBe('1 selected',);
        expect(dataBindingSummary({ mode: 'list', refs: ['a', 'b', 'c', 'd',], }, { a: 'A', b: 'B', c: 'C', d: 'D', },),)
            .toBe('4 selected: A, B, C…',);
        expect(dataBindingSummary({ mode: 'list', refs: ['a', 'b',], }, { a: 'A', b: 'B', },),).toBe('2 selected: A, B',);
        expect(dataBindingSummary({ mode: 'query', query: { limit: 6, filter: { status: 'active', }, }, },),)
            .toBe('Live: newest 6 · status = active',);
    },);
    it('says which will be saved', () => {
        expect(saveLineText(3, {}, true,),).toBe('3 records selected — the filters are not used.',);
        expect(saveLineText(0, { limit: 4, }, true,),).toBe('No records selected — saving a live query: newest 4.',);
        expect(saveLineText(0, {}, false,),).toBe('Select at least one record.',);
    },);
    it('refs + labels', () => {
        expect(bindingRefs({ mode: 'single', ref: 'x', },),).toEqual(['x',],);
        expect(bindingRefs({ mode: 'query', query: {}, },),).toEqual([],);
        expect(recordLabel({ id: '1', name: 'N', },),).toBe('N',);
        expect(recordLabel({ id: '1', },),).toBe('1',);
    },);
},);
