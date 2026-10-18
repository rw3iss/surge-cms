import { describe, expect, it, } from 'vitest';
import { excerptText, formatEventWhen, validTimeZone, } from './eventFormat';

describe('formatEventWhen', () => {
    it('formats in the event time zone', () => {
        const d = new Date('2026-10-18T23:00:00Z',);
        expect(formatEventWhen(d, false, 'America/New_York',),).toContain('7:00 PM',);
        expect(formatEventWhen(d, false, 'America/Los_Angeles',),).toContain('4:00 PM',);
        // A zone name with a full date (dateStyle + timeZoneName throws in Intl).
        expect(formatEventWhen(d, false, 'America/New_York',),).toBe('Sunday, October 18, 2026 at 7:00 PM EDT',);
    },);

    it('keeps the calendar day of an all-day event', () => {
        const d = new Date('2026-10-18T00:00:00Z',);
        const s = formatEventWhen(d, true, 'America/Los_Angeles',);
        expect(s,).toContain('October 18',);
        expect(s,).not.toContain(':',);
    },);

    it('ignores an unknown zone and an invalid date', () => {
        expect(validTimeZone('Not/AZone',),).toBeUndefined();
        expect(formatEventWhen(new Date('nope',), false,),).toBe('',);
    },);
},);

describe('excerptText', () => {
    it('leaves short text alone and cuts long text at a word', () => {
        expect(excerptText('Short text.', 50,),).toBe('Short text.',);
        const out = excerptText('one two three four five six seven eight', 20,);
        expect(out.endsWith('…',),).toBe(true,);
        expect(out.length,).toBeLessThanOrEqual(21,);
        expect(out,).not.toMatch(/\s…$/,);
    },);
},);
