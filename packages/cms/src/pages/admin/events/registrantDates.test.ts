import { describe, expect, it, } from 'vitest';
import { registrantDateChoices, } from './registrantDates';

const NOW = new Date('2026-10-21T12:00:00Z',);

describe('registrantDateChoices', () => {
    it('one-off event → its own date, no picker', () => {
        const r = registrantDateChoices({ startsAt: '2026-11-05T23:00:00Z', endsAt: null, allDay: false, timezone: 'UTC', recurrenceRule: null, recurrenceUntil: null, }, NOW,);
        expect(r,).toEqual({ choices: [], initial: '2026-11-05', },);
    },);

    it('weekly series started last year → defaults to the latest date, offers recent past dates', () => {
        const r = registrantDateChoices({ startsAt: '2025-01-07T18:00:00Z', endsAt: null, allDay: false, timezone: 'UTC', recurrenceRule: 'weekly', recurrenceUntil: null, }, NOW,);
        // Yesterday 6 PM is within the one-day grace (who came last night).
        expect(r.initial,).toBe('2026-10-20',);
        expect(r.choices[0]!.date < '2026-10-21',).toBe(true,);
        expect(r.choices.some((c,) => c.date === '2026-10-20',),).toBe(true,);
        expect(r.choices.length,).toBeLessThanOrEqual(120,);
    },);

    it('finished series → its last date', () => {
        const r = registrantDateChoices({
            startsAt: '2026-09-01T18:00:00Z', endsAt: null, allDay: false, timezone: 'UTC', recurrenceRule: 'weekly', recurrenceUntil: '2026-09-30T00:00:00Z',
        }, NOW,);
        expect(r.initial,).toBe('2026-09-29',);
    },);
},);
