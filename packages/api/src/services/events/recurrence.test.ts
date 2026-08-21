import { describe, expect, it, } from 'vitest';
import {
    applyOverrides,
    describeRecurrence,
    expandOccurrences,
    formatRecurrenceRule,
    parseRecurrenceRule,
    toOccurrenceDate,
} from '@sitesurge/types';

/**
 * The recurrence engine is the highest-risk logic in the events module: every
 * calendar view, registration and ticket-inventory decision is keyed on the
 * occurrence dates it produces. It is pure (no I/O) precisely so it can be
 * tested against the cases that break naive implementations — month-end
 * overflow, leap days, unbounded rules, and per-date exceptions.
 */

const d = (iso: string,) => new Date(iso,);

describe('rule parse/format round-trip', () => {
    it('round-trips a simple frequency', () => {
        expect(parseRecurrenceRule('weekly',),).toEqual({ frequency: 'weekly', },);
        expect(formatRecurrenceRule({ frequency: 'weekly', },),).toBe('weekly',);
    },);

    it('round-trips a monthly rule with an anchor day', () => {
        expect(parseRecurrenceRule('monthly:31',),).toEqual({ frequency: 'monthly', dayOfMonth: 31, },);
        expect(formatRecurrenceRule({ frequency: 'monthly', dayOfMonth: 31, },),).toBe('monthly:31',);
    },);

    it('degrades to null rather than throwing on bad input', () => {
        // An unreadable rule must render as a single occurrence, not crash a
        // calendar page.
        for (const bad of ['', null, undefined, 'hourly', 'nonsense:9',]) {
            expect(parseRecurrenceRule(bad,),).toBeNull();
        }
    },);
},);

describe('expandOccurrences — non-recurring', () => {
    it('returns the single occurrence when it falls in the window', () => {
        const out = expandOccurrences({
            start: d('2026-09-15T18:00:00Z',),
            rule: null,
            windowStart: d('2026-09-01T00:00:00Z',),
            windowEnd: d('2026-10-01T00:00:00Z',),
        },);
        expect(out,).toHaveLength(1,);
        expect(out[0].date,).toBe('2026-09-15',);
    },);

    it('excludes an occurrence outside the window', () => {
        const out = expandOccurrences({
            start: d('2026-11-15T18:00:00Z',),
            rule: null,
            windowStart: d('2026-09-01T00:00:00Z',),
            windowEnd: d('2026-10-01T00:00:00Z',),
        },);
        expect(out,).toEqual([],);
    },);

    it('includes a multi-day event that STARTED before the window but is still running', () => {
        // Without this, a conference spanning a month boundary vanishes from
        // the later month's calendar.
        const out = expandOccurrences({
            start: d('2026-08-28T09:00:00Z',),
            end: d('2026-09-03T17:00:00Z',),
            rule: null,
            windowStart: d('2026-09-01T00:00:00Z',),
            windowEnd: d('2026-10-01T00:00:00Z',),
        },);
        expect(out,).toHaveLength(1,);
    },);
},);

describe('expandOccurrences — weekly', () => {
    it('produces one occurrence per week inside the window', () => {
        const out = expandOccurrences({
            start: d('2026-09-01T18:00:00Z',), // a Tuesday
            rule: { frequency: 'weekly', },
            windowStart: d('2026-09-01T00:00:00Z',),
            windowEnd: d('2026-10-01T00:00:00Z',),
        },);
        expect(out.map((o,) => o.date),).toEqual([
            '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29',
        ],);
    },);

    it('stops at `until`', () => {
        const out = expandOccurrences({
            start: d('2026-09-01T18:00:00Z',),
            rule: { frequency: 'weekly', },
            until: d('2026-09-16T00:00:00Z',),
            windowStart: d('2026-09-01T00:00:00Z',),
            windowEnd: d('2026-10-01T00:00:00Z',),
        },);
        expect(out.map((o,) => o.date),).toEqual(['2026-09-01', '2026-09-08', '2026-09-15',],);
    },);

    it('preserves each occurrence duration', () => {
        const out = expandOccurrences({
            start: d('2026-09-01T18:00:00Z',),
            end: d('2026-09-01T20:30:00Z',),
            rule: { frequency: 'weekly', },
            windowStart: d('2026-09-01T00:00:00Z',),
            windowEnd: d('2026-09-20T00:00:00Z',),
        },);
        for (const occ of out) {
            expect(occ.end!.getTime() - occ.start.getTime(),).toBe(2.5 * 60 * 60 * 1000,);
        }
    },);

    it('does not emit occurrences from before the window', () => {
        // A series that started years ago must fast-forward, not replay.
        const out = expandOccurrences({
            start: d('2020-01-07T18:00:00Z',),
            rule: { frequency: 'weekly', },
            windowStart: d('2026-09-01T00:00:00Z',),
            windowEnd: d('2026-10-01T00:00:00Z',),
        },);
        expect(out.length,).toBeGreaterThan(3,);
        expect(out.every((o,) => o.date >= '2026-09-01'),).toBe(true,);
    },);
},);

describe('expandOccurrences — monthly month-end clamping', () => {
    it('clamps the 31st to the last day of shorter months', () => {
        // Naive setMonth() turns 31 Jan + 1 month into 3 March. A calendar user
        // means "the last day of February".
        const out = expandOccurrences({
            start: d('2026-01-31T12:00:00Z',),
            rule: { frequency: 'monthly', dayOfMonth: 31, },
            windowStart: d('2026-01-01T00:00:00Z',),
            windowEnd: d('2026-05-01T00:00:00Z',),
        },);
        expect(out.map((o,) => o.date),).toEqual([
            '2026-01-31',
            '2026-02-28',
            '2026-03-31',
            '2026-04-30',
        ],);
    },);

    it('handles 29 February in a non-leap year', () => {
        const out = expandOccurrences({
            start: d('2024-02-29T12:00:00Z',), // 2024 is a leap year
            rule: { frequency: 'yearly', },
            windowStart: d('2024-01-01T00:00:00Z',),
            windowEnd: d('2026-06-01T00:00:00Z',),
        },);
        expect(out.map((o,) => o.date),).toEqual(['2024-02-29', '2025-02-28', '2026-02-28',],);
    },);
},);

describe('expandOccurrences — safety', () => {
    it('bounds an unlimited rule to the requested window', () => {
        // "Repeats forever" must never hang a render.
        const out = expandOccurrences({
            start: d('2026-01-01T00:00:00Z',),
            rule: { frequency: 'daily', },
            until: null,
            windowStart: d('2026-09-01T00:00:00Z',),
            windowEnd: d('2026-10-01T00:00:00Z',),
        },);
        expect(out,).toHaveLength(30,);
    },);

    it('respects an explicit max', () => {
        const out = expandOccurrences({
            start: d('2026-09-01T00:00:00Z',),
            rule: { frequency: 'daily', },
            windowStart: d('2026-09-01T00:00:00Z',),
            windowEnd: d('2027-09-01T00:00:00Z',),
            max: 10,
        },);
        expect(out,).toHaveLength(10,);
    },);
},);

describe('applyOverrides', () => {
    const base = expandOccurrences({
        start: d('2026-09-01T18:00:00Z',),
        rule: { frequency: 'weekly', },
        windowStart: d('2026-09-01T00:00:00Z',),
        windowEnd: d('2026-10-01T00:00:00Z',),
    },);

    it('flags a cancelled date but KEEPS it in the list', () => {
        // The admin calendar must be able to show "cancelled"; only the public
        // surface filters. Dropping it here would erase that distinction.
        const out = applyOverrides(base, [
            { occurrenceDate: '2026-09-15', status: 'cancelled', },
        ],);
        expect(out,).toHaveLength(base.length,);
        expect(out.find((o,) => o.date === '2026-09-15')!.cancelled,).toBe(true,);
        expect(out.filter((o,) => o.cancelled).length,).toBe(1,);
    },);

    it('applies a moved time to one occurrence only', () => {
        const out = applyOverrides(base, [
            { occurrenceDate: '2026-09-08', status: 'moved', startsAtOverride: '2026-09-08T21:00:00Z', },
        ],);
        expect(out.find((o,) => o.date === '2026-09-08')!.start.toISOString(),)
            .toBe('2026-09-08T21:00:00.000Z',);
        expect(out.find((o,) => o.date === '2026-09-01')!.start.toISOString(),)
            .toBe('2026-09-01T18:00:00.000Z',);
    },);

    it('applies a per-date title override', () => {
        const out = applyOverrides(base, [
            { occurrenceDate: '2026-09-22', titleOverride: 'Special guest', },
        ],);
        expect(out.find((o,) => o.date === '2026-09-22')!.titleOverride,).toBe('Special guest',);
        expect(out.find((o,) => o.date === '2026-09-01')!.titleOverride,).toBeNull();
    },);

    it('leaves occurrences untouched when there are no overrides', () => {
        expect(applyOverrides(base, [],).every((o,) => !o.cancelled),).toBe(true,);
    },);
},);

describe('helpers', () => {
    it('formats the occurrence key as YYYY-MM-DD', () => {
        expect(toOccurrenceDate(d('2026-09-15T23:30:00Z',),),).toBe('2026-09-15',);
    },);

    it('describes a rule for the UI', () => {
        expect(describeRecurrence(null,),).toBe('Does not repeat',);
        expect(describeRecurrence({ frequency: 'biweekly', },),).toBe('Repeats every two weeks',);
        expect(describeRecurrence({ frequency: 'weekly', }, '2027-01-01T00:00:00Z',),)
            .toContain('until',);
    },);
},);
