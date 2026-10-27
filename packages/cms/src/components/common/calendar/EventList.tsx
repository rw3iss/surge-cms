/**
 * The vertical event list that sits beside the calendar grid. Shared by the
 * admin and public pages so the two can't present events differently. The
 * public list is split into collapsible Upcoming / Past sections (3 each,
 * "Show all" for the rest — `splitEventSections`); the admin list stays flat.
 */
import { Component, createMemo, createSignal, For, Show, } from 'solid-js';
import type { EventOccurrence, } from '@sitesurge/types';
import { stripMarkdown, } from '@sitesurge/types';
import { splitEventSections, } from './eventSections';
import './EventList.scss';

/** Items shown per section (public) before "Show all". */
const SECTION_LIMIT = 3;
import { eventLocationText, } from '@sitesurge/types';

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

/** A single line of plain text for the list, Markdown removed. */
function excerpt(description: string | null | undefined, max = 120,): string {
    const text = stripMarkdown(description,);
    return text.length > max ? `${text.slice(0, max - 1,).trimEnd()}…` : text;
}

const EventList: Component<EventListProps> = (props,) => {
    const mode = () => props.mode ?? 'public';
    // Cancelled occurrences reach admin callers only; belt-and-braces here too
    // so a public page can't leak one by passing the admin payload.
    const visible = () => props.occurrences.filter((o,) => mode() === 'admin' || !o.cancelled);
    const sections = createMemo(() => splitEventSections(visible(),),);

    const Item: Component<{ occ: EventOccurrence; }> = (p,) => (
        <li>
            <button
                type="button"
                class={`event-list__item${
                    props.selectedDate === p.occ.occurrenceDate
                        ? ' event-list__item--selected' : ''
                }${p.occ.cancelled ? ' event-list__item--cancelled' : ''}`}
                onClick={() => props.onSelect?.(p.occ,)}
            >
                <span class="event-list__when">{formatWhen(p.occ,)}</span>
                <span class="event-list__name">
                    {p.occ.title}
                    <Show when={p.occ.event.recurrenceRule}>
                        <span class="event-list__badge" title="Repeating event">↻</span>
                    </Show>
                    <Show when={p.occ.cancelled}>
                        <span class="event-list__badge event-list__badge--cancelled">
                            Cancelled
                        </span>
                    </Show>
                </span>
                <Show when={eventLocationText(p.occ.event,)}>
                    <span class="event-list__meta">{eventLocationText(p.occ.event,)}</span>
                </Show>
                {/* The brief view is a <button>, so it cannot hold
                    rendered block HTML — Markdown is reduced to a
                    one-line plain-text excerpt instead. */}
                <Show when={excerpt(p.occ.event.description,)}>
                    <span class="event-list__excerpt">
                        {excerpt(p.occ.event.description,)}
                    </span>
                </Show>
            </button>
        </li>
    );

    /** A collapsible section: SECTION_LIMIT items, then "Show all N". Hidden when empty. */
    const Section: Component<{ title: string; items: EventOccurrence[]; }> = (p,) => {
        const [open, setOpen,] = createSignal(true,);
        const [all, setAll,] = createSignal(false,);
        const shown = () => (all() ? p.items : p.items.slice(0, SECTION_LIMIT,));
        return (
            <Show when={p.items.length > 0}>
                <section class="event-list__section">
                    <button type="button" class="event-list__section-head" aria-expanded={open()} onClick={() => setOpen(!open(),)}>
                        <span class="event-list__chevron" classList={{ 'is-open': open(), }} aria-hidden="true">▸</span>
                        <span>{p.title}</span>
                        <span class="event-list__count">{p.items.length}</span>
                    </button>
                    <Show when={open()}>
                        <ul class="event-list__items">
                            <For each={shown()}>{(occ,) => <Item occ={occ} />}</For>
                        </ul>
                        <Show when={p.items.length > SECTION_LIMIT}>
                            <button type="button" class="event-list__more" onClick={() => setAll(!all(),)}>
                                {all() ? 'Show fewer' : `Show all ${p.items.length}`}
                            </button>
                        </Show>
                    </Show>
                </section>
            </Show>
        );
    };

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
                <Show
                    when={mode() === 'public'}
                    fallback={<ul class="event-list__items"><For each={visible()}>{(occ,) => <Item occ={occ} />}</For></ul>}
                >
                    {/* Public: Upcoming (soonest first), then Past (newest first) — 3 each,
                        "Show all" for the rest; each section collapses. */}
                    <Section title="Upcoming" items={sections().upcoming} />
                    <Section title="Past" items={sections().past} />
                </Show>
            </Show>
        </aside>
    );
};

export default EventList;
