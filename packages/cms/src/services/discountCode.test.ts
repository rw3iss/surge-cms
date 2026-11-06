import { describe, expect, it, } from 'vitest';
import { codeFromSearch, DISCOUNT_CODE_TTL_MS, readStoredCode, } from './discountCode';

const NOW = 1_800_000_000_000;

describe('readStoredCode', () => {
    it('returns a live code', () => {
        expect(readStoredCode(JSON.stringify({ code: 'SUMMER10', exp: NOW + DISCOUNT_CODE_TTL_MS, },), NOW,),).toBe('SUMMER10',);
    },);
    it('drops an expired code', () => {
        expect(readStoredCode(JSON.stringify({ code: 'SUMMER10', exp: NOW - 1, },), NOW,),).toBe('',);
    },);
    it('survives missing, damaged and odd entries', () => {
        expect(readStoredCode(null, NOW,),).toBe('',);
        expect(readStoredCode('not json', NOW,),).toBe('',);
        expect(readStoredCode('null', NOW,),).toBe('',);
        expect(readStoredCode('"SUMMER10"', NOW,),).toBe('',);
        expect(readStoredCode(JSON.stringify({ code: 'SUMMER10', },), NOW,),).toBe('',);
        expect(readStoredCode(JSON.stringify({ code: '<x>', exp: NOW + 1, },), NOW,),).toBe('',);
    },);
},);

describe('codeFromSearch', () => {
    it('reads a valid ?code=', () => {
        expect(codeFromSearch('?code=ANNA-15',),).toBe('ANNA-15',);
        expect(codeFromSearch('?a=1&code=x_y9',),).toBe('x_y9',);
    },);
    it('ignores missing and invalid codes', () => {
        expect(codeFromSearch('',),).toBe('',);
        expect(codeFromSearch('?code=ab',),).toBe('',);
        expect(codeFromSearch('?code=%3Cscript%3E',),).toBe('',);
    },);
},);
