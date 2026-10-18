/**
 * Is this date a real, open occurrence of the event?
 *
 * Register and ticket purchase used to accept ANY `YYYY-MM-DD`: a date the
 * series never falls on, a cancelled one, a past one. Capacity is per
 * occurrence, so a made-up date even came with a fresh, full capacity.
 *
 * Runs through the same expansion as the calendar (`expandEvent`) so the two
 * can never disagree about which dates exist.
 */
import type { CalendarEvent, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import * as repo from '../../repositories/events.repo';
import { expandEvent, } from './occurrences';

const DAY_MS = 86_400_000;

export type OccurrenceProblem = 'invalid' | 'not_an_occurrence' | 'cancelled' | 'past';

/** Why `date` cannot be booked, or null when it can. Pure apart from the overrides read. */
export async function occurrenceProblem(
    event: CalendarEvent,
    date: string,
    now: Date = new Date(),
): Promise<OccurrenceProblem | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date,)) return 'invalid';
    const day = new Date(`${date}T00:00:00.000Z`,);
    if (Number.isNaN(day.getTime(),)) return 'invalid';

    const overrides = (await repo.findOverridesForEvents([event.id,],)).get(event.id,) ?? [];
    const occ = expandEvent(
        event,
        overrides,
        // A day either side: a non-recurring multi-day event overlaps by range.
        { from: new Date(day.getTime() - DAY_MS,), to: new Date(day.getTime() + 2 * DAY_MS,), },
        { includeCancelled: true, },
    ).find((o,) => o.occurrenceDate === date);

    if (!occ) return 'not_an_occurrence';
    if (occ.cancelled) return 'cancelled';

    // Bookable until it is over: its end, else (all-day / open-ended) the end of its day.
    const endsAt = occ.endsAt
        ? new Date(occ.endsAt,)
        : event.allDay ? new Date(day.getTime() + DAY_MS,) : new Date(occ.startsAt,);
    if (endsAt.getTime() < now.getTime()) return 'past';
    return null;
}

const MESSAGES: Record<OccurrenceProblem, string> = {
    invalid: 'Please choose a valid date.',
    not_an_occurrence: 'That date is not one of this event\'s dates.',
    cancelled: 'That date has been cancelled.',
    past: 'That date has already passed.',
};

/** Throw a ValidationError unless `date` is a bookable occurrence of `event`. */
export async function assertBookableOccurrence(event: CalendarEvent, date: string, now?: Date,): Promise<void> {
    const problem = await occurrenceProblem(event, date, now,);
    if (problem) throw new ValidationError(MESSAGES[problem],);
}

/**
 * The next occurrence that has not ended (cancelled dates skipped), or the
 * series start when none remains — what a sign-up lands on when the caller
 * did not name a date. Looks a year ahead.
 */
export async function nextOccurrenceDate(event: CalendarEvent, now: Date = new Date(),): Promise<string> {
    const overrides = (await repo.findOverridesForEvents([event.id,],)).get(event.id,) ?? [];
    const from = new Date(now.getTime() - 2 * DAY_MS,);
    const occs = expandEvent(event, overrides, { from, to: new Date(now.getTime() + 366 * DAY_MS,), }, { maxPerEvent: 400, },);
    const open = occs.find((o,) => {
        const end = o.endsAt ? new Date(o.endsAt,) : event.allDay
            ? new Date(new Date(`${o.occurrenceDate}T00:00:00.000Z`,).getTime() + DAY_MS,)
            : new Date(o.startsAt,);
        return end.getTime() >= now.getTime();
    },);
    if (open) return open.occurrenceDate;
    const start = event.startsAt as unknown;
    return (start instanceof Date ? start.toISOString() : String(start,)).slice(0, 10,);
}
