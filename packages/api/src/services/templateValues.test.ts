/**
 * The template engine's value functions (`{{ formatDate(…) }}` and friends).
 *
 * Lives here, not in `packages/shared`, because that package ships no test
 * runner — the same reason `services/mail/typography.test.ts` sits on this
 * side of the fence.
 *
 * The case worth protecting is `formatDate`: it now answers "today" for a call
 * with NO argument, while still answering "" for a call whose argument is
 * empty. Collapsing those two would make an unpublished post date itself as
 * published this morning.
 */
import { describe, expect, it, } from 'vitest';
import { resolveValueFunction, } from '@sitesurge/types';

/** Call as the evaluator does: a real argument list. */
const call = (name: string, ...args: unknown[]) => resolveValueFunction(name, args,);

/** Today in the engine's fixed output format, computed the same way it does. */
const todayFormatted = () =>
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', },)
        .format(new Date(),);

describe('formatDate', () => {
    it('with NO argument returns today', () => {
        expect(call('formatDate',),).toBe(todayFormatted(),);
    },);

    it('reads as a real date, not an empty string or "Invalid Date"', () => {
        const out = String(call('formatDate',),);
        expect(out,).not.toBe('',);
        expect(out,).not.toMatch(/invalid/i,);
        expect(out,).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/,);
    },);

    it('formats a supplied ISO string', () => {
        expect(call('formatDate', '2026-09-24T12:00:00Z',),).toBe('Sep 24, 2026',);
    },);

    it('formats a supplied Date', () => {
        expect(call('formatDate', new Date('2026-01-05T12:00:00Z',),),).toBe('Jan 5, 2026',);
    },);

    it.each([null, undefined, '',],)(
        'still returns EMPTY for a supplied but blank value (%j)',
        (v,) => {
            // The distinction that matters. `{{formatDate(post.publishedAt)}}`
            // on a post with no published date must render nothing — falling
            // through to "today" would date an unpublished post as published.
            expect(call('formatDate', v,),).toBe('',);
        },
    );

    it('distinguishes "no argument" from "empty argument"', () => {
        expect(call('formatDate',),).toBe(todayFormatted(),);
        expect(call('formatDate', '',),).toBe('',);
    },);
},);

describe('the other value utilities still behave as documented', () => {
    // These back the worked examples on /admin/help/variables-and-functions.
    // If one changes, the help page is wrong and this catches it.
    it('formatCurrency: major units, decimals, currency', () => {
        expect(call('formatCurrency', 55,),).toBe('$55.00',);
        expect(call('formatCurrency', 55, false,),).toBe('$55',);
        expect(call('formatCurrency', 1234.5,),).toBe('$1,234.50',);
        expect(call('formatCurrency', 55, true, 'EUR',),).toBe('€55.00',);
    },);

    it('formatCurrency falls back to USD for an unknown code rather than throwing', () => {
        expect(call('formatCurrency', 55, true, 'NOTACURRENCY',),).toBe('$55.00',);
    },);

    it('formatNumber groups thousands and does not pad decimals', () => {
        expect(call('formatNumber', 1234567,),).toBe('1,234,567',);
        expect(call('formatNumber', 1234.5,),).toBe('1,234.5',);
    },);

    it('truncate counts the ellipsis toward the length', () => {
        const out = String(call('truncate', 'The quick brown fox jumps over the lazy dog', 20,),);
        expect(out,).toBe('The quick brown f...',);
        expect(out.length,).toBe(20,);
    },);

    it('truncate leaves text within the limit untouched', () => {
        expect(call('truncate', 'Short text', 20,),).toBe('Short text',);
    },);

    it('default keeps zero and false, replaces null/undefined/empty', () => {
        expect(call('default', '', 'there',),).toBe('there',);
        expect(call('default', null, 'there',),).toBe('there',);
        expect(call('default', 0, 'there',),).toBe(0,);
        expect(call('default', false, 'there',),).toBe(false,);
        expect(call('default', 'Jane', 'there',),).toBe('Jane',);
    },);

    it('upper / lower / trim', () => {
        expect(call('upper', 'surge media',),).toBe('SURGE MEDIA',);
        expect(call('lower', 'Surge Media',),).toBe('surge media',);
        expect(call('trim', '  padded  ',),).toBe('padded',);
    },);
},);
