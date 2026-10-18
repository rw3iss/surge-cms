import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../config', () => ({ config: { frontendUrl: 'https://site.test/', }, }),);
vi.mock('../settings', () => ({ getPublicSettings: () => Promise.resolve({ defaults: { timezone: 'America/Chicago', }, },), }),);
vi.mock('./settings', () => ({ getSettings: () => Promise.resolve({ eventsUrl: '/calendar', },), }),);

const { describeWhen, escapeHtml, eventLink, eventTimeZone, eventUrl, formatWhen, occurrenceStart, } = await import('./format');

const EVENT = {
    id: 'e1', slug: 'gala', title: 'Gala', startsAt: '2026-10-20T23:00:00.000Z', allDay: false, timezone: 'America/New_York',
} as never;

describe('events format helpers', () => {
    it('formats in the event time zone, not the server zone', () => {
        // 23:00Z = 7:00 PM EDT.
        expect(formatWhen(EVENT, { timeZone: 'America/New_York', },),).toContain('7:00 PM',);
        expect(formatWhen(EVENT, { timeZone: 'America/New_York', },),).toContain('EDT',);
    },);

    it('describes a later occurrence of a series at the series time of day', () => {
        expect(occurrenceStart(EVENT, '2026-11-03',).toISOString(),).toBe('2026-11-03T23:00:00.000Z',);
        expect(occurrenceStart(EVENT, null,).toISOString(),).toBe('2026-10-20T23:00:00.000Z',);
        expect(occurrenceStart(EVENT, 'nonsense',).toISOString(),).toBe('2026-10-20T23:00:00.000Z',);
    },);

    it('falls back to the site default zone, then the fallback', async () => {
        expect(await eventTimeZone({ timezone: null, },),).toBe('America/Chicago',);
        expect(await eventTimeZone({ timezone: 'Not/AZone', },),).toBe('America/Chicago',);
        expect(await describeWhen(EVENT,),).toContain('7:00 PM',);
    },);

    it('links under the configurable events path', async () => {
        expect(eventUrl({ slug: 'gala', },),).toBe('https://site.test/events/gala',);
        expect(await eventLink({ slug: 'gala', },),).toBe('https://site.test/calendar/gala',);
    },);

    it('escapes html', () => {
        expect(escapeHtml('<b>"x" & y</b>',),).toBe('&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;',);
    },);
},);
