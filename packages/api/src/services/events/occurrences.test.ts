import { describe, expect, it, } from 'vitest';
import type { CalendarEvent, EventOccurrenceOverride, } from '@sitesurge/types';
import { expandEvent, expandEvents, groupByDate, monthGridWindow, } from './occurrences';

/**
 * These cover the DB-facing seam: the pure engine is already tested, so what
 * matters here is that admin and public surfaces differ ONLY in whether
 * cancelled dates are retained, and that the month window includes the adjacent
 * days a grid actually renders.
 */

function ev(over: Partial<CalendarEvent> = {},): CalendarEvent {
    return {
        id: 'e1', title: 'Town Hall', slug: 'town-hall', description: null,
        startsAt: '2026-09-01T18:00:00.000Z', endsAt: null, allDay: false,
        location: null, url: null, featuredImage: null, status: 'published',
        timezone: 'America/New_York', recurrenceRule: null, recurrenceUntil: null,
        registrationEnabled: false, registrationFields: ['name', 'email',],
        showRegistrantCount: false, ticketingEnabled: false, metadata: {},
        createdBy: null, createdAt: '', updatedAt: '',
        ...over,
    };
}

const WINDOW = { from: new Date('2026-09-01T00:00:00Z',), to: new Date('2026-10-01T00:00:00Z',), };

describe('expandEvent', () => {
    it('yields exactly one occurrence for a non-recurring event', () => {
        const out = expandEvent(ev(), [], WINDOW,);
        expect(out,).toHaveLength(1,);
        expect(out[0].occurrenceDate,).toBe('2026-09-01',);
        expect(out[0].title,).toBe('Town Hall',);
    },);

    it('yields one occurrence per week for a weekly rule', () => {
        const out = expandEvent(ev({ recurrenceRule: 'weekly', },), [], WINDOW,);
        expect(out.map((o,) => o.occurrenceDate),).toEqual([
            '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29',
        ],);
    },);

    it('HIDES a cancelled date from public surfaces by default', () => {
        const overrides: EventOccurrenceOverride[] = [{
            id: 'o1', eventId: 'e1', occurrenceDate: '2026-09-15', status: 'cancelled',
            startsAtOverride: null, endsAtOverride: null, titleOverride: null,
        },];
        const out = expandEvent(ev({ recurrenceRule: 'weekly', },), overrides, WINDOW,);
        expect(out.map((o,) => o.occurrenceDate),).not.toContain('2026-09-15',);
        expect(out,).toHaveLength(4,);
    },);

    it('KEEPS a cancelled date, flagged, for admin surfaces', () => {
        // The admin must be able to see that a week was cancelled; dropping it
        // would make "cancelled" indistinguishable from "never scheduled".
        const overrides: EventOccurrenceOverride[] = [{
            id: 'o1', eventId: 'e1', occurrenceDate: '2026-09-15', status: 'cancelled',
            startsAtOverride: null, endsAtOverride: null, titleOverride: null,
        },];
        const out = expandEvent(
            ev({ recurrenceRule: 'weekly', },), overrides, WINDOW, { includeCancelled: true, },
        );
        expect(out,).toHaveLength(5,);
        expect(out.find((o,) => o.occurrenceDate === '2026-09-15')!.cancelled,).toBe(true,);
    },);

    it('applies a per-date title override to that date only', () => {
        const overrides: EventOccurrenceOverride[] = [{
            id: 'o1', eventId: 'e1', occurrenceDate: '2026-09-08', status: null,
            startsAtOverride: null, endsAtOverride: null, titleOverride: 'Budget special',
        },];
        const out = expandEvent(ev({ recurrenceRule: 'weekly', },), overrides, WINDOW,);
        expect(out.find((o,) => o.occurrenceDate === '2026-09-08')!.title,).toBe('Budget special',);
        expect(out.find((o,) => o.occurrenceDate === '2026-09-01')!.title,).toBe('Town Hall',);
    },);

    it('stops at recurrenceUntil', () => {
        const out = expandEvent(
            ev({ recurrenceRule: 'weekly', recurrenceUntil: '2026-09-16T00:00:00.000Z', },),
            [], WINDOW,
        );
        expect(out.map((o,) => o.occurrenceDate),).toEqual([
            '2026-09-01', '2026-09-08', '2026-09-15',
        ],);
    },);
},);

describe('expandEvents', () => {
    it('merges multiple events into one date-sorted stream', () => {
        const a = ev({ id: 'a', title: 'A', startsAt: '2026-09-10T10:00:00.000Z', },);
        const b = ev({ id: 'b', title: 'B', startsAt: '2026-09-05T10:00:00.000Z', },);
        const out = expandEvents([a, b,], new Map(), WINDOW,);
        expect(out.map((o,) => o.title),).toEqual(['B', 'A',],);
    },);

    it('applies each event its OWN overrides', () => {
        const a = ev({ id: 'a', title: 'A', recurrenceRule: 'weekly', },);
        const b = ev({ id: 'b', title: 'B', recurrenceRule: 'weekly', },);
        const overrides = new Map<string, EventOccurrenceOverride[]>([
            ['a', [{
                id: 'o', eventId: 'a', occurrenceDate: '2026-09-08', status: 'cancelled',
                startsAtOverride: null, endsAtOverride: null, titleOverride: null,
            },],],
        ],);
        const out = expandEvents([a, b,], overrides, WINDOW,);
        const onThatDay = out.filter((o,) => o.occurrenceDate === '2026-09-08');
        expect(onThatDay.map((o,) => o.title),).toEqual(['B',],);
    },);
},);

describe('groupByDate', () => {
    it('buckets occurrences by their date key', () => {
        const out = expandEvent(ev({ recurrenceRule: 'weekly', },), [], WINDOW,);
        const grouped = groupByDate(out,);
        expect(Object.keys(grouped,).sort(),).toEqual([
            '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29',
        ],);
        expect(grouped['2026-09-01'],).toHaveLength(1,);
    },);
},);

describe('monthGridWindow', () => {
    it('starts on the Sunday on or before the 1st and spans six weeks', () => {
        // The grid renders leading/trailing days from adjacent months; events in
        // those visible cells must be fetched too.
        const w = monthGridWindow(2026, 9,); // 1 Sep 2026 is a Tuesday
        expect(w.from.toISOString().slice(0, 10,),).toBe('2026-08-30',); // Sunday
        const days = (w.to.getTime() - w.from.getTime()) / 86400000;
        expect(days,).toBe(42,);
    },);

    it('handles a month starting exactly on Sunday', () => {
        const w = monthGridWindow(2026, 11,); // 1 Nov 2026 is a Sunday
        expect(w.from.toISOString().slice(0, 10,),).toBe('2026-11-01',);
    },);
},);
