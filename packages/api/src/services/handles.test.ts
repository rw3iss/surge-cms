import { describe, expect, it, } from 'vitest';
import { normalizeHandle, pickFreeHandle, RESERVED_HANDLES, slugifyHandle, } from './handles';

describe('slugifyHandle', () => {
    it('lower-cases and dashes a display name', () => expect(slugifyHandle('Ryan  Weiss',),).toBe('ryan-weiss',));
    it('strips accents and symbols', () => expect(slugifyHandle('Zoë O\'Brien!!',),).toBe('zoe-o-brien',));
    it('falls back to "member" for empty input', () => expect(slugifyHandle('  ',),).toBe('member',));
    it('pads short names', () => expect(slugifyHandle('Al',),).toBe('al-member',));
    it('suffixes reserved words', () => {
        expect(slugifyHandle('Admin',),).toBe('admin-member',);
        expect(RESERVED_HANDLES.has('settings',),).toBe(true,);
    },);
    it('caps the length at 30 without a trailing dash', () => {
        const h = slugifyHandle('a'.repeat(29,) + ' bcdef',);
        expect(h.length,).toBeLessThanOrEqual(30,);
        expect(h.endsWith('-',),).toBe(false,);
    },);
    it('always yields a valid handle', () => {
        for (const s of ['x', '---', 'Ünïcödé', '12', 'a_b', 'Me',]) {
            expect(slugifyHandle(s,),).toMatch(/^[a-z0-9][a-z0-9_-]{2,39}$/,);
        }
    },);
},);

describe('pickFreeHandle', () => {
    it('keeps a free base', () => expect(pickFreeHandle('ryan', new Set(),),).toBe('ryan',));
    it('suffixes -1, -2 …', () => {
        expect(pickFreeHandle('ryan', new Set(['ryan',],),),).toBe('ryan-1',);
        expect(pickFreeHandle('ryan', new Set(['ryan', 'ryan-1',],),),).toBe('ryan-2',);
    },);
    it('stays within 40 characters', () => {
        const base = 'x'.repeat(40,);
        expect(pickFreeHandle(base, new Set([base,],),).length,).toBeLessThanOrEqual(40,);
    },);
},);

describe('normalizeHandle', () => {
    it('lower-cases a valid handle', () => expect(normalizeHandle('  RyanW ',),).toBe('ryanw',));
    it('rejects bad characters and short handles', () => {
        expect(() => normalizeHandle('ab',)).toThrow();
        expect(() => normalizeHandle('has space',)).toThrow();
        expect(() => normalizeHandle('-dash',)).toThrow();
    },);
    it('rejects reserved words', () => expect(() => normalizeHandle('admin',)).toThrow(/reserved/,));
},);
