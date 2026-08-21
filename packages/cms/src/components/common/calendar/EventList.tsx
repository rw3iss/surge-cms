/**
 * The vertical event list that sits beside the calendar grid. Shared by the
 * admin and public pages so the two can't present events differently.
 */
import { Component, For, Show, } from 'solid-js';
import type { EventOccurrence, } from '@sitesurge/types';
import './EventList.scss';

export interface EventListProps {
    occurrences: EventOccurrence[];
    mode?: 'admin' | 'public';
    /** Highlights the day the user picked in the grid. */
    selectedDate?: string | null;
    onSelect?: (occ: EventOccurrence,) => void;
    /** Admin only — renders the "Add Event" button at the top. */
    onAdd?: () => void;
    emptyMessage?: string;
}

/** e.g. "Tue 15 Sep · 6:00 PM". All-day events omit the time. */
function formatWhen(occ: EventOccurrence,): string {
    const d = new Date(occ.startsAt,);
    const date = d.toLocaleDateString('en-US', {
        weekday: 'short', day: 'numeric', month: 'short',
    },);
    if (occ.event.allDay) return `${date} · All day`;
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', },);
    return `${date} · ${time}`;
}

const EventList: Component<EventListProps> = (props,) => {
    const mode = () => props.mode ?? 'public';
    // Cancelled occurrences reach admin callers only; belt-and-braces here too
    // so a public page can't leak one by passing the admin payload.
    const visible = () => props.occurrences.filter((o,) => mode() === 'admin' || !o.cancelled);

    return (
        <aside class={`event-list event-list--${mode()}`}>
            <div class="event-list__head">
                <h2 class="event-list__title">Events</h2>
                <Show when={mode() === 'admin' && props.onAdd}>
                    <button type="button" class="ui-button ui-button--sm ui-button--primary" onClick={() => props.onAdd?.()}>
                        + Add Event
                    </button>
                </Show>
            </div>

            <Show
                when={visible().length > 0}
                fallback={
                    <p class="event-list__empty">
                        {props.emptyMessage ?? 'No events this month.'}
                    </p>
                }
            >
                <ul class="event-list__items">
                    <For each={visible()}>
                        {(occ,) => (
                            <li>
                                <button
                                    type="button"
                                    class={`event-list__item${
                                        props.selectedDate === occ.occurrenceDate
                                            ? ' event-list__item--selected' : ''
                                    }${occ.cancelled ? ' event-list__item--cancelled' : ''}`}
                                    onClick={() => props.onSelect?.(occ,)}
                                >
                                    <span class="event-list__when">{formatWhen(occ,)}</span>
                                    <span class="event-list__name">
                                        {occ.title}
                                        <Show when={occ.event.recurrenceRule}>
                                            <span class="event-list__badge" title="Repeating event">↻</span>
                                        </Show>
                                        <Show when={occ.cancelled}>
                                            <span class="event-list__badge event-list__badge--cancelled">
                                                Cancelled
                                            </span>
                                        </Show>
                                    </span>
                                    <Show when={occ.event.location}>
                                        <span class="event-list__meta">{occ.event.location}</span>
                                    </Show>
                                </button>
                            </li>
                        )}
                    </For>
                </ul>
            </Show>
        </aside>
    );
};

export default EventList;
