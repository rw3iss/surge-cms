/**
 * Create/edit modal for an event.
 *
 * The date/time fields are the fiddly part. An event is one of three shapes and
 * the form enforces exactly one at a time, because letting a user set both
 * "all day" and a start time produces data no renderer can display sensibly:
 *
 *   - timed      → start time (+ optional end time)
 *   - all-day    → no times
 *   - multi-day  → start date + end date (+ optional times)
 *
 * "All day" and "multi-day" are therefore mutually exclusive in the UI.
 */
import { Component, For, Index, Show, createEffect, createMemo, createSignal, } from 'solid-js';
import type { CalendarEvent, CalendarEventInput, EventTicketTier, } from '@sitesurge/types';
import {
    EVENT_REGISTRATION_FIELDS, generateSlug, isKnownTimeZone, TIMEZONES,
} from '@sitesurge/types';
import { FormField, } from '../../../components/admin/forms';
import ModalShell from '../../../components/admin/common/ModalShell';
import Toggle from '../../../components/admin/common/Toggle';
import RegistrantsTable from './RegistrantsTable';
import { cms, } from '../../../services/cmsClient';
import './EventModal.scss';

export interface EventModalProps {
    /** Existing event to edit, or null for a new one. */
    event: CalendarEvent | null;
    /** Pre-selected day (`YYYY-MM-DD`) when creating from a calendar cell. */
    defaultDate?: string | null;
    /** Site default from Settings → General, used for new events. */
    defaultTimezone?: string;
    defaultCurrency?: string;
    onClose: () => void;
    /**
     * `keepOpen` is set when the server changed the slug under us: the event IS
     * saved, but closing would hide the correction, so the caller should refresh
     * and leave the modal up instead, showing `notice`.
     */
    onSaved: (
        event: CalendarEvent,
        opts?: { keepOpen?: boolean; notice?: string; },
    ) => void;
    /**
     * Message shown above the slug field. Owned by the PARENT because switching
     * from `/events/new` to `/events/:id` remounts this component — a signal in
     * here would be wiped exactly when the message matters.
     */
    notice?: string;
    /** Called when the user edits the slug, so a stale notice can be dropped. */
    onDismissNotice?: () => void;
    onDeleted?: (id: string,) => void;
}

/** Split an ISO instant into the `YYYY-MM-DD` + `HH:MM` a date/time input wants. */
function splitIso(iso: string | null,): { date: string; time: string; } {
    if (!iso) return { date: '', time: '', };
    const d = new Date(iso,);
    const pad = (n: number,) => String(n,).padStart(2, '0',);
    return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1,)}-${pad(d.getDate(),)}`,
        time: `${pad(d.getHours(),)}:${pad(d.getMinutes(),)}`,
    };
}

/** Recombine into an ISO instant. An all-day event pins to local midnight. */
function joinIso(date: string, time: string, allDay: boolean,): string | null {
    if (!date) return null;
    const t = allDay || !time ? '00:00' : time;
    return new Date(`${date}T${t}`,).toISOString();
}

const RECURRENCE_OPTIONS = [
    { value: '', label: 'Does not repeat', },
    { value: 'daily', label: 'Daily', },
    { value: 'weekly', label: 'Weekly', },
    { value: 'biweekly', label: 'Every two weeks', },
    { value: 'monthly', label: 'Monthly', },
    { value: 'yearly', label: 'Yearly', },
];

const EventModal: Component<EventModalProps> = (props,) => {
    const isNew = () => !props.event;

    const [title, setTitle,] = createSignal('',);
    const [slug, setSlug,] = createSignal('',);
    /** Once the user edits the slug we stop deriving it from the title, or we'd
     *  clobber their choice on the next keystroke. */
    const [slugTouched, setSlugTouched,] = createSignal(false,);
    const [description, setDescription,] = createSignal('',);
    const [location, setLocation,] = createSignal('',);

    const [startDate, setStartDate,] = createSignal('',);
    const [startTime, setStartTime,] = createSignal('09:00',);
    const [endDate, setEndDate,] = createSignal('',);
    const [endTime, setEndTime,] = createSignal('',);
    const [allDay, setAllDay,] = createSignal(false,);
    const [multiDay, setMultiDay,] = createSignal(false,);
    const [timezone, setTimezone,] = createSignal('',);

    const [recurrence, setRecurrence,] = createSignal('',);
    const [recurrenceUntil, setRecurrenceUntil,] = createSignal('',);

    const [status, setStatus,] = createSignal<'draft' | 'published' | 'cancelled'>('published',);
    const [registrationEnabled, setRegistrationEnabled,] = createSignal(false,);
    const [registrationFields, setRegistrationFields,] = createSignal<string[]>(['name', 'email',],);
    const [showRegistrantCount, setShowRegistrantCount,] = createSignal(false,);
    const [ticketingEnabled, setTicketingEnabled,] = createSignal(false,);
    const [tiers, setTiers,] = createSignal<Array<Partial<EventTicketTier>>>([],);

    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    // Seed from the event being edited, or from the day the user clicked.
    createEffect(() => {
        const e = props.event;
        if (e) {
            setTitle(e.title,); setSlug(e.slug,); setSlugTouched(true,);
            setDescription(e.description ?? '',); setLocation(e.location ?? '',);
            const s = splitIso(e.startsAt,);
            setStartDate(s.date,); setStartTime(s.time,);
            const en = splitIso(e.endsAt,);
            setEndDate(en.date,); setEndTime(en.time,);
            setAllDay(e.allDay,);
            setMultiDay(Boolean(e.endsAt && en.date && en.date !== s.date,),);
            setTimezone(e.timezone ?? props.defaultTimezone ?? '',);
            setRecurrence(e.recurrenceRule ?? '',);
            setRecurrenceUntil(e.recurrenceUntil ? splitIso(e.recurrenceUntil,).date : '',);
            setStatus(e.status,);
            setRegistrationEnabled(e.registrationEnabled,);
            setRegistrationFields(e.registrationFields ?? ['name', 'email',],);
            setShowRegistrantCount(e.showRegistrantCount,);
            setTicketingEnabled(e.ticketingEnabled,);
            void loadTiers(e.id,);
        } else {
            setStartDate(props.defaultDate || splitIso(new Date().toISOString(),).date,);
            setTimezone(props.defaultTimezone ?? '',);
        }
    },);

    const loadTiers = async (eventId: string,) => {
        try {
            const date = splitIso(props.event?.startsAt ?? null,).date;
            setTiers(await cms.events.tiers(eventId, date,),);
        } catch { /* no tiers yet */ }
    };

    // Auto-derive the slug from the title until the user takes it over.
    createEffect(() => {
        const t = title();
        if (!slugTouched() && t) setSlug(generateSlug(t,),);
    },);

    const toggleField = (key: string,) => {
        setRegistrationFields((prev,) =>
            prev.includes(key,) ? prev.filter((k,) => k !== key) : [...prev, key,]);
    };

    const addTier = () => setTiers((t,) => [...t, {
        name: t.length === 0 ? 'Default Ticket Price' : '',
        priceCents: 0,
        currency: props.defaultCurrency ?? 'USD',
        quantityAvailable: null,
    },]);

    const updateTier = (i: number, patch: Partial<EventTicketTier>,) =>
        setTiers((t,) => t.map((x, idx,) => (idx === i ? { ...x, ...patch, } : x)));

    const removeTier = (i: number,) => setTiers((t,) => t.filter((_, idx,) => idx !== i));

    const canSave = createMemo(() => Boolean(title().trim() && startDate(),),);

    const save = async () => {
        if (!canSave() || saving()) return;
        setSaving(true,); setError('',);
        try {
            const startsAt = joinIso(startDate(), startTime(), allDay(),);
            if (!startsAt) throw new Error('A start date is required.',);

            // End instant: multi-day uses the end DATE; a same-day event with an
            // end time uses the start date.
            const endsAt = multiDay()
                ? joinIso(endDate() || startDate(), endTime(), allDay(),)
                : (endTime() ? joinIso(startDate(), endTime(), false,) : null);

            if (endsAt && new Date(endsAt,) < new Date(startsAt,)) {
                throw new Error('The event cannot end before it starts.',);
            }

            const body: CalendarEventInput = {
                title: title().trim(),
                slug: slug().trim() || undefined,
                description: description().trim() || null,
                location: location().trim() || null,
                startsAt,
                endsAt,
                allDay: allDay(),
                timezone: timezone() || null,
                recurrenceRule: recurrence() || null,
                recurrenceUntil: recurrence() && recurrenceUntil()
                    ? joinIso(recurrenceUntil(), '23:59', false,)
                    : null,
                status: status(),
                registrationEnabled: registrationEnabled(),
                registrationFields: registrationFields(),
                showRegistrantCount: showRegistrantCount(),
                ticketingEnabled: ticketingEnabled(),
            };

            const saved = props.event
                ? await cms.events.update(props.event.id, body,)
                : await cms.events.create(body,);

            // Tiers are a separate resource; only write them when relevant.
            if (ticketingEnabled()) {
                await cms.events.replaceTiers(saved.id, tiers().map((t, i,) => ({
                    id: t.id,
                    name: (t.name || 'Ticket').trim(),
                    priceCents: Number(t.priceCents ?? 0,),
                    currency: t.currency || props.defaultCurrency || 'USD',
                    quantityAvailable: t.quantityAvailable ?? null,
                    position: i,
                }),),);
            }
            // The server owns slug uniqueness, so what we asked for and what was
            // stored can differ ("summer-gala" → "summer-gala-1"). Show the real
            // slug rather than closing on a value that is no longer true.
            const requested = body.slug;
            if (requested && saved.slug !== requested) {
                setSlug(saved.slug,);
                setSlugTouched(true,);
                props.onSaved(saved, {
                    keepOpen: true,
                    notice: `"${requested}" was already taken, `
                        + `so this event was saved as "${saved.slug}".`,
                },);
                return;
            }

            props.onSaved(saved,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the event.',);
        } finally {
            setSaving(false,);
        }
    };

    const remove = async () => {
        if (!props.event) return;
        if (!confirm('Delete this event? This cannot be undone.',)) return;
        try {
            await cms.events.remove(props.event.id,);
            props.onDeleted?.(props.event.id,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not delete the event.',);
        }
    };

    return (
        // ModalShell supplies the overlay, Portal, backdrop dismiss, Escape
        // handling and the ✕ — all of which the hand-rolled version lacked.
        // Every other admin modal uses it, so this one now behaves the same.
        <ModalShell
            open
            size="lg"
            showClose
            // A stray click on the backdrop must not discard a part-filled form:
            // this modal holds a lot of state, so it closes only via Cancel or ✕.
            dismissOnBackdrop={false}
            onClose={props.onClose}
            ariaLabel={isNew() ? 'New event' : 'Edit event'}
            class="event-modal"
        >
                <header class="event-modal__head">
                    <h2>{isNew() ? 'New Event' : 'Edit Event'}</h2>
                </header>

                <div class="event-modal__body">
                    <Show when={error()}>
                        <div class="alert alert--error">{error()}</div>
                    </Show>

                    <FormField label="Event name" required>
                        <input
                            type="text" value={title()} maxLength={255}
                            onInput={(e,) => setTitle(e.currentTarget.value,)}
                            placeholder="Community Town Hall"
                        />
                    </FormField>

                    <Show when={props.notice}>
                        <div class="alert alert--warning">{props.notice}</div>
                    </Show>

                    <FormField label="URL slug" hint="Used in the event's public address.">
                        <div class="event-modal__slug">
                            <input
                                type="text" value={slug()}
                                onInput={(e,) => {
                                    setSlug(e.currentTarget.value,);
                                    setSlugTouched(true,);
                                    // The notice describes the value that was just
                                    // replaced; keeping it would misdescribe this one.
                                    props.onDismissNotice?.();
                                }}
                                placeholder="community-town-hall"
                            />
                            <Show when={slug()}>
                                <button
                                    type="button" class="ui-button ui-button--sm ui-button--secondary"
                                    onClick={() => { setSlug('',); setSlugTouched(false,); }}
                                    title="Clear and re-derive from the name"
                                >Clear</button>
                            </Show>
                        </div>
                    </FormField>

                    <FormField
                        label="Description"
                        hint="Markdown supported — **bold**, *italic*, [links](/x), lists, > quotes, `code`."
                    >
                        <textarea
                            rows={3} value={description()}
                            onInput={(e,) => setDescription(e.currentTarget.value,)}
                        />
                    </FormField>

                    <FormField label="Location">
                        <input
                            type="text" value={location()} maxLength={255}
                            onInput={(e,) => setLocation(e.currentTarget.value,)}
                            placeholder="Philadelphia, PA"
                        />
                    </FormField>

                    {/* ── When ── */}
                    <div class="event-modal__row">
                        <FormField label={multiDay() ? 'Start date' : 'Date'} required>
                            <input
                                type="date" value={startDate()}
                                onInput={(e,) => setStartDate(e.currentTarget.value,)}
                            />
                        </FormField>
                        <Show when={multiDay()}>
                            <FormField label="End date">
                                <input
                                    type="date" value={endDate()} min={startDate()}
                                    onInput={(e,) => setEndDate(e.currentTarget.value,)}
                                />
                            </FormField>
                        </Show>
                    </div>

                    <div class="event-modal__row">
                        <FormField
                            label="Start time"
                            hint={allDay() ? 'Disabled for an all-day event.' : undefined}
                        >
                            <input
                                type="time" value={startTime()} disabled={allDay()}
                                onInput={(e,) => setStartTime(e.currentTarget.value,)}
                            />
                        </FormField>
                        <FormField label="End time" hint="Optional.">
                            <input
                                type="time" value={endTime()} disabled={allDay()}
                                onInput={(e,) => setEndTime(e.currentTarget.value,)}
                            />
                        </FormField>
                    </div>

                    <div class="event-modal__toggles">
                        {/* Mutually exclusive: "all day" and "multi-day" describe
                            different shapes, and both at once is unrenderable. */}
                        <Show when={!multiDay()}>
                            <FormField label="All-day event" inline>
                                <Toggle checked={allDay()} onChange={setAllDay} ariaLabel="All-day event" />
                            </FormField>
                        </Show>
                        <FormField label="Multi-day event" inline>
                            <Toggle
                                checked={multiDay()}
                                onChange={(v,) => { setMultiDay(v,); if (v) setAllDay(false,); }}
                                ariaLabel="Multi-day event"
                            />
                        </FormField>
                    </div>

                    <FormField label="Timezone">
                        <select value={timezone()} onChange={(e,) => setTimezone(e.currentTarget.value,)}>
                            <option value="">Site default</option>
                            <Show when={timezone() && !isKnownTimeZone(timezone(),)}>
                                <option value={timezone()}>{timezone()}</option>
                            </Show>
                            <For each={TIMEZONES}>{(tz,) => <option value={tz.value}>{tz.label}</option>}</For>
                        </select>
                    </FormField>

                    {/* ── Repeat ── */}
                    <div class="event-modal__row">
                        <FormField label="Repeats">
                            <select value={recurrence()} onChange={(e,) => setRecurrence(e.currentTarget.value,)}>
                                <For each={RECURRENCE_OPTIONS}>
                                    {(o,) => <option value={o.value}>{o.label}</option>}
                                </For>
                            </select>
                        </FormField>
                        <Show when={recurrence()}>
                            <FormField label="Repeat until" hint="Leave empty to repeat indefinitely.">
                                <input
                                    type="date" value={recurrenceUntil()} min={startDate()}
                                    onInput={(e,) => setRecurrenceUntil(e.currentTarget.value,)}
                                />
                            </FormField>
                        </Show>
                    </div>

                    {/* ── Registration ── */}
                    <FormField label="Allow event registration" inline>
                        <Toggle
                            checked={registrationEnabled()}
                            onChange={setRegistrationEnabled}
                            ariaLabel="Allow event registration"
                        />
                    </FormField>

                    <Show when={registrationEnabled()}>
                        <FormField label="Required information" hint="What an attendee must provide.">
                            <div class="event-modal__checks">
                                <For each={EVENT_REGISTRATION_FIELDS}>
                                    {(f,) => (
                                        <label class="event-modal__check">
                                            <input
                                                type="checkbox"
                                                checked={registrationFields().includes(f.key,)}
                                                // Email is the identity a registration is keyed on.
                                                disabled={f.key === 'email'}
                                                onChange={() => toggleField(f.key,)}
                                            />
                                            <span>{f.label}{f.key === 'email' ? ' (always required)' : ''}</span>
                                        </label>
                                    )}
                                </For>
                            </div>
                        </FormField>

                        <FormField label="Show number of registrants on the event page" inline>
                            <Toggle
                                checked={showRegistrantCount()}
                                onChange={setShowRegistrantCount}
                                ariaLabel="Show registrant count"
                            />
                        </FormField>

                        <FormField label="Sell tickets" inline>
                            <Toggle
                                checked={ticketingEnabled()}
                                onChange={(v,) => { setTicketingEnabled(v,); if (v && tiers().length === 0) addTier(); }}
                                ariaLabel="Sell tickets"
                            />
                        </FormField>
                    </Show>

                    {/* ── Ticket tiers ── */}
                    <Show when={registrationEnabled() && ticketingEnabled()}>
                        <div class="event-modal__tiers">
                            <p class="form-help-muted">
                                Leave a quantity empty for unlimited. A zero-priced tier with a
                                quantity is how you run a free event with a capacity limit.
                            </p>
                            {/*
                              * <Index>, not <For>: <For> is keyed by item IDENTITY, and
                              * updateTier replaces the object on every keystroke — so each
                              * character rebuilt the row and the field lost focus. <Index>
                              * keys by POSITION, so the inputs are never recreated.
                              *
                              * State is committed on `change` (which fires on blur/Enter),
                              * not on `input`, so typing is never interrupted mid-value —
                              * "12.50" is no longer read as 1 → 12 → 12.5 → 12.50.
                              */}
                            <Index each={tiers()}>
                                {(tier, i,) => (
                                    <div class="event-modal__tier">
                                        <input
                                            type="text" placeholder="Item name"
                                            value={tier().name ?? ''}
                                            onChange={(e,) => updateTier(i, { name: e.currentTarget.value, },)}
                                        />
                                        <input
                                            type="number" min="0" step="0.01" placeholder="0.00"
                                            value={((tier().priceCents ?? 0) / 100).toFixed(2,)}
                                            onChange={(e,) => updateTier(i, {
                                                priceCents: Math.round(Number(e.currentTarget.value || 0,) * 100,),
                                            },)}
                                        />
                                        <input
                                            type="number" min="0" placeholder="Unlimited"
                                            value={tier().quantityAvailable ?? ''}
                                            onChange={(e,) => updateTier(i, {
                                                quantityAvailable: e.currentTarget.value === ''
                                                    ? null : Number(e.currentTarget.value,),
                                            },)}
                                        />
                                        <button
                                            type="button" class="ui-button ui-button--sm ui-button--danger"
                                            onClick={() => removeTier(i,)}
                                        >✕</button>
                                    </div>
                                )}
                            </Index>
                            <button type="button" class="ui-button ui-button--sm ui-button--secondary" onClick={addTier}>
                                + Add another price
                            </button>
                        </div>
                    </Show>

                    {/* Only meaningful once the event exists and can have
                        attendees — a new event has no occurrence to list. */}
                    <Show when={!isNew() && registrationEnabled() && props.event}>
                        <RegistrantsTable
                            eventId={props.event!.id}
                            occurrenceDate={props.event!.startsAt.slice(0, 10,)}
                        />
                    </Show>

                    <FormField label="Status">
                        <select value={status()} onChange={(e,) => setStatus(e.currentTarget.value as never,)}>
                            <option value="published">Published</option>
                            <option value="draft">Draft</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                    </FormField>
                </div>

                <footer class="event-modal__foot">
                    <Show when={!isNew()}>
                        <button type="button" class="ui-button ui-button--danger" onClick={remove}>Delete</button>
                    </Show>
                    <span class="event-modal__spacer" />
                    <button type="button" class="ui-button ui-button--secondary" onClick={props.onClose}>Cancel</button>
                    <button
                        type="button" class="ui-button ui-button--primary"
                        onClick={save} disabled={!canSave() || saving()}
                    >
                        {saving() ? 'Saving…' : 'Save Event'}
                    </button>
                </footer>
        </ModalShell>
    );
};

export default EventModal;
