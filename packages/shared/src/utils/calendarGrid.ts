/**
 * Month-grid geometry — the single definition used by EVERY calendar surface.
 *
 * There were three copies of "six weeks from the Sunday on or before the 1st":
 * the admin page, the public page, and the server's occurrence expander. If one
 * drifts, the grid and the data fetched for it disagree about which window they
 * cover, and events silently vanish from the leading/trailing cells.
 *
 * It lives in `@sitesurge/types` because that is the one package both the API
 * and the admin/public SPA already depend on — the geometry is shared logic,
 * not a UI concern.
 */

export const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',];

/** Six full weeks — a fixed height, so the grid doesn't jump a row between
 *  months and shift everything below it. */
export const GRID_DAYS = 42;

/** `YYYY-MM-DD` for a UTC date — the canonical occurrence key. */
export function dateKey(d: Date,): string {
    return d.toISOString().slice(0, 10,);
}

/** The Sunday on or before the 1st of `year`/`month` (1-indexed month). */
export function gridStart(year: number, month: number,): Date {
    const first = new Date(Date.UTC(year, month - 1, 1,),);
    const start = new Date(first,);
    start.setUTCDate(start.getUTCDate() - first.getUTCDay(),);
    return start;
}

/** The 42 dates a month grid renders, including adjacent-month days. */
export function monthGridDays(year: number, month: number,): Date[] {
    const start = gridStart(year, month,);
    return Array.from({ length: GRID_DAYS, }, (_, i,) => {
        const d = new Date(start,);
        d.setUTCDate(d.getUTCDate() + i,);
        return d;
    },);
}

/**
 * The ISO window to FETCH for a month view. Must match `monthGridDays`, or
 * events in the visible leading/trailing cells wouldn't be loaded.
 */
export function monthGridWindow(year: number, month: number,): { from: string; to: string; } {
    const from = gridStart(year, month,);
    const to = new Date(from,);
    to.setUTCDate(to.getUTCDate() + GRID_DAYS,);
    return { from: from.toISOString(), to: to.toISOString(), };
}

/** Step a month cursor by ±1, rolling the year. */
export function stepMonth(
    year: number, month: number, delta: number,
): { year: number; month: number; } {
    const m = month + delta;
    if (m < 1) return { year: year - 1, month: 12, };
    if (m > 12) return { year: year + 1, month: 1, };
    return { year, month: m, };
}

/** ±10 years around today, for the admin year picker. */
export function yearOptions(span = 10,): number[] {
    const now = new Date().getFullYear();
    return Array.from({ length: span * 2 + 1, }, (_, i,) => now - span + i);
}
