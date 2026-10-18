/**
 * Event teaser card — image, title, date/time (in the event's time zone),
 * location, a short excerpt and a link to the event page. Rendered by the
 * `event` content block.
 */
import type { CalendarEvent, } from '@sitesurge/types';
import { describeRecurrence, featuredImageAlt, featuredImagePath, parseRecurrenceRule, stripMarkdown, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, Show, } from 'solid-js';
import { excerptText, formatEventWhen, } from '../../utils/eventFormat';
import './EventCard.scss';

export interface EventCardProps {
    event: CalendarEvent;
    /** The occurrence shown (a recurring series' next date); default = the event's start. */
    occurrence?: { startsAt: string; occurrenceDate: string; } | null;
    /** Optional heading above the card. */
    heading?: string;
    showImage?: boolean;
    showDescription?: boolean;
    showLocation?: boolean;
}

/** `/events/<slug>` — the date rides along for a recurring series, so the
 *  sign-up card opens on the date the visitor saw. */
export function eventHref(event: Pick<CalendarEvent, 'id' | 'slug'>, occurrenceDate?: string | null,): string {
    const base = `/events/${encodeURIComponent(event.slug || event.id,)}`;
    return occurrenceDate ? `${base}?date=${encodeURIComponent(occurrenceDate,)}` : base;
}

const EventCard: Component<EventCardProps> = (props,) => {
    const image = () => (props.showImage !== false ? featuredImagePath(props.event,) : null);
    const when = () =>
        formatEventWhen(new Date(props.occurrence?.startsAt ?? props.event.startsAt,), props.event.allDay, props.event.timezone,);
    const repeat = () =>
        props.event.recurrenceRule
            ? describeRecurrence(parseRecurrenceRule(props.event.recurrenceRule,), props.event.recurrenceUntil,)
            : '';
    // A plain-text excerpt: the description is Markdown, and block HTML inside
    // a link is invalid.
    const excerpt = () => (props.showDescription !== false ? excerptText(stripMarkdown(props.event.description,), 220,) : '');
    const href = () => eventHref(props.event, props.event.recurrenceRule ? props.occurrence?.occurrenceDate : null,);

    return (
        <div class="event-card-block">
            <Show when={props.heading}>
                <h2 class="event-card-block__heading">{props.heading}</h2>
            </Show>
            <A href={href()} class="event-card" classList={{ 'event-card--with-image': !!image(), }}>
                <Show when={image()}>
                    <img class="event-card__image" src={image()!} alt={featuredImageAlt(props.event, props.event.title,)} loading="lazy" />
                </Show>
                <div class="event-card__body">
                    <h3 class="event-card__title">{props.event.title}</h3>
                    <p class="event-card__when">{when()}</p>
                    <Show when={repeat()}>
                        <p class="event-card__meta">{repeat()}</p>
                    </Show>
                    <Show when={props.showLocation !== false && props.event.location}>
                        <p class="event-card__meta">{props.event.location}</p>
                    </Show>
                    <Show when={excerpt()}>
                        <p class="event-card__excerpt">{excerpt()}</p>
                    </Show>
                    <span class="event-card__link">View event →</span>
                </div>
            </A>
        </div>
    );
};

export default EventCard;
