/**
 * Scheduled Sends — the "Mailing Lists" page section, plus its edit modal.
 *
 * A schedule is a standing instruction: send THIS template to THAT list at a
 * wall-clock time, once or on a recurrence. The server owns when it next fires
 * (`nextRunAt`); this only edits the instruction and shows what the scheduler
 * decided, which is why the next-run column is read-only — a date the UI
 * computed itself could disagree with the one that actually fires.
 *
 * Times are wall-clock in the schedule's zone, so 09:00 stays 09:00 across a
 * daylight-saving change. New schedules default to the site's authoring
 * timezone (Settings → defaults), falling back to America/New_York.
 */
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import type { MailingList, MailSchedule, MailScheduleFrequency, MailTemplate, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ConfirmModal from '../common/ConfirmModal';
import ModalShell from '../common/ModalShell';
import { FormField, } from '../forms';
import Toggle from '../common/Toggle';

const FREQUENCIES: { value: MailScheduleFrequency; label: string; }[] = [
    { value: 'once', label: 'Once', },
    { value: 'daily', label: 'Every day', },
    { value: 'weekly', label: 'Every week', },
    { value: 'monthly', label: 'Every month', },
    { value: 'yearly', label: 'Every year', },
];

/** Local YYYY-MM-DD for the date input's default. */
function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0',)}-${String(d.getDate()).padStart(2, '0',)}`;
}

/** `HH:MM:SS` from the server → `HH:MM` for `<input type="time">`. */
const toInputTime = (v: string | undefined,): string => (v ? String(v,).slice(0, 5,) : '09:00');

function formatNextRun(s: MailSchedule,): string {
    if (!s.enabled) return 'Paused';
    if (!s.nextRunAt) return '—';
    try {
        // Rendered in the SCHEDULE's zone, not the viewer's: the operator set
        // "09:00 New York", and showing them 06:00 because they are in
        // California would look like the schedule is wrong.
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium', timeStyle: 'short', timeZone: s.timezone,
        },).format(new Date(s.nextRunAt,),);
    } catch {
        return new Date(s.nextRunAt,).toLocaleString();
    }
}

interface Draft {
    name: string;
    listId: string;
    templateId: string;
    subject: string;
    frequency: MailScheduleFrequency;
    timeOfDay: string;
    timezone: string;
    startDate: string;
    enabled: boolean;
}

const ScheduledSends: Component<{ lists: MailingList[]; templates: MailTemplate[]; }> = (props,) => {
    const toast = useToast();
    const [schedules, { refetch, },] = createResource(async () => {
        try {
            return await cms.mailingLists.schedules();
        } catch {
            return [] as MailSchedule[];
        }
    },);
    const [siteTz] = createResource(async () => {
        try {
            return (await cms.mailingLists.scheduleTimezone()).timezone;
        } catch {
            return 'America/New_York';
        }
    },);

    const [editing, setEditing,] = createSignal<MailSchedule | null>(null,);
    const [modalOpen, setModalOpen,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);
    const [confirmDelete, setConfirmDelete,] = createSignal<MailSchedule | null>(null,);

    // A store, not a signal of an object: the fields are edited individually and
    // rebuilding the object on every keystroke would remount the inputs and
    // steal focus (see ADMIN_STYLES.md).
    const [draft, setDraft,] = createStore<Draft>({
        name: '', listId: '', templateId: '', subject: '',
        frequency: 'weekly', timeOfDay: '09:00', timezone: 'America/New_York',
        startDate: todayISO(), enabled: true,
    },);

    const openNew = (): void => {
        setEditing(null,);
        setError(null,);
        setDraft({
            name: '',
            listId: props.lists[0]?.id ?? '',
            templateId: props.templates[0]?.id ?? '',
            subject: '',
            frequency: 'weekly',
            timeOfDay: '09:00',
            timezone: siteTz() ?? 'America/New_York',
            startDate: todayISO(),
            enabled: true,
        },);
        setModalOpen(true,);
    };

    const openEdit = (s: MailSchedule,): void => {
        setEditing(s,);
        setError(null,);
        setDraft({
            name: s.name,
            listId: s.listId,
            templateId: s.templateId ?? '',
            subject: s.subject ?? '',
            frequency: s.frequency,
            timeOfDay: toInputTime(s.timeOfDay,),
            timezone: s.timezone,
            startDate: String(s.startDate,).slice(0, 10,),
            enabled: s.enabled,
        },);
        setModalOpen(true,);
    };

    const save = async (): Promise<void> => {
        setSaving(true,);
        setError(null,);
        try {
            const body = {
                name: draft.name.trim(),
                listId: draft.listId,
                templateId: draft.templateId || null,
                subject: draft.subject.trim() || null,
                frequency: draft.frequency,
                timeOfDay: draft.timeOfDay,
                timezone: draft.timezone || null,
                startDate: draft.startDate,
                enabled: draft.enabled,
            };
            const current = editing();
            if (current) await cms.mailingLists.updateSchedule(current.id, body,);
            else await cms.mailingLists.createSchedule(body,);
            toast.success(current ? 'Schedule updated' : 'Schedule created',);
            setModalOpen(false,);
            void refetch();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the schedule',);
        } finally {
            setSaving(false,);
        }
    };

    const togglePaused = async (s: MailSchedule,): Promise<void> => {
        try {
            await cms.mailingLists.setScheduleEnabled(s.id, !s.enabled,);
            toast.success(s.enabled ? 'Schedule paused' : 'Schedule resumed',);
            void refetch();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not change the schedule',);
        }
    };

    const doDelete = async (): Promise<void> => {
        const s = confirmDelete();
        if (!s) return;
        try {
            await cms.mailingLists.deleteSchedule(s.id,);
            toast.success('Schedule deleted',);
            setConfirmDelete(null,);
            // Closed too: deleting from inside the editor must not leave the
            // modal open over a record that no longer exists.
            setModalOpen(false,);
            void refetch();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not delete the schedule',);
        }
    };

    const canSave = (): boolean =>
        draft.name.trim().length > 0 && Boolean(draft.listId,) && Boolean(draft.templateId,);

    return (
        <section class="admin-section admin-section--wide">
            <header class="admin-section__header">
                <h2>Scheduled Sends</h2>
                <div class="admin-section__actions">
                    <button
                        type="button"
                        class="ui-button ui-button--primary ui-button--sm"
                        onClick={openNew}
                        disabled={props.lists.length === 0 || props.templates.length === 0}
                        title={props.lists.length === 0 || props.templates.length === 0
                            ? 'Create a list and a template first'
                            : undefined}
                    >
                        Schedule a new message
                    </button>
                </div>
            </header>

            <Show when={!schedules.loading} fallback={<p>Loading…</p>}>
                <Show
                    when={(schedules() ?? []).length > 0}
                    fallback={
                        <div class="empty-state">
                            <em>No scheduled sends yet. Schedule one to mail a list automatically.</em>
                        </div>
                    }
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>List</th>
                                    <th>Template</th>
                                    <th>When</th>
                                    <th>Next run</th>
                                    <th>Last run</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={schedules() ?? []}>
                                    {(s,) => (
                                        <tr class={s.enabled ? '' : 'is-paused'}>
                                            <td>
                                                <div class="schedule-row__name">{s.name}</div>
                                                <Show when={!s.enabled}>
                                                    <span class="badge badge--muted">Paused</span>
                                                </Show>
                                            </td>
                                            <td>{s.listName ?? <em class="form-help-muted">(deleted)</em>}</td>
                                            <td>
                                                {s.templateName
                                                    ?? <em class="form-help-muted">(template removed)</em>}
                                            </td>
                                            <td>
                                                {FREQUENCIES.find((f,) => f.value === s.frequency)?.label ?? s.frequency}
                                                {' at '}{toInputTime(s.timeOfDay,)}
                                                <div class="form-help-muted">{s.timezone}</div>
                                            </td>
                                            <td>{formatNextRun(s,)}</td>
                                            <td>
                                                <Show
                                                    when={s.lastRunAt}
                                                    fallback={<em class="form-help-muted">Never</em>}
                                                >
                                                    <span class={`badge ${
                                                        s.lastStatus === 'sent'
                                                            ? 'badge--success'
                                                            : s.lastStatus === 'failed'
                                                            ? 'badge--error'
                                                            : 'badge--muted'
                                                    }`}
                                                    >
                                                        {s.lastStatus ?? 'ran'}
                                                    </span>
                                                    {/* The error is shown inline rather than only logged —
                                                        a schedule that silently stopped working is the
                                                        failure an operator finds out about from a reader. */}
                                                    <Show when={s.lastStatus !== 'sent' && s.lastError}>
                                                        <div class="form-help-muted schedule-row__error">{s.lastError}</div>
                                                    </Show>
                                                </Show>
                                            </td>
                                            <td class="schedule-row__actions">
                                                <button
                                                    type="button"
                                                    class="ui-button ui-button--sm ui-button--secondary"
                                                    onClick={() => openEdit(s,)}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    class="ui-button ui-button--sm ui-button--ghost"
                                                    onClick={() => void togglePaused(s,)}
                                                >
                                                    {s.enabled ? 'Pause' : 'Resume'}
                                                </button>
                                                <button
                                                    type="button"
                                                    class="ui-button ui-button--sm ui-button--ghost"
                                                    onClick={() => setConfirmDelete(s,)}
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                </Show>
            </Show>

            <ModalShell
                open={modalOpen()}
                onClose={() => setModalOpen(false,)}
                size="md"
                ariaLabel={editing() ? 'Edit scheduled send' : 'Schedule a new message'}
            >
                <div class="schedule-modal">
                    <h2 class="schedule-modal__title">
                        {editing() ? 'Edit scheduled send' : 'Schedule a new message'}
                    </h2>

                    <FormField label="Name" hint="For your reference in this list only.">
                        <input
                            type="text"
                            value={draft.name}
                            placeholder="Weekly newsletter"
                            onInput={(e,) => setDraft('name', e.currentTarget.value,)}
                        />
                    </FormField>

                    <FormField label="Mailing list">
                        <select value={draft.listId} onChange={(e,) => setDraft('listId', e.currentTarget.value,)}>
                            <For each={props.lists}>
                                {(l,) => <option value={l.id}>{l.name}</option>}
                            </For>
                        </select>
                    </FormField>

                    <FormField
                        label="Template"
                        hint="Resolved when the send fires, so edits to the template apply to future sends."
                    >
                        <select value={draft.templateId} onChange={(e,) => setDraft('templateId', e.currentTarget.value,)}>
                            <For each={props.templates}>
                                {(t,) => <option value={t.id}>{t.name}</option>}
                            </For>
                        </select>
                    </FormField>

                    <FormField
                        label="Subject"
                        hint="Leave empty to use the template's own subject."
                    >
                        <input
                            type="text"
                            value={draft.subject}
                            placeholder="(use the template's subject)"
                            onInput={(e,) => setDraft('subject', e.currentTarget.value,)}
                        />
                    </FormField>

                    <div class="schedule-modal__row">
                        <FormField label="Repeats">
                            <select
                                value={draft.frequency}
                                onChange={(e,) => setDraft('frequency', e.currentTarget.value as MailScheduleFrequency,)}
                            >
                                <For each={FREQUENCIES}>
                                    {(f,) => <option value={f.value}>{f.label}</option>}
                                </For>
                            </select>
                        </FormField>

                        <FormField label={draft.frequency === 'once' ? 'Date' : 'Starting'}>
                            <input
                                type="date"
                                value={draft.startDate}
                                onChange={(e,) => setDraft('startDate', e.currentTarget.value,)}
                            />
                        </FormField>

                        <FormField label="Time">
                            <input
                                type="time"
                                value={draft.timeOfDay}
                                onChange={(e,) => setDraft('timeOfDay', e.currentTarget.value,)}
                            />
                        </FormField>
                    </div>

                    <FormField
                        label="Timezone"
                        hint="An IANA zone. The time above is wall-clock here, so it holds across daylight saving."
                    >
                        <input
                            type="text"
                            value={draft.timezone}
                            placeholder="America/New_York"
                            onChange={(e,) => setDraft('timezone', e.currentTarget.value,)}
                        />
                    </FormField>

                    <FormField label="Active" inline>
                        <Toggle
                            checked={draft.enabled}
                            onChange={(v,) => setDraft('enabled', v,)}
                            ariaLabel="Schedule active"
                        />
                    </FormField>

                    <Show when={error()}>
                        <p class="form-error" role="alert">{error()}</p>
                    </Show>

                    <div class="schedule-modal__actions">
                        <button
                            type="button"
                            class="ui-button ui-button--primary"
                            disabled={saving() || !canSave()}
                            onClick={() => void save()}
                        >
                            {saving() ? 'Saving…' : 'Save schedule'}
                        </button>
                        <button
                            type="button"
                            class="ui-button ui-button--secondary"
                            onClick={() => setModalOpen(false,)}
                            disabled={saving()}
                        >
                            Cancel
                        </button>
                        <Show when={editing()}>
                            <button
                                type="button"
                                class="ui-button ui-button--ghost"
                                onClick={() => void togglePaused(editing()!,).then(() => setModalOpen(false,))}
                                disabled={saving()}
                            >
                                {editing()!.enabled ? 'Pause' : 'Resume'}
                            </button>
                            <button
                                type="button"
                                class="ui-button ui-button--ghost schedule-modal__delete"
                                onClick={() => setConfirmDelete(editing()!,)}
                                disabled={saving()}
                            >
                                Delete
                            </button>
                        </Show>
                    </div>
                </div>
            </ModalShell>

            <ConfirmModal
                open={Boolean(confirmDelete(),)}
                title="Delete this schedule?"
                message={`"${confirmDelete()?.name ?? ''}" will stop sending. Mail already sent is not affected.`}
                confirmLabel="Delete schedule"
                cancelLabel="Keep it"
                danger
                onConfirm={() => void doDelete()}
                onCancel={() => setConfirmDelete(null,)}
            />
        </section>
    );
};

export default ScheduledSends;
