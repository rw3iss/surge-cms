/**
 * Admin Events. The calendar itself is the shared CalendarPage shell; this page
 * owns only what is genuinely admin-specific: the URL-routed modal, the
 * month/year dropdowns, and refetching after a save.
 *
 * The modal is driven by the URL rather than local state — `/admin/events/new`
 * and `/admin/events/:id` open it directly, so an event is linkable and the
 * back button behaves.
 */
import { Title, } from '@solidjs/meta';
import { A, useLocation, useNavigate, useParams, } from '@solidjs/router';
import { Component, For, Show, createEffect, createMemo, createSignal, } from 'solid-js';
import type { CalendarEvent, EventOccurrence, } from '@sitesurge/types';
import CalendarPage from '../../components/common/calendar/CalendarPage';
import { MONTHS, yearOptions, } from '../../components/common/calendar/calendarGrid';
import EventModal from './events/EventModal';
import { cms, } from '../../services/cmsClient';
import { siteSettings, } from '../../stores/siteSettings';
import './events/Events.scss';

const AdminEvents: Component = () => {
    const params = useParams<{ id?: string; }>();
    const location = useLocation();
    const navigate = useNavigate();

    const [editing, setEditing,] = createSignal<CalendarEvent | null>(null,);
    const [modalOpen, setModalOpen,] = createSignal(false,);
    /** Bumped after a save/delete so the shell refetches. */
    const [refreshKey, setRefreshKey,] = createSignal(0,);
    /** Remembered so "Add Event" can pre-fill the day the user picked. */
    const [pickedDate, setPickedDate,] = createSignal<string | null>(null,);
    /**
     * "The slug was changed" notice.
     *
     * `/events/new` and `/events/:id` are SEPARATE route definitions that happen
     * to share this component, so moving between them REMOUNTS it — a plain
     * signal is wiped at exactly the moment the message is needed. The message
     * therefore travels in the router's location state, which survives, and the
     * signal only covers the in-place case (editing an event that is already at
     * its own URL, where no navigation occurs).
     */
    const [localNotice, setLocalNotice,] = createSignal('',);
    const [noticeDismissed, setNoticeDismissed,] = createSignal(false,);
    const routeNotice = () => (location.state as { slugNotice?: string; } | null)?.slugNotice ?? '';
    const slugNotice = () => (noticeDismissed() ? '' : (localNotice() || routeNotice()));

    // Site defaults feed a new event's timezone/currency.
    const defaults = createMemo(() => {
        const s = siteSettings() as { defaults?: { timezone?: string; currency?: string; }; } | null;
        return { timezone: s?.defaults?.timezone ?? '', currency: s?.defaults?.currency ?? 'USD', };
    },);

    /**
     * The URL is the source of truth for the modal — reached by navigation OR
     * by pasting the link.
     *
     * `/events/new` is its OWN route with no `:id` segment, so `params.id` is
     * undefined there; reading the pathname is what actually distinguishes
     * "create" from "list". Keying off params alone silently never opened the
     * create modal.
     */
    createEffect(() => {
        const isNewRoute = location.pathname.replace(/\/+$/, '',).endsWith('/events/new',);
        if (isNewRoute) { setEditing(null,); setModalOpen(true,); return; }
        const id = params.id;
        if (!id) { setModalOpen(false,); setEditing(null,); return; }
        void (async () => {
            try {
                setEditing(await cms.events.getOne(id,),);
                setModalOpen(true,);
            } catch {
                navigate('/admin/events', { replace: true, },);
            }
        })();
    },);

    const openNew = (date?: string | null,) => {
        if (date) setPickedDate(date,);
        navigate('/admin/events/new',);
    };
    const openEvent = (occ: EventOccurrence,) => navigate(`/admin/events/${occ.event.id}`,);
    const closeModal = () => { setLocalNotice('',); navigate('/admin/events',); };
    const afterWrite = () => { closeModal(); setRefreshKey((k,) => k + 1); };

    /**
     * A save whose slug the server had to de-duplicate stays open so the user
     * sees the corrected value. The event exists now, so the URL moves to its
     * edit route — that keeps the address honest and makes the next save an
     * update rather than a second create.
     */
    const afterSave = (
        saved: CalendarEvent,
        opts?: { keepOpen?: boolean; notice?: string; },
    ) => {
        setRefreshKey((k,) => k + 1);
        if (!opts?.keepOpen) { setLocalNotice('',); closeModal(); return; }

        setEditing(saved,);
        setNoticeDismissed(false,);
        if (params.id) {
            // Already at this event's URL: nothing remounts, so a signal holds.
            setLocalNotice(opts.notice ?? '',);
            return;
        }
        // Crossing from the `/new` route to the `/:id` route remounts this
        // component, so the message goes with the navigation, not in a signal.
        navigate(`/admin/events/${saved.id}`, {
            replace: true,
            state: { slugNotice: opts.notice ?? '', },
        },);
    };

    return (
        <div class="admin-events admin-full-bleed">
            <Title>Events - Admin</Title>

            <div class="admin-header">
                <h1>Events</h1>
                <div class="admin-header__actions">
                    <A href="/admin/events/settings" class="ui-button ui-button--secondary">Event Settings</A>
                    <button
                        type="button" class="ui-button ui-button--primary"
                        onClick={() => openNew(pickedDate(),)}
                    >+ Add Event</button>
                </div>
            </div>

            <CalendarPage
                mode="admin"
                refreshKey={refreshKey()}
                onSelectOccurrence={openEvent}
                onCreateOn={(date,) => openNew(date,)}
                onAdd={(date,) => openNew(date,)}
                // Month/year dropdowns are admin-only; the shell exposes its
                // cursor so this page can drive them without owning the state.
                toolbar={(c,) => (
                    <>
                        <select value={c.month} onChange={(e,) => c.setMonth(Number(e.currentTarget.value,),)}>
                            <For each={MONTHS}>{(m, i,) => <option value={i() + 1}>{m}</option>}</For>
                        </select>
                        <select value={c.year} onChange={(e,) => c.setYear(Number(e.currentTarget.value,),)}>
                            <For each={yearOptions()}>{(y,) => <option value={y}>{y}</option>}</For>
                        </select>
                    </>
                )}
            />

            <Show when={modalOpen()}>
                <EventModal
                    event={editing()}
                    defaultDate={pickedDate()}
                    defaultTimezone={defaults().timezone}
                    defaultCurrency={defaults().currency}
                    notice={slugNotice()}
                    onDismissNotice={() => { setLocalNotice('',); setNoticeDismissed(true,); }}
                    onClose={closeModal}
                    onSaved={afterSave}
                    onDeleted={afterWrite}
                />
            </Show>
        </div>
    );
};

export default AdminEvents;
