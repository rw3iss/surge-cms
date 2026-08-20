import { describe, expect, it, } from 'vitest';
import { parseEmailList, } from '@sitesurge/types';

/**
 * `parseEmailList` is shared by the form editor's "Send to" validation and the
 * send path in `services/formActions.ts`. These tests pin the contract both
 * sides rely on — if they ever disagree, the failure is silent: the UI accepts
 * a list the sender then quietly drops recipients from.
 */
describe('parseEmailList (form "Send to" recipients)', () => {
    it('accepts a single address', () => {
        expect(parseEmailList('admin@example.com',),).toEqual({
            emails: ['admin@example.com',],
            invalid: [],
        },);
    },);

    it('splits a comma-separated list and trims each entry', () => {
        const { emails, invalid, } = parseEmailList('a@b.com, c@d.org ,  e@f.net',);
        expect(emails,).toEqual(['a@b.com', 'c@d.org', 'e@f.net',],);
        expect(invalid,).toEqual([],);
    },);

    it('accepts semicolons too (Outlook pastes them)', () => {
        expect(parseEmailList('a@b.com; c@d.org',).emails,).toEqual(['a@b.com', 'c@d.org',],);
    },);

    it('separates invalid entries instead of failing the whole list', () => {
        const { emails, invalid, } = parseEmailList('a@b.com, notanemail, c@d.org',);
        expect(emails,).toEqual(['a@b.com', 'c@d.org',],);
        expect(invalid,).toEqual(['notanemail',],);
    },);

    it('de-duplicates case-insensitively, keeping the first spelling', () => {
        const { emails, } = parseEmailList('Dup@x.com, dup@x.com, DUP@X.COM',);
        expect(emails,).toEqual(['Dup@x.com',],);
    },);

    it('tolerates empty entries and stray separators', () => {
        expect(parseEmailList('a@b.com,,,c@d.com,',).emails,).toEqual(['a@b.com', 'c@d.com',],);
    },);

    it('returns empty for blank/nullish input rather than throwing', () => {
        for (const input of ['', '   ', null, undefined,]) {
            expect(parseEmailList(input,),).toEqual({ emails: [], invalid: [], },);
        }
    },);
},);
