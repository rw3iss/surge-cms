/**
 * Admin Events — month calendar on the left, event list on the right.
 *
 * The modal is URL-routed rather than pure local state: `/admin/events/new` and
 * `/admin/events/:id` open it directly, so an event is linkable and the back
 * button behaves. The calendar page itself renders underneath either way.
 */
import { Title, } from '@solidjs/meta';
import { A, useNavigate, useParams, } from '@solidjs/router';
import { Component, For, Show, createEffect, createMemo, createResource, createSignal, } from 'solid-js';
import type { CalendarEvent, EventOccurrence, } from '@sitesurge/types';
import Calendar from '../../components/common/calendar/Calendar';
import EventList from '../../components/common/calendar/EventList';
import EventModal from './events/EventModal';
import { cms, } from '../../services/cmsClient';
import { siteSettings, } from '../../stores/siteSettings';
import './events/Events.scss';

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/** ±10 years around today, per the spec. */
function yearOptions(): number[] {
    const now = new Date().getFullYear();
    return Array.from({ length: 21, }, (_, i,) => now - 10 + i);
}

/** The window the grid displays: six whole weeks from the Sunday on or before
 *  the 1st, so events in the leading/trailing cells are fetched too. */
function gridWindow(year: number, month: number,): { from: string; to: string; } {
    const first = new Date(Date.UTC(year, month - 1, 1,),);
    const from = new Date(first,);
    from.setUTCDate(from.getUTCDate() - first.getUTCDay(),);
    const to = new Date(from,);
    to.setUTCDate(to.getUTCDate() + 42,);
    return { from: from.toISOString(), to: to.toISOString(), };
}

const AdminEvents: Component = () => {
    const params = useParams<{ id?: string; }>();
    const navigate = useNavigate();
    const today = new Date();

    const [year, setYear,] = createSignal(today.getFullYear(),);
    const [month, setMonth,] = createSignal(today.getMonth() + 1,);
    const [selectedDate, setSelectedDate,] = createSignal<string | null>(null,);
    const [editing, setEditing,] = createSignal<CalendarEvent | null>(null,);
    const [modalOpen, setModalOpen,] = createSignal(false,);

    const [occurrences, { refetch, },] = createResource(
        () => gridWindow(year(), month(),),
        async (w,) => {
            try {
                return await cms.events.calendar(w,);
            } catch {
                return [] as EventOccurrence[];
            }
        },
    );

    // Site defaults feed a new event's timezone/currency.
    const defaults = createMemo(() => {
        const s = siteSettings() as { defaults?: { timezone?: string; currency?: string; }; } | null;
        return { timezone: s?.defaults?.timezone ?? '', currency: s?.defaults?.currency ?? 'USD', };
    },);

    /**
     * The URL is the source of truth for the modal: `/new` opens a blank one,
     * `/:id` loads that event. Reached by navigation OR by pasting the link.
     */
    createEffect(() => {
        const id = params.id;
        if (!id) { setModalOpen(false,); setEditing(null,); return; }
        if (id === 'new') { setEditing(null,); setModalOpen(true,); return; }
        void (async () => {
            try {
                setEditing(await cms.events.getOne(id,),);
                setModalOpen(true,);
            } catch {
                navigate('/admin/events', { replace: true, },);
            }
        })();
    },);

    const openNew = (date?: string,) => {
        if (date) setSelectedDate(date,);
        navigate('/admin/events/new',);
    };
    const openEvent = (occ: EventOccurrence,) => navigate(`/admin/events/${occ.event.id}`,);
    const closeModal = () => navigate('/admin/events',);

    const onSaved = async () => { closeModal(); await refetch(); };
    const onDeleted = async () => { closeModal(); await refetch(); };

    const goToday = () => {
        const n = new Date();
        setYear(n.getFullYear(),); setMonth(n.getMonth() + 1,);
    };
    const step = (delta: number,) => {
        const m = month() + delta;
        if (m < 1) { setMonth(12,); setYear(year() - 1,); }
        else if (m > 12) { setMonth(1,); setYear(year() + 1,); }
        else setMonth(m,);
    };

    return (
        <div class="admin-events admin-full-bleed">
            <Title>Events - Admin</Title>

            <div class="admin-header">
                <h1>Events</h1>
                <div class="admin-header__actions">
                    <A href="/admin/events/settings" class="ui-button ui-button--secondary">Event Settings</A>
                    <button type="button" class="ui-button ui-button--primary" onClick={() => openNew(selectedDate() ?? undefined,)}>
                        + Add Event
                    </button>
                </div>
            </div>

            <div class="admin-events__toolbar">
                <button type="button" class="ui-button ui-button--sm ui-button--secondary" onClick={() => step(-1,)} aria-label="Previous month">‹</button>
                <select value={month()} onChange={(e,) => setMonth(Number(e.currentTarget.value,),)}>
                    <For each={MONTHS}>{(m, i,) => <option value={i() + 1}>{m}</option>}</For>
                </select>
                <select value={year()} onChange={(e,) => setYear(Number(e.currentTarget.value,),)}>
                    <For each={yearOptions()}>{(y,) => <option value={y}>{y}</option>}</For>
                </select>
                <button type="button" class="ui-button ui-button--sm ui-button--secondary" onClick={() => step(1,)} aria-label="Next month">›</button>
                <button type="button" class="ui-button ui-button--sm ui-button--ghost" onClick={goToday}>Today</button>
                <Show when={occurrences.loading}>
                    <span class="admin-events__loading">Loading…</span>
                </Show>
            </div>

            <div class="admin-events__layout">
                <div class="admin-events__calendar">
                    <Calendar
                        mode="admin"
                        year={year()}
                        month={month()}
                        occurrences={occurrences() ?? []}
                        selectedDate={selectedDate()}
                        onSelectDate={setSelectedDate}
                        onCreateOn={(date,) => openNew(date,)}
                        onSelectOccurrence={openEvent}
                    />
                    <p class="admin-events__hint">
                        Click a day to select it, or double-click to add an event on that day.
                    </p>
                </div>

                <EventList
                    mode="admin"
                    occurrences={occurrences() ?? []}
                    selectedDate={selectedDate()}
                    onSelect={openEvent}
                    onAdd={() => openNew(selectedDate() ?? undefined,)}
                />
            </div>

            <Show when={modalOpen()}>
                <EventModal
                    event={editing()}
                    defaultDate={selectedDate()}
                    defaultTimezone={defaults().timezone}
                    defaultCurrency={defaults().currency}
                    onClose={closeModal}
                    onSaved={onSaved}
                    onDeleted={onDeleted}
                />
            </Show>
        </div>
    );
};

export default AdminEvents;
