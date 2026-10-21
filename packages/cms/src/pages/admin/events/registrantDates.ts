/**
 * Which occurrence dates the admin's Registrations list can show for an event.
 *
 * A one-off event has one date. A series has one attendee list PER date, so the
 * modal offers a date picker: recent past dates (last 60 days, to see who came)
 * and the coming year, capped. The default is the next date that has not
 * started a day ago — the list an organiser usually wants. Pure (no DOM).
 */
import type { CalendarEvent, } from '@sitesurge/types';
import { expandOccurrences, parseRecurrenceRule, toOccurrenceDate, } from '@sitesurge/types';
import { formatEventWhen, } from '../../../utils/eventFormat';

const DAY_MS = 86_400_000;
/** Most dates offered in the picker. */
export const MAX_REGISTRANT_DATES = 120;

export interface RegistrantDateChoice {
    date: string;
    label: string;
}

type Source = Pick<CalendarEvent, 'startsAt' | 'endsAt' | 'allDay' | 'timezone' | 'recurrenceRule' | 'recurrenceUntil'>;

export function registrantDateChoices(event: Source, now: Date = new Date(),): { choices: RegistrantDateChoice[]; initial: string; } {
    const start = new Date(event.startsAt,);
    const own = toOccurrenceDate(start,);
    const rule = parseRecurrenceRule(event.recurrenceRule,);
    if (!rule || Number.isNaN(start.getTime(),)) return { choices: [], initial: own, };
    const occs = expandOccurrences({
        start,
        end: event.endsAt ? new Date(event.endsAt,) : null,
        rule,
        until: event.recurrenceUntil ? new Date(event.recurrenceUntil,) : null,
        windowStart: new Date(now.getTime() - 60 * DAY_MS,),
        windowEnd: new Date(now.getTime() + 366 * DAY_MS,),
        max: MAX_REGISTRANT_DATES,
    },);
    if (!occs.length) return { choices: [], initial: own, };
    const choices = occs.map((o,) => ({ date: o.date, label: formatEventWhen(o.start, event.allDay, event.timezone, 'medium',), }));
    const next = occs.find((o,) => o.start.getTime() >= now.getTime() - DAY_MS,);
    return { choices, initial: (next ?? occs[occs.length - 1]!).date, };
}
