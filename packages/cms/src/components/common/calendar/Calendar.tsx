/**
 * Month-grid calendar, shared by the admin Events page and the public /events
 * page.
 *
 * One component in two modes rather than two components: the grid, the
 * leading/trailing day handling and the occurrence bucketing are identical, and
 * duplicating them is how the two surfaces drift apart. `mode` gates only the
 * interactive affordances — the public grid is read-only and never shows a
 * cancelled occurrence.
 */
import { Component, For, Show, createMemo, } from 'solid-js';
import type { EventOccurrence, } from '@sitesurge/types';
import './Calendar.scss';

export interface CalendarProps {
    /** Year of the displayed month. */
    year: number;
    /** 1-indexed month. */
    month: number;
    occurrences: EventOccurrence[];
    /** `admin` adds day selection, double-click-to-create and cancelled styling. */
    mode?: 'admin' | 'public';
    /** `YYYY-MM-DD` of the currently selected day, if any. */
    selectedDate?: string | null;
    onSelectDate?: (date: string,) => void;
    /** Admin only — double-clicking a day is the shortcut for "add here". */
    onCreateOn?: (date: string,) => void;
    onSelectOccurrence?: (occ: EventOccurrence,) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',];

/** `YYYY-MM-DD` for a UTC date, matching the server's occurrence key. */
function key(d: Date,): string {
    return d.toISOString().slice(0, 10,);
}

/**
 * The 42 cells a month grid renders: the month itself plus the leading and
 * trailing days needed to fill whole weeks. Fixed at six rows so the grid
 * doesn't change height between months, which is visually jarring.
 */
function gridDays(year: number, month: number,): Date[] {
    const first = new Date(Date.UTC(year, month - 1, 1,),);
    const start = new Date(first,);
    start.setUTCDate(start.getUTCDate() - first.getUTCDay(),);
    return Array.from({ length: 42, }, (_, i,) => {
        const d = new Date(start,);
        d.setUTCDate(d.getUTCDate() + i,);
        return d;
    },);
}

const Calendar: Component<CalendarProps> = (props,) => {
    const mode = () => props.mode ?? 'public';
    const days = createMemo(() => gridDays(props.year, props.month,),);

    /** Bucket once per render rather than filtering the whole list per cell. */
    const byDate = createMemo(() => {
        const out: Record<string, EventOccurrence[]> = {};
        for (const occ of props.occurrences) {
            // A cancelled date is data the admin needs to see; the public grid
            // must never render it even if the API returned it.
            if (occ.cancelled && mode() !== 'admin') continue;
            (out[occ.occurrenceDate] ??= []).push(occ,);
        }
        return out;
    },);

    const todayKey = key(new Date(),);

    return (
        <div class={`calendar calendar--${mode()}`}>
            <div class="calendar__weekdays">
                <For each={WEEKDAYS}>{(d,) => <div class="calendar__weekday">{d}</div>}</For>
            </div>

            <div class="calendar__grid">
                <For each={days()}>
                    {(day,) => {
                        const k = key(day,);
                        const inMonth = day.getUTCMonth() + 1 === props.month;
                        const items = () => byDate()[k] ?? [];
                        return (
                            <div
                                class={`calendar__day${inMonth ? '' : ' calendar__day--outside'}`
                                    + `${k === todayKey ? ' calendar__day--today' : ''}`
                                    + `${props.selectedDate === k ? ' calendar__day--selected' : ''}`}
                                onClick={() => props.onSelectDate?.(k,)}
                                onDblClick={() => mode() === 'admin' && props.onCreateOn?.(k,)}
                            >
                                <span class="calendar__day-number">{day.getUTCDate()}</span>
                                <div class="calendar__day-events">
                                    <For each={items().slice(0, 3,)}>
                                        {(occ,) => (
                                            <button
                                                type="button"
                                                class={`calendar__event${
                                                    occ.cancelled ? ' calendar__event--cancelled' : ''
                                                }${occ.event.recurrenceRule ? ' calendar__event--repeating' : ''}`}
                                                title={occ.cancelled ? `${occ.title} (cancelled)` : occ.title}
                                                onClick={(e,) => {
                                                    // Don't let the click also select the day.
                                                    e.stopPropagation();
                                                    props.onSelectOccurrence?.(occ,);
                                                }}
                                            >
                                                <Show when={occ.event.recurrenceRule}>
                                                    <span class="calendar__repeat-dot" aria-label="Repeating">↻</span>
                                                </Show>
                                                {occ.title}
                                            </button>
                                        )}
                                    </For>
                                    <Show when={items().length > 3}>
                                        <span class="calendar__more">+{items().length - 3} more</span>
                                    </Show>
                                </div>
                            </div>
                        );
                    }}
                </For>
            </div>
        </div>
    );
};

export default Calendar;
