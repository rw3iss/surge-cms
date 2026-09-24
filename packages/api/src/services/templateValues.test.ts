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
import { formatDatePattern, looksLikeDateFormat, resolveValueFunction, } from '@sitesurge/types';

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

describe('formatDatePattern', () => {
    // A fixed local date/time so token output is deterministic.
    const d = new Date(2026, 8, 24, 14, 5, 7,); // 24 Sep 2026, 14:05:07

    it.each([
        ['YYYY', '2026',],
        ['YY', '26',],
        ['MMMM', 'September',],
        ['MMM', 'Sep',],
        ['MM', '09',],
        ['M', '9',],
        ['DD', '24',],
        ['D', '24',],
        ['dddd', 'Thursday',],
        ['ddd', 'Thu',],
        ['HH', '14',],
        ['H', '14',],
        ['hh', '02',],
        ['h', '2',],
        ['mm', '05',],
        ['ss', '07',],
        ['A', 'PM',],
        ['a', 'pm',],
    ],)('renders %s as %s', (pattern, expected,) => {
        expect(formatDatePattern(d, pattern,),).toBe(expected,);
    },);

    it.each([
        ['YYYY-MM-DD', '2026-09-24',],
        ['MMM D, YYYY', 'Sep 24, 2026',],
        ['hh:mm A', '02:05 PM',],
        ['dddd, MMMM D', 'Thursday, September 24',],
    ],)('composes %s into %s', (pattern, expected,) => {
        expect(formatDatePattern(d, pattern,),).toBe(expected,);
    },);

    it('matches the LONGEST token first', () => {
        // Without longest-first, MMMM reads as MMM + M and yields "Sep9".
        expect(formatDatePattern(d, 'MMMM',),).toBe('September',);
        expect(formatDatePattern(d, 'YYYY',),).toBe('2026',);
    },);

    it('substitutes in ONE pass, so token output is not re-scanned', () => {
        // "September" contains letters that are themselves tokens; a
        // sequence of per-token replaces would chew through its own output.
        expect(formatDatePattern(d, 'MMMM MMMM',),).toBe('September September',);
    },);

    it('emits bracketed text literally', () => {
        // The escape hatch: "Day" would otherwise become "24ay".
        expect(formatDatePattern(d, '[on] MMM D',),).toBe('on Sep 24',);
        expect(formatDatePattern(d, '[Day]: D',),).toBe('Day: 24',);
    },);

    it('preserves separators and unknown characters', () => {
        expect(formatDatePattern(d, 'YYYY/MM/DD',),).toBe('2026/09/24',);
    },);

    it('returns empty for an unparseable date rather than "Invalid Date"', () => {
        expect(formatDatePattern('not-a-date', 'YYYY',),).toBe('',);
    },);

    it('agrees with the default formatDate on month names', () => {
        // MMM here and the default format must not drift apart.
        expect(formatDatePattern(d, 'MMM D, YYYY',),).toBe(String(resolveValueFunction('formatDate', [d,],),),);
    },);
},);

describe('looksLikeDateFormat', () => {
    it.each(['YYYY', 'MMM D, YYYY', 'YYYY-MM-DD', 'HH:mm', 'dddd',],)(
        'recognises the pattern %j', (v,) => {
            expect(looksLikeDateFormat(v,),).toBe(true,);
        },
    );

    it.each([
        '2026', '2026-09-24', '2026-09-24T12:00:00Z', 'Sep 24, 2026',
        'December 2026', '24 Dec 2026',
    ],)('does NOT mistake the date %j for a format', (v,) => {
        // A string that parses as a date is a date, whatever letters it holds.
        expect(looksLikeDateFormat(v,),).toBe(false,);
    },);

    it.each(['Summer 2026', 'MM 2026',],)(
        'a string that is BOTH parseable and token-matching (%j) is a date', (v,) => {
            /*
             * The overlap case, and why the date-parse check is not redundant
             * with the token check.
             *
             * V8 parses both of these (leniently, to 1 Jan 2026), and both
             * contain `mm`/`MM`. Classified as a format, "Summer 2026" renders
             * as "Su00er 2026" — visible garbage in someone's newsletter.
             * Parsing first means a thing that IS a date is treated as one,
             * whatever letters it happens to contain.
             */
            expect(looksLikeDateFormat(v,),).toBe(false,);
        },
    );

    it.each(['hello', 'x', '', '   ',],)(
        'requires pattern tokens, so nonsense %j is not a format', (v,) => {
            // Otherwise any unparseable junk would silently render today.
            expect(looksLikeDateFormat(v,),).toBe(false,);
        },
    );
},);

describe('formatDate argument shapes', () => {
    const year = String(new Date().getFullYear(),);

    it('a lone FORMAT string uses today', () => {
        expect(call('formatDate', 'YYYY',),).toBe(year,);
    },);

    it('a lone DATE string still formats that date', () => {
        expect(call('formatDate', '2026-01-05T12:00:00Z',),).toBe('Jan 5, 2026',);
    },);

    it('date + format', () => {
        expect(call('formatDate', '2026-01-05T12:00:00Z', 'YYYY',),).toBe('2026',);
    },);

    it('an EMPTY date renders nothing even WITH a format', () => {
        // The safety property, and the reason there is no
        // `formatDate(null, 'FMT')` = today: a literal null and a post's
        // missing publishedAt arrive here identically, so honouring one would
        // date an unpublished post as published today.
        expect(call('formatDate', '', 'YYYY',),).toBe('',);
        expect(call('formatDate', null, 'YYYY',),).toBe('',);
        expect(call('formatDate', null,),).toBe('',);
    },);

    it('omitting the date is how you ask for today — that IS distinguishable', () => {
        expect(call('formatDate', 'YYYY',),).toBe(year,);
        expect(call('formatDate',),).toBe(todayFormatted(),);
    },);

    it('an INVALID date renders empty instead of throwing', () => {
        // Intl.format raises RangeError on an invalid date, so before this one
        // bad field took down the entire render rather than leaving a blank.
        expect(() => call('formatDate', 'hello',),).not.toThrow();
        expect(call('formatDate', 'hello',),).toBe('',);
        expect(call('formatDate', 'hello', 'YYYY',),).toBe('',);
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
