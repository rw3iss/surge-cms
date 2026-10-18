/**
 * Event date formatting shared by the event page and the `event` block, so
 * both read the same: in the EVENT's time zone (a 7 pm ET event reads 7 pm
 * everywhere), an all-day event as a date only.
 */

/** The zone when the runtime knows it, else undefined (the viewer's zone). */
export function validTimeZone(tz?: string | null,): string | undefined {
    if (!tz) return undefined;
    try {
        Intl.DateTimeFormat('en-US', { timeZone: tz, },).resolvedOptions();
        return tz;
    } catch {
        return undefined;
    }
}

/**
 * "Sunday, October 18, 2026 at 7:00 PM EDT". All-day dates are stored as UTC
 * midnight, so they format in UTC to keep the calendar day.
 *
 * Explicit fields, not `dateStyle`/`timeStyle`: those cannot be combined with
 * `timeZoneName` (Intl throws "Invalid option"), which is how the event page
 * used to fail for every timed event with a zone.
 */
export function formatEventWhen(
    d: Date,
    allDay: boolean,
    tz?: string | null,
    style: 'full' | 'medium' = 'full',
): string {
    if (Number.isNaN(d.getTime(),)) return '';
    const date: Intl.DateTimeFormatOptions = style === 'full'
        ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', }
        : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', };
    if (allDay) return d.toLocaleDateString('en-US', { ...date, timeZone: 'UTC', },);
    const zone = validTimeZone(tz,);
    return d.toLocaleString('en-US', {
        ...date,
        hour: 'numeric',
        minute: '2-digit',
        ...(zone ? { timeZone: zone, timeZoneName: 'short', } : {}),
    },);
}

/** Plain-text excerpt: cut at a word boundary, with an ellipsis. */
export function excerptText(text: string, max = 200,): string {
    const t = text.replace(/\s+/g, ' ',).trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max,);
    const sp = cut.lastIndexOf(' ',);
    return `${(sp > max * 0.6 ? cut.slice(0, sp,) : cut).replace(/[\s.,;:!?-]+$/, '',)}…`;
}
