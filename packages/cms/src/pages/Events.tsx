/**
 * Public events calendar. All behaviour lives in the shared CalendarPage shell;
 * this page only supplies the page chrome and where a click navigates.
 */
import { Title, } from '@solidjs/meta';
import { useNavigate, } from '@solidjs/router';
import { Component, } from 'solid-js';
import type { EventOccurrence, } from '@sitesurge/types';
import CalendarPage from '../components/common/calendar/CalendarPage';
import SeoHead from '../components/common/seo/SeoHead';
import './Events.scss';

const EventsPage: Component = () => {
    const navigate = useNavigate();

    /** Prefer the slug — it's the readable, shareable form. */
    const open = (occ: EventOccurrence,) =>
        navigate(`/events/${occ.event.slug || occ.event.id}`,);

    return (
        <div class="events-page page-wrapper">
            <Title>Events</Title>
            <SeoHead title="Events" description="Upcoming events and calendar." />

            <header class="events-page__head">
                <h1>Events</h1>
            </header>

            <CalendarPage
                mode="public"
                onSelectOccurrence={open}
                emptyMessage="No events scheduled this month."
            />
        </div>
    );
};

export default EventsPage;
