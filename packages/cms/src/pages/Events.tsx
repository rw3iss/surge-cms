/**
 * Public events calendar. Same components as the admin page in read-only mode,
 * so the two surfaces cannot present events differently.
 */
import { Title, } from '@solidjs/meta';
import { useNavigate, } from '@solidjs/router';
import { Component, For, Show, createResource, createSignal, } from 'solid-js';
import type { EventOccurrence, } from '@sitesurge/types';
import Calendar from '../components/common/calendar/Calendar';
import EventList from '../components/common/calendar/EventList';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import './Events.scss';

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

function gridWindow(year: number, month: number,): { from: string; to: string; } {
    const first = new Date(Date.UTC(year, month - 1, 1,),);
    const from = new Date(first,);
    from.setUTCDate(from.getUTCDate() - first.getUTCDay(),);
    const to = new Date(from,);
    to.setUTCDate(to.getUTCDate() + 42,);
    return { from: from.toISOString(), to: to.toISOString(), };
}

const EventsPage: Component = () => {
    const navigate = useNavigate();
    const today = new Date();
    const [year, setYear,] = createSignal(today.getFullYear(),);
    const [month, setMonth,] = createSignal(today.getMonth() + 1,);
    const [selectedDate, setSelectedDate,] = createSignal<string | null>(null,);

    const [occurrences] = createResource(
        () => gridWindow(year(), month(),),
        async (w,) => {
            try { return await cms.events.calendar(w,); }
            catch { return [] as EventOccurrence[]; }
        },
    );

    /** Prefer the slug in the URL — it's the readable, shareable form. */
    const open = (occ: EventOccurrence,) =>
        navigate(`/events/${occ.event.slug || occ.event.id}`,);

    const step = (delta: number,) => {
        const m = month() + delta;
        if (m < 1) { setMonth(12,); setYear(year() - 1,); }
        else if (m > 12) { setMonth(1,); setYear(year() + 1,); }
        else setMonth(m,);
    };

    return (
        <div class="events-page page-wrapper">
            <Title>Events</Title>
            <SeoHead title="Events" description="Upcoming events and calendar." />

            <header class="events-page__head">
                <h1>Events</h1>
                <div class="events-page__nav">
                    <button type="button" class="btn btn--small" onClick={() => step(-1,)} aria-label="Previous month">‹</button>
                    <span class="events-page__month">{MONTHS[month() - 1]} {year()}</span>
                    <button type="button" class="btn btn--small" onClick={() => step(1,)} aria-label="Next month">›</button>
                </div>
            </header>

            <div class="events-page__layout">
                <div class="events-page__calendar">
                    <Calendar
                        mode="public"
                        year={year()}
                        month={month()}
                        occurrences={occurrences() ?? []}
                        selectedDate={selectedDate()}
                        onSelectDate={setSelectedDate}
                        onSelectOccurrence={open}
                    />
                </div>
                <EventList
                    mode="public"
                    occurrences={occurrences() ?? []}
                    selectedDate={selectedDate()}
                    onSelect={open}
                    emptyMessage="No events scheduled this month."
                />
            </div>
        </div>
    );
};

export default EventsPage;
