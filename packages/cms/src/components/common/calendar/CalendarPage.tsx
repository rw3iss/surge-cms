/**
 * The calendar page shell: month state, data fetching, navigation and the
 * two-column grid/list layout.
 *
 * Both calendar surfaces were duplicating all of this — 153 differing lines
 * across two ~130-line files that shared the same month cursor, the same
 * `createResource` over the same window, the same prev/next stepping and the
 * same layout. Only the *components* had been shared, not the shell around
 * them, which is how the two would have drifted.
 *
 * The admin keeps what is genuinely admin-only in its own page: the URL-routed
 * modal, the year dropdown and the Add button, injected here via `toolbar`.
 */
import { Component, JSX, Show, createResource, createSignal, } from 'solid-js';
import type { EventOccurrence, } from '@sitesurge/types';
import { monthGridWindow, MONTHS, stepMonth, } from './calendarGrid';
import Calendar from './Calendar';
import EventList from './EventList';
import { cms, } from '../../../services/cmsClient';
import './CalendarPage.scss';

export interface CalendarPageProps {
    /** `admin` enables day selection, double-click-to-create and cancelled styling. */
    mode: 'admin' | 'public';
    onSelectOccurrence: (occ: EventOccurrence,) => void;
    /** Admin only — renders the "Add Event" button in the list column. */
    onAdd?: (selectedDate: string | null,) => void;
    /** Admin only — double-clicking a day. */
    onCreateOn?: (date: string,) => void;
    /**
     * Extra controls rendered in the toolbar, receiving the live month cursor
     * so a caller can add e.g. a year dropdown without this shell knowing
     * anything about it.
     */
    toolbar?: (ctx: CalendarCursor,) => JSX.Element;
    /** Bumping this refetches — the admin uses it after a save or delete. */
    refreshKey?: number;
    emptyMessage?: string;
    class?: string;
}

/** The month cursor handed to a caller's toolbar slot. */
export interface CalendarCursor {
    year: number;
    month: number;
    setYear: (y: number,) => void;
    setMonth: (m: number,) => void;
    loading: boolean;
}

const CalendarPage: Component<CalendarPageProps> = (props,) => {
    const today = new Date();
    const [year, setYear,] = createSignal(today.getFullYear(),);
    const [month, setMonth,] = createSignal(today.getMonth() + 1,);
    const [selectedDate, setSelectedDate,] = createSignal<string | null>(null,);

    const [occurrences] = createResource(
        () => ({ ...monthGridWindow(year(), month(),), k: props.refreshKey ?? 0, }),
        async (w,) => {
            try {
                return await cms.events.calendar({ from: w.from, to: w.to, },);
            } catch {
                // A calendar that fails to load should render empty, not blank
                // the whole page — the month controls stay usable.
                return [] as EventOccurrence[];
            }
        },
    );

    const step = (delta: number,) => {
        const next = stepMonth(year(), month(), delta,);
        setYear(next.year,); setMonth(next.month,);
    };

    const goToday = () => {
        const n = new Date();
        setYear(n.getFullYear(),); setMonth(n.getMonth() + 1,);
    };

    const cursor = (): CalendarCursor => ({
        year: year(), month: month(), setYear, setMonth,
        loading: occurrences.loading,
    });

    return (
        <div class={`calendar-page calendar-page--${props.mode} ${props.class ?? ''}`}>
            <div class="calendar-page__toolbar">
                <button
                    type="button" class="calendar-page__nav-btn"
                    onClick={() => step(-1,)} aria-label="Previous month"
                >‹</button>

                <Show
                    when={props.toolbar}
                    fallback={<span class="calendar-page__month">{MONTHS[month() - 1]} {year()}</span>}
                >
                    {props.toolbar!(cursor(),)}
                </Show>

                <button
                    type="button" class="calendar-page__nav-btn"
                    onClick={() => step(1,)} aria-label="Next month"
                >›</button>
                <button type="button" class="calendar-page__today" onClick={goToday}>Today</button>

                <Show when={occurrences.loading}>
                    <span class="calendar-page__loading">Loading…</span>
                </Show>
            </div>

            <div class="calendar-page__layout">
                <div class="calendar-page__calendar">
                    <Calendar
                        mode={props.mode}
                        year={year()}
                        month={month()}
                        occurrences={occurrences() ?? []}
                        selectedDate={selectedDate()}
                        onSelectDate={setSelectedDate}
                        onCreateOn={props.onCreateOn}
                        onSelectOccurrence={props.onSelectOccurrence}
                    />
                    <Show when={props.mode === 'admin'}>
                        <p class="calendar-page__hint">
                            Click a day to select it, or double-click to add an event on that day.
                        </p>
                    </Show>
                </div>

                <EventList
                    mode={props.mode}
                    occurrences={occurrences() ?? []}
                    selectedDate={selectedDate()}
                    onSelect={props.onSelectOccurrence}
                    onAdd={props.onAdd ? () => props.onAdd!(selectedDate(),) : undefined}
                    emptyMessage={props.emptyMessage}
                />
            </div>
        </div>
    );
};

export default CalendarPage;
