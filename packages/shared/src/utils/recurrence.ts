/**
 * Recurrence rules for the events module.
 *
 * An event stores ONE row plus a rule; occurrences are expanded at read time.
 * That keeps "repeats forever" compact and lets a single edit change the whole
 * series — at the cost of this expansion logic, which is why it lives here as
 * pure functions with no I/O and is unit-tested against the nasty cases (DST,
 * month ends, leap days) before any UI depends on it.
 *
 * The rule is a deliberately small subset of iCal RRULE. We do not need the
 * full grammar, and a smaller surface is one we can actually test exhaustively.
 */

export type RecurrenceFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
    frequency: RecurrenceFrequency;
    /**
     * For `monthly`: which day-of-month to use. Defaults to the start date's.
     * A value that overflows a short month is CLAMPED (31 → 30 in April), not
     * skipped — skipping silently drops occurrences users expect to see.
     */
    dayOfMonth?: number;
}

/** Serialise to the compact string stored in `events.recurrence_rule`. */
export function formatRecurrenceRule(rule: RecurrenceRule | null,): string | null {
    if (!rule) return null;
    return rule.dayOfMonth ? `${rule.frequency}:${rule.dayOfMonth}` : rule.frequency;
}

/** Parse the stored string. Returns null for null/empty/unrecognised input —
 *  an unreadable rule must degrade to "single occurrence", never throw during
 *  a calendar render. */
export function parseRecurrenceRule(raw: string | null | undefined,): RecurrenceRule | null {
    if (!raw) return null;
    const [freq, day,] = raw.split(':',);
    const frequency = freq as RecurrenceFrequency;
    if (!['daily', 'weekly', 'biweekly', 'monthly', 'yearly',].includes(frequency,)) return null;
    const dayOfMonth = day ? Number(day,) : undefined;
    return {
        frequency,
        ...(dayOfMonth && Number.isFinite(dayOfMonth,) ? { dayOfMonth, } : {}),
    };
}

/** `YYYY-MM-DD` in UTC — the canonical occurrence key. */
export function toOccurrenceDate(d: Date,): string {
    return d.toISOString().slice(0, 10,);
}

/** Days in a given UTC month (1-indexed month). */
function daysInMonth(year: number, month: number,): number {
    return new Date(Date.UTC(year, month, 0,),).getUTCDate();
}

/**
 * Advance `from` by one step of `frequency`.
 *
 * Monthly/yearly clamp to the last day of the target month rather than rolling
 * into the next one — JS `setMonth` would turn 31 Jan + 1 month into 3 March,
 * which is never what a calendar user means.
 */
function advance(from: Date, rule: RecurrenceRule, anchorDay: number,): Date {
    const d = new Date(from.getTime(),);
    switch (rule.frequency) {
        case 'daily':
            d.setUTCDate(d.getUTCDate() + 1,);
            return d;
        case 'weekly':
            d.setUTCDate(d.getUTCDate() + 7,);
            return d;
        case 'biweekly':
            d.setUTCDate(d.getUTCDate() + 14,);
            return d;
        case 'monthly': {
            const y = d.getUTCFullYear();
            const m = d.getUTCMonth() + 1; // 0-indexed → next month, 1-indexed
            const year = m > 11 ? y + 1 : y;
            const month = (m % 12) + 1;
            const day = Math.min(anchorDay, daysInMonth(year, month,),);
            return new Date(Date.UTC(
                year, month - 1, day,
                d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(),
            ),);
        }
        case 'yearly': {
            const year = d.getUTCFullYear() + 1;
            const month = d.getUTCMonth() + 1;
            // 29 Feb in a non-leap year clamps to the 28th.
            const day = Math.min(anchorDay, daysInMonth(year, month,),);
            return new Date(Date.UTC(
                year, month - 1, day,
                d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(),
            ),);
        }
        default:
            // Unknown frequency: return a date past any window so expansion stops.
            return new Date(8640000000000000,);
    }
}

/** A single expanded instance of an event. */
export interface Occurrence {
    /** `YYYY-MM-DD` — the stable key used by registrations, tickets, overrides. */
    date: string;
    start: Date;
    end: Date | null;
}

export interface ExpandOptions {
    /** Series start (the event's own `startsAt`). */
    start: Date;
    /** Series end for a single occurrence, or the first occurrence's end. */
    end?: Date | null;
    rule: RecurrenceRule | null;
    /** Stop repeating after this instant. null = no limit. */
    until?: Date | null;
    /** Window to expand into — required, so "forever" is always bounded. */
    windowStart: Date;
    windowEnd: Date;
    /** Safety valve: never return more than this many occurrences. */
    max?: number;
}

const DEFAULT_MAX = 1000;

/**
 * Expand a (possibly recurring) event into the occurrences that fall inside
 * `[windowStart, windowEnd)`.
 *
 * Always bounded: a rule with no end date is only ever expanded across the
 * caller's window, so a "repeats forever" event cannot hang a calendar render.
 */
export function expandOccurrences(opts: ExpandOptions,): Occurrence[] {
    const { start, end = null, rule, until = null, windowStart, windowEnd, } = opts;
    const max = opts.max ?? DEFAULT_MAX;
    const durationMs = end ? Math.max(0, end.getTime() - start.getTime(),) : null;

    // Non-recurring: a single occurrence, included only if it overlaps.
    if (!rule) {
        const overlaps = start < windowEnd
            && (end ? end >= windowStart : start >= windowStart);
        return overlaps
            ? [{ date: toOccurrenceDate(start,), start, end, },]
            : [];
    }

    const anchorDay = rule.dayOfMonth ?? start.getUTCDate();
    const out: Occurrence[] = [];
    let cursor = new Date(start.getTime(),);
    let guard = 0;

    // Fast-forward to the window without emitting, so expanding a 5-year-old
    // daily series into next month doesn't build thousands of throwaway objects.
    while (cursor < windowStart && guard < 100000) {
        if (until && cursor > until) return out;
        const next = advance(cursor, rule, anchorDay,);
        if (next.getTime() <= cursor.getTime()) break; // never loop forever
        cursor = next;
        guard += 1;
    }

    while (cursor < windowEnd && out.length < max && guard < 100000) {
        if (until && cursor > until) break;
        const occEnd = durationMs === null ? null : new Date(cursor.getTime() + durationMs,);
        out.push({ date: toOccurrenceDate(cursor,), start: new Date(cursor.getTime(),), end: occEnd, },);
        const next = advance(cursor, rule, anchorDay,);
        if (next.getTime() <= cursor.getTime()) break;
        cursor = next;
        guard += 1;
    }

    return out;
}

/** A per-date exception to a series. */
export interface OccurrenceOverride {
    occurrenceDate: string;
    status?: 'cancelled' | 'moved' | null;
    startsAtOverride?: string | Date | null;
    endsAtOverride?: string | Date | null;
    titleOverride?: string | null;
}

export interface ResolvedOccurrence extends Occurrence {
    cancelled: boolean;
    titleOverride: string | null;
}

/**
 * Apply per-date overrides to expanded occurrences.
 *
 * Cancelled dates are RETAINED and flagged rather than dropped, because the
 * admin calendar must show "this week is cancelled" — the public surface is
 * what filters them out. Silently removing them here would make it impossible
 * to distinguish "cancelled" from "never existed".
 */
export function applyOverrides(
    occurrences: Occurrence[],
    overrides: OccurrenceOverride[],
): ResolvedOccurrence[] {
    const byDate = new Map(overrides.map((o,) => [o.occurrenceDate, o,]),);

    return occurrences.map((occ,) => {
        const o = byDate.get(occ.date,);
        if (!o) return { ...occ, cancelled: false, titleOverride: null, };

        const start = o.startsAtOverride ? new Date(o.startsAtOverride,) : occ.start;
        const end = o.endsAtOverride ? new Date(o.endsAtOverride,) : occ.end;
        return {
            date: occ.date,
            start,
            end,
            cancelled: o.status === 'cancelled',
            titleOverride: o.titleOverride ?? null,
        };
    },);
}

/** Human label for the admin/public UI, e.g. "Repeats weekly until 1 Jan 2027". */
export function describeRecurrence(
    rule: RecurrenceRule | null,
    until?: Date | string | null,
): string {
    if (!rule) return 'Does not repeat';
    const word: Record<RecurrenceFrequency, string> = {
        daily: 'daily',
        weekly: 'weekly',
        biweekly: 'every two weeks',
        monthly: 'monthly',
        yearly: 'yearly',
    };
    const base = `Repeats ${word[rule.frequency]}`;
    if (!until) return base;
    const d = typeof until === 'string' ? new Date(until,) : until;
    return `${base} until ${d.toLocaleDateString('en-US', { dateStyle: 'medium', },)}`;
}
