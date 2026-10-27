import { describe, expect, it, } from 'vitest';
import type { EventOccurrence, } from '@sitesurge/types';
import { splitEventSections, } from './eventSections';

const occ = (title: string, startsAt: string, endsAt: string | null = null,) =>
    ({ title, startsAt, endsAt, occurrenceDate: startsAt.slice(0, 10,), cancelled: false, event: {}, }) as unknown as EventOccurrence;

describe('splitEventSections', () => {
    const now = Date.parse('2026-10-15T12:00:00Z',);
    it('splits by end time: past newest first, upcoming soonest first', () => {
        const s = splitEventSections([
            occ('a', '2026-10-01T10:00:00Z',), occ('b', '2026-10-10T10:00:00Z',), occ('c', '2026-10-20T10:00:00Z',),
            occ('live', '2026-10-15T10:00:00Z', '2026-10-15T14:00:00Z',), occ('d', '2026-10-17T10:00:00Z',),
        ], now,);
        expect(s.past.map((o,) => o.title),).toEqual(['b', 'a',],);
        expect(s.upcoming.map((o,) => o.title),).toEqual(['live', 'd', 'c',],);
    },);
},);
