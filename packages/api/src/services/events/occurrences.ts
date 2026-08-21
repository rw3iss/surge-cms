/**
 * Turn stored events into calendar occurrences.
 *
 * This is the seam between the pure recurrence engine (shared/utils/recurrence)
 * and the database. Everything the calendar surfaces — admin and public — goes
 * through `expandEvents`, so the two can never disagree about which dates an
 * event falls on.
 */
import type {
    CalendarEvent,
    EventOccurrence,
    EventOccurrenceOverride,
} from '@sitesurge/types';
import {
    applyOverrides,
    expandOccurrences,
    monthGridWindow as sharedMonthGridWindow,
    parseRecurrenceRule,
} from '@sitesurge/types';

export interface ExpandWindow {
    /** Inclusive. */
    from: Date;
    /** Exclusive. */
    to: Date;
}

export interface ExpandOpts {
    /**
     * Admin surfaces KEEP cancelled occurrences (flagged) so a cancellation is
     * visible; public surfaces drop them. Defaults to public behaviour, which
     * is the safer default for a leak.
     */
    includeCancelled?: boolean;
    /** Cap per event, guarding a pathological daily rule over a decade. */
    maxPerEvent?: number;
}

/**
 * Expand one event into its occurrences inside the window.
 *
 * A non-recurring event yields at most one occurrence. A recurring one yields
 * every date its rule produces in range, with per-date overrides applied.
 */
export function expandEvent(
    event: CalendarEvent,
    overrides: EventOccurrenceOverride[],
    window: ExpandWindow,
    opts: ExpandOpts = {},
): EventOccurrence[] {
    const rule = parseRecurrenceRule(event.recurrenceRule,);

    const raw = expandOccurrences({
        start: new Date(event.startsAt,),
        end: event.endsAt ? new Date(event.endsAt,) : null,
        rule,
        until: event.recurrenceUntil ? new Date(event.recurrenceUntil,) : null,
        windowStart: window.from,
        windowEnd: window.to,
        ...(opts.maxPerEvent ? { max: opts.maxPerEvent, } : {}),
    },);

    const resolved = applyOverrides(
        raw,
        overrides.map((o,) => ({
            occurrenceDate: o.occurrenceDate,
            status: o.status,
            startsAtOverride: o.startsAtOverride,
            endsAtOverride: o.endsAtOverride,
            titleOverride: o.titleOverride,
        }),),
    );

    return resolved
        .filter((occ,) => opts.includeCancelled || !occ.cancelled)
        .map((occ,) => ({
            event,
            occurrenceDate: occ.date,
            startsAt: occ.start.toISOString(),
            endsAt: occ.end ? occ.end.toISOString() : null,
            cancelled: occ.cancelled,
            title: occ.titleOverride || event.title,
        }),);
}

/**
 * Expand many events and return a single date-sorted stream — what both the
 * calendar grid and the list column consume.
 */
export function expandEvents(
    events: CalendarEvent[],
    overridesByEvent: Map<string, EventOccurrenceOverride[]>,
    window: ExpandWindow,
    opts: ExpandOpts = {},
): EventOccurrence[] {
    const out: EventOccurrence[] = [];
    for (const event of events) {
        out.push(...expandEvent(event, overridesByEvent.get(event.id,) ?? [], window, opts,),);
    }
    out.sort((a, b,) => a.startsAt.localeCompare(b.startsAt,) || a.title.localeCompare(b.title,));
    return out;
}

/**
 * Group occurrences by `YYYY-MM-DD` for the month grid, which renders per day.
 * Doing this once here beats each cell filtering the whole list.
 */
export function groupByDate(occurrences: EventOccurrence[],): Record<string, EventOccurrence[]> {
    const out: Record<string, EventOccurrence[]> = {};
    for (const occ of occurrences) {
        (out[occ.occurrenceDate] ??= []).push(occ,);
    }
    return out;
}

/**
 * The window covering the month `year`/`month` (1-indexed) PLUS the leading and
 * trailing days the grid shows from adjacent months — otherwise events in those
 * visible cells would be missing.
 *
 * Delegates to the SHARED geometry so the server and the calendar UI can never
 * disagree about which window a month view covers; this wrapper only converts
 * the ISO strings to the Dates the expander works in.
 */
export function monthGridWindow(year: number, month: number,): ExpandWindow {
    const { from, to, } = sharedMonthGridWindow(year, month,);
    return { from: new Date(from,), to: new Date(to,), };
}
