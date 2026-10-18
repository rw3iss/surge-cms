/**
 * Presentation helpers shared by every outbound event message.
 *
 * These live together because a notification, a registration confirmation and a
 * ticket confirmation must all describe the SAME event identically — three
 * copies of "how do we word a date" is how an email starts disagreeing with the
 * page it links to.
 */
import type { CalendarEvent, } from '@sitesurge/types';
import { config, } from '../../config';
import { getPublicSettings as getSitePublicSettings, } from '../settings';
import { getSettings, } from './settings';

/** Used when neither the event nor Settings → General names a zone. */
export const FALLBACK_TIME_ZONE = 'America/New_York';

/** Is `tz` an IANA zone this runtime understands? */
export function validZone(tz: string | null | undefined,): tz is string {
    if (!tz) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz, },);
        return true;
    } catch {
        return false;
    }
}

/**
 * The start of one occurrence. Occurrence keys are UTC dates (the recurrence
 * engine steps in UTC), so week 3 of a series is the series' UTC time of day
 * on that UTC date. No date = the series start.
 */
export function occurrenceStart(event: Pick<CalendarEvent, 'startsAt'>, occurrenceDate?: string | null,): Date {
    const start = new Date(event.startsAt,);
    if (!occurrenceDate || !/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate,)) return start;
    const d = new Date(`${occurrenceDate}T${start.toISOString().slice(11,)}`,);
    return Number.isNaN(d.getTime(),) ? start : d;
}

/**
 * The human-readable "when", honouring the event's all-day flag and time zone.
 * Without a `timeZone` the server's zone was used — on a UTC box a 7 pm ET
 * event read "11:00 PM".
 */
export function formatWhen(
    event: CalendarEvent,
    opts: { timeZone?: string | null; occurrenceDate?: string | null; } = {},
): string {
    const d = occurrenceStart(event, opts.occurrenceDate,);
    const timeZone = validZone(opts.timeZone,) ? opts.timeZone : validZone(event.timezone,) ? event.timezone : undefined;
    return event.allDay
        // An all-day event's date is its UTC key — never shift it a day.
        ? d.toLocaleDateString('en-US', { dateStyle: 'full', timeZone: 'UTC', },)
        : d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', ...(timeZone ? { timeZone, } : {}), },)
            + (timeZone ? ` (${shortZoneName(d, timeZone,)})` : '');
}

/** "EDT", "GMT+2" … for the zone at that instant. */
function shortZoneName(d: Date, timeZone: string,): string {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short', },)
        .formatToParts(d,).find((p,) => p.type === 'timeZoneName',);
    return part?.value ?? timeZone;
}

/** The zone an event is described in: its own, else the site default, else the fallback. */
export async function eventTimeZone(event: Pick<CalendarEvent, 'timezone'>,): Promise<string> {
    if (validZone(event.timezone,)) return event.timezone;
    try {
        const tz = (await getSitePublicSettings())?.defaults?.timezone;
        if (validZone(tz,)) return tz;
    } catch { /* fall through */ }
    return FALLBACK_TIME_ZONE;
}

/** `formatWhen` in the event's resolved zone — what every email uses. */
export async function describeWhen(event: CalendarEvent, occurrenceDate?: string | null,): Promise<string> {
    return formatWhen(event, { timeZone: await eventTimeZone(event,), occurrenceDate, },);
}

/** The public URL of an event's detail page under `basePath` (Settings → Events → URL). */
export function eventUrl(event: Pick<CalendarEvent, 'slug'>, basePath = '/events',): string {
    const base = `/${(basePath || '/events').replace(/^\/+|\/+$/g, '',)}`;
    return `${config.frontendUrl.replace(/\/+$/, '',)}${base}/${encodeURIComponent(event.slug,)}`;
}

/** `eventUrl` honouring the configurable public calendar path. */
export async function eventLink(event: Pick<CalendarEvent, 'slug'>,): Promise<string> {
    let basePath = '/events';
    try {
        basePath = (await getSettings()).eventsUrl || '/events';
    } catch { /* default */ }
    return eventUrl(event, basePath,);
}

/** Minimal escaping for values interpolated into our own email HTML. */
export function escapeHtml(s: string,): string {
    return s.replace(/&/g, '&amp;',).replace(/</g, '&lt;',).replace(/>/g, '&gt;',)
        .replace(/"/g, '&quot;',);
}
