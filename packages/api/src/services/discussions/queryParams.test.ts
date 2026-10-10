import { describe, expect, it, } from 'vitest';
import { hotScore, normalizeQuery, queryHash, windowHours, } from './queryParams';

describe('normalizeQuery', () => {
    it('defaults: both, latest, all-time window, 10 items', () => {
        expect(normalizeQuery(),).toMatchObject({ kind: 'both', sort: 'latest', window: 'all', limit: 10, page: 1, includeReplies: true, },);
    },);
    it('hot/top default to a 7-day window', () => {
        expect(normalizeQuery({ sort: 'hot', },).window,).toBe('7d',);
        expect(normalizeQuery({ sort: 'top', window: '30d', },).window,).toBe('30d',);
    },);
    it('clamps limit and page, falls back on unknown values', () => {
        const n = normalizeQuery({ limit: 999, page: -3, sort: 'weird' as never, kind: 'x' as never, },);
        expect(n,).toMatchObject({ limit: 50, page: 1, sort: 'latest', kind: 'both', },);
    },);
    it('a single thread lookup forces kind=thread', () => {
        expect(normalizeQuery({ thread: 'hello', kind: 'comment', },).kind,).toBe('thread',);
    },);
    it('includeReplies accepts the string "false" (query string)', () => {
        expect(normalizeQuery({ includeReplies: 'false' as never, },).includeReplies,).toBe(false,);
    },);
},);

describe('windowHours', () => {
    it('maps windows', () => {
        expect([windowHours('24h',), windowHours('7d',), windowHours('30d',), windowHours('all',),],).toEqual([24, 168, 720, null,],);
    },);
},);

describe('hotScore', () => {
    it('more activity scores higher at the same age', () => {
        expect(hotScore(10, 5, 100, 5,),).toBeGreaterThan(hotScore(1, 0, 0, 5,),);
    },);
    it('decays with age', () => {
        expect(hotScore(5, 5, 0, 1,),).toBeGreaterThan(hotScore(5, 5, 0, 48,),);
    },);
    it('matches the formula', () => {
        expect(hotScore(2, 3, 100, 2,),).toBeCloseTo((4 + 3 + 2 + 1) / Math.pow(4, 1.5,), 10,);
    },);
},);

describe('queryHash', () => {
    it('is order-independent and skips undefined', () => {
        expect(queryHash(normalizeQuery({ sort: 'hot', category: 'a', },),),).toBe(queryHash(normalizeQuery({ category: 'a', sort: 'hot', },),),);
        expect(queryHash(normalizeQuery(),),).not.toContain('category',);
    },);
},);
