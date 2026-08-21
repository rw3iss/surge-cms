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

/** The human-readable "when", honouring the event's all-day flag. */
export function formatWhen(event: CalendarEvent,): string {
    const d = new Date(event.startsAt,);
    return event.allDay
        ? d.toLocaleDateString('en-US', { dateStyle: 'full', },)
        : d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', },);
}

/** The public URL of an event's detail page. */
export function eventUrl(event: CalendarEvent,): string {
    return `${config.frontendUrl.replace(/\/+$/, '',)}/events/${event.slug}`;
}

/** Minimal escaping for values interpolated into our own email HTML. */
export function escapeHtml(s: string,): string {
    return s.replace(/&/g, '&amp;',).replace(/</g, '&lt;',).replace(/>/g, '&gt;',)
        .replace(/"/g, '&quot;',);
}
