/**
 * /admin/events/settings — module-wide defaults for the events system.
 *
 * Ticketing implies registration, and the server enforces that rather than
 * trusting the form; the UI mirrors it so the two can't disagree on screen.
 */
import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, Show, createResource, createSignal, } from 'solid-js';
import type { EventsSettings, } from '@sitesurge/types';
import { FormField, } from '../../../components/admin/forms';
import Toggle from '../../../components/admin/common/Toggle';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../../components/common/toast';

const AdminEventSettings: Component = () => {
    const toast = useToast();
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const [notifyOnPublish, setNotifyOnPublish,] = createSignal(true,);
    const [reminderHours, setReminderHours,] = createSignal(24,);
    const [eventsUrl, setEventsUrl,] = createSignal('/events',);
    const [allowRegistration, setAllowRegistration,] = createSignal(true,);
    const [allowTicketing, setAllowTicketing,] = createSignal(false,);

    const [loaded] = createResource(async () => {
        try {
            const s = await cms.events.settings() as EventsSettings;
            setNotifyOnPublish(s.notifyOnPublish,);
            setReminderHours(s.reminderHoursBefore,);
            setEventsUrl(s.eventsUrl || '/events',);
            setAllowRegistration(s.allowRegistration,);
            setAllowTicketing(s.allowTicketing,);
            return s;
        } catch {
            return null;
        }
    },);

    const save = async () => {
        setSaving(true,); setError('',);
        try {
            await cms.events.updateSettings({
                notifyOnPublish: notifyOnPublish(),
                reminderHoursBefore: Number(reminderHours(),) || 0,
                eventsUrl: eventsUrl(),
                allowRegistration: allowRegistration(),
                allowTicketing: allowTicketing(),
            },);
            toast.success('Event settings saved',);
        } catch (e) {
            // The server rejects a URL that collides with a page or a reserved
            // route, and refuses ticketing without the Shop feature.
            setError(e instanceof Error ? e.message : 'Could not save the settings.',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="admin-event-settings">
            <Title>Event Settings - Admin</Title>
            <div class="admin-header">
                <A href="/admin/events" class="admin-header__back">← Events</A>
                <h1>Event Settings</h1>
                <div class="admin-header__actions">
                    <button type="button" class="ui-button ui-button--primary" onClick={save} disabled={saving()}>
                        {saving() ? 'Saving…' : 'Save Settings'}
                    </button>
                </div>
            </div>

            <Show when={error()}><div class="alert alert--error">{error()}</div></Show>
            <Show when={loaded.loading}><p>Loading…</p></Show>

            <section class="admin-section">
                <header class="admin-section__header"><h2>Public page</h2></header>
                <FormField
                    label="Event Page URL"
                    hint="Where the public calendar lives. Must be a single path segment and must not collide with an existing page."
                >
                    <input
                        type="text" value={eventsUrl()}
                        onInput={(e,) => setEventsUrl(e.currentTarget.value,)}
                        placeholder="/events"
                    />
                </FormField>
            </section>

            <section class="admin-section">
                <header class="admin-section__header"><h2>Notifications</h2></header>
                <FormField label="Email subscribers when an event is published" inline>
                    <Toggle checked={notifyOnPublish()} onChange={setNotifyOnPublish} ariaLabel="Notify on publish" />
                </FormField>
                <FormField
                    label="Reminder (hours before)"
                    hint="0 disables reminders. Each reminder is sent once per subscriber."
                >
                    <input
                        type="number" min="0" max="720" value={reminderHours()}
                        onInput={(e,) => setReminderHours(Number(e.currentTarget.value,) || 0,)}
                    />
                </FormField>
            </section>

            <section class="admin-section">
                <header class="admin-section__header"><h2>Registration &amp; ticketing</h2></header>
                <FormField
                    label="Allow attendees to register for events" inline
                    hint="Turns the per-event registration option on in the event editor."
                >
                    <Toggle
                        checked={allowRegistration()}
                        // Registration can't be withdrawn while ticketing needs it.
                        onChange={(v,) => setAllowRegistration(allowTicketing() ? true : v,)}
                        ariaLabel="Allow registration"
                    />
                </FormField>
                <FormField
                    label="Allow charging for events" inline
                    hint="Requires the Shop feature — tickets are checked out through it. Forces registration on."
                >
                    <Toggle
                        checked={allowTicketing()}
                        onChange={(v,) => { setAllowTicketing(v,); if (v) setAllowRegistration(true,); }}
                        ariaLabel="Allow ticketing"
                    />
                </FormField>
            </section>
        </div>
    );
};

export default AdminEventSettings;
