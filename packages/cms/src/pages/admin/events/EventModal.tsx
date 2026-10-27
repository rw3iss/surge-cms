/**
 * Create/edit modal for an event, in three tabs with one save bar:
 *
 *   General   name, slug, description, location, when (dates/times/repeat),
 *             who may see / register (access), status
 *   Tickets   registration (required info, registrant count), ticket sales
 *             (types, prices, quantities, required subscription), registrations
 *   Comments  enable / anonymous / lock + the comment count
 *
 * A tab whose fields differ from what was loaded shows a dot after its label
 * (snapshot comparison, so typing a character and deleting it clears it).
 *
 * The date/time fields: an event is one of three shapes and the form enforces
 * exactly one at a time — timed (start time, optional end time), all-day (no
 * times), multi-day (start + end date, optional times). "All day" and
 * "multi-day" are mutually exclusive.
 */
import type { CalendarEvent, CalendarEventInput, EventAccessOverride, EventsSettings, EventTicketTier, SubscriptionTierOption, } from '@sitesurge/types';
import { EVENT_REGISTRATION_FIELDS, generateSlug, isKnownTimeZone, TIMEZONES, } from '@sitesurge/types';
import { Component, createEffect, createMemo, createResource, createSignal, For, Index, on, Show, } from 'solid-js';
import { AccessRuleField, describeAccessRule, } from '../../../components/admin/access/AccessRuleField';
import ModalShell from '../../../components/admin/common/ModalShell';
import Toggle from '../../../components/admin/common/Toggle';
import { FormField, } from '../../../components/admin/forms';
import { CommentSwitchesFields, useCommentSwitches, } from '../../../components/discussions/admin/CommentSwitches';
import { Tabs, } from '../../../components/ui/Tabs';
import { cms, } from '../../../services/cmsClient';
import { isFeatureEnabled, } from '../../../stores/siteSettings';
import RegistrantsTable from './RegistrantsTable';
import { registrantDateChoices, } from './registrantDates';
import './EventModal.scss';
import LocationField from '../../../components/admin/events/LocationField';

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

type Tab = 'general' | 'tickets' | 'comments';

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

const same = (a: unknown, b: unknown,) => JSON.stringify(a,) === JSON.stringify(b,);

const EventModal: Component<EventModalProps> = (props,) => {
    const isNew = () => !props.event;
    const [tab, setTab,] = createSignal<Tab>('general',);

    // ─── General ───
    const [title, setTitle,] = createSignal('',);
    const [slug, setSlug,] = createSignal('',);
    /** Once the user edits the slug we stop deriving it from the title. */
    const [slugTouched, setSlugTouched,] = createSignal(false,);
    const [description, setDescription,] = createSignal('',);
    const [location, setLocation,] = createSignal('',);
    const [locationLabel, setLocationLabel,] = createSignal<string | null>(null,);
    const [locationLat, setLocationLat,] = createSignal<number | null>(null,);
    const [locationLng, setLocationLng,] = createSignal<number | null>(null,);
    const [showMap, setShowMap,] = createSignal(false,);
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
    const [viewAccess, setViewAccess,] = createSignal<EventAccessOverride>('inherit',);
    const [viewTier, setViewTier,] = createSignal<string | null>(null,);
    const [registerAccess, setRegisterAccess,] = createSignal<EventAccessOverride>('inherit',);
    const [registerTier, setRegisterTier,] = createSignal<string | null>(null,);

    // ─── Tickets ───
    const [registrationEnabled, setRegistrationEnabled,] = createSignal(false,);
    const [registrationFields, setRegistrationFields,] = createSignal<string[]>(['name', 'email',],);
    const [showRegistrantCount, setShowRegistrantCount,] = createSignal(false,);
    const [ticketingEnabled, setTicketingEnabled,] = createSignal(false,);
    const [tiers, setTiers,] = createSignal<Array<Partial<EventTicketTier>>>([],);

    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    // Site defaults (Settings → Events) + subscription tiers, for the access pickers.
    const [settings,] = createResource(() => cms.events.settings().catch(() => null as EventsSettings | null),);
    const [tierOptions,] = createResource(() => cms.subscriptionTiers.options().catch(() => [] as SubscriptionTierOption[]),);
    const tiersList = () => tierOptions() ?? [];
    const inheritView = () => describeAccessRule(settings()?.viewAccess ?? 'public', settings()?.viewMinTierId, tiersList(),);
    const inheritRegister = () => describeAccessRule(settings()?.registerAccess ?? 'public', settings()?.registerMinTierId, tiersList(),);
    const ticketsAllowed = () => settings()?.allowTicketing !== false;

    // ─── Dirty tracking per tab (snapshot vs what was loaded) ───
    const generalState = () => ({
        title: title(), slug: slug(), description: description(), location: location(),
        locationLabel: locationLabel(), locationLat: locationLat(), locationLng: locationLng(), showMap: showMap(),
        startDate: startDate(), startTime: startTime(), endDate: endDate(), endTime: endTime(),
        allDay: allDay(), multiDay: multiDay(), timezone: timezone(), recurrence: recurrence(), recurrenceUntil: recurrenceUntil(),
        status: status(), viewAccess: viewAccess(), viewTier: viewTier(), registerAccess: registerAccess(), registerTier: registerTier(),
    });
    const ticketsState = () => ({
        registrationEnabled: registrationEnabled(), registrationFields: registrationFields(), showRegistrantCount: showRegistrantCount(),
        ticketingEnabled: ticketingEnabled(),
        tiers: tiers().map((t,) => ({ name: t.name ?? '', priceCents: t.priceCents ?? 0, quantityAvailable: t.quantityAvailable ?? null, maxPerOrder: t.maxPerOrder ?? null, requiredTierId: t.requiredTierId ?? null, })),
    });
    const [baseGeneral, setBaseGeneral,] = createSignal<unknown>(null,);
    const [baseTickets, setBaseTickets,] = createSignal<unknown>(null,);
    const generalDirty = createMemo(() => baseGeneral() !== null && !same(baseGeneral(), generalState(),),);
    const ticketsDirty = createMemo(() => baseTickets() !== null && !same(baseTickets(), ticketsState(),),);

    // Seed from the event being edited, or from the day the user clicked.
    // Keyed on the EVENT only (`on`): the dirty snapshots below read every
    // field, and a plain effect then re-ran on each edit — re-seeding the form
    // from the saved event, so nothing on the General tab could be changed.
    createEffect(on(() => props.event, (e,) => {
        setBaseGeneral(null,);
        setBaseTickets(null,);
        if (e) {
            setTitle(e.title,);
            setSlug(e.slug,);
            setSlugTouched(true,);
            setDescription(e.description ?? '',);
            setLocation(e.location ?? '',);
            setLocationLabel(e.locationLabel ?? null,);
            setLocationLat(e.locationLat ?? null,);
            setLocationLng(e.locationLng ?? null,);
            setShowMap(Boolean(e.showMap,),);
            const s = splitIso(e.startsAt,);
            setStartDate(s.date,);
            setStartTime(s.time,);
            const en = splitIso(e.endsAt,);
            setEndDate(en.date,);
            setEndTime(en.time,);
            setAllDay(e.allDay,);
            setMultiDay(Boolean(e.endsAt && en.date && en.date !== s.date,),);
            setTimezone(e.timezone ?? props.defaultTimezone ?? '',);
            setRecurrence(e.recurrenceRule ?? '',);
            setRecurrenceUntil(e.recurrenceUntil ? splitIso(e.recurrenceUntil,).date : '',);
            setStatus(e.status,);
            setViewAccess(e.viewAccess ?? 'inherit',);
            setViewTier(e.viewMinTierId ?? null,);
            setRegisterAccess(e.registerAccess ?? 'inherit',);
            setRegisterTier(e.registerMinTierId ?? null,);
            setRegistrationEnabled(e.registrationEnabled,);
            setRegistrationFields(e.registrationFields ?? ['name', 'email',],);
            setShowRegistrantCount(e.showRegistrantCount,);
            setTicketingEnabled(e.ticketingEnabled,);
            setBaseGeneral(generalState(),);
            void loadTiers(e.id,);
        } else {
            // Today in the operator's LOCAL calendar (`toISOString()` is UTC).
            const now = new Date();
            const today = `${now.getFullYear()}-${String(now.getMonth() + 1,).padStart(2, '0',)}-${String(now.getDate(),).padStart(2, '0',)}`;
            setStartDate(props.defaultDate || today,);
            setTimezone(props.defaultTimezone ?? '',);
            setBaseGeneral(generalState(),);
            setBaseTickets(ticketsState(),);
        }
    },),);

    const loadTiers = async (eventId: string,) => {
        try {
            const date = splitIso(props.event?.startsAt ?? null,).date;
            setTiers(await cms.events.tiers(eventId, date,),);
        } catch { /* no tiers yet */ }
        setBaseTickets(ticketsState(),);
    };

    // Auto-derive the slug from the title until the user takes it over.
    createEffect(() => {
        const t = title();
        if (!slugTouched() && t) setSlug(generateSlug(t,),);
    },);

    const toggleField = (key: string,) => {
        setRegistrationFields((prev,) => prev.includes(key,) ? prev.filter((k,) => k !== key) : [...prev, key,]);
    };

    const addTier = () =>
        setTiers((t,) => [...t, {
            name: t.length === 0 ? 'General admission' : '',
            priceCents: 0,
            currency: props.defaultCurrency ?? 'USD',
            quantityAvailable: null,
            maxPerOrder: null,
            requiredTierId: null,
        },]);
    const updateTier = (i: number, patch: Partial<EventTicketTier>,) =>
        setTiers((t,) => t.map((x, idx,) => (idx === i ? { ...x, ...patch, } : x)));
    const removeTier = (i: number,) => setTiers((t,) => t.filter((_, idx,) => idx !== i));

    const canSave = createMemo(() => Boolean(title().trim() && startDate(),));

    // Enable commenting / anonymous / lock (Comments feature) — saved with the event.
    // ── Registrations: which occurrence's list (a series has one per date) ──
    const registrantDates = createMemo(() => (props.event ? registrantDateChoices(props.event,) : { choices: [], initial: '', }));
    const [pickedRegistrantDate, setRegistrantDate,] = createSignal<string | null>(null,);
    const registrantDate = () => {
        const picked = pickedRegistrantDate();
        return picked && registrantDates().choices.some((c,) => c.date === picked,) ? picked : registrantDates().initial;
    };

    const commentSwitches = useCommentSwitches('event', () => props.event?.id ?? null,);
    const commentsOn = () => isFeatureEnabled('comments',);

    const tabs = () => [
        { value: 'general' as const, label: 'General', dirty: generalDirty(), },
        { value: 'tickets' as const, label: 'Tickets & Registration', dirty: ticketsDirty(), },
        { value: 'comments' as const, label: 'Comments', dirty: commentSwitches.isDirty(), },
    ];

    const save = async () => {
        if (!canSave() || saving()) return;
        setSaving(true,);
        setError('',);
        try {
            const startsAt = joinIso(startDate(), startTime(), allDay(),);
            if (!startsAt) throw new Error('A start date is required.',);
            // Multi-day uses the end DATE; a same-day event with an end time uses the start date.
            const endsAt = multiDay()
                ? joinIso(endDate() || startDate(), endTime(), allDay(),)
                : (endTime() ? joinIso(startDate(), endTime(), false,) : null);
            if (endsAt && new Date(endsAt,) < new Date(startsAt,)) throw new Error('The event cannot end before it starts.',);
            if (viewAccess() === 'tier' && !viewTier()) throw new Error('Choose the membership tier that can see this event.',);
            if (registerAccess() === 'tier' && !registerTier()) throw new Error('Choose the membership tier that can register.',);

            const body: CalendarEventInput = {
                title: title().trim(),
                slug: slug().trim() || undefined,
                description: description().trim() || null,
                location: location().trim() || null,
                locationLabel: locationLabel()?.trim() || null,
                locationLat: locationLat(),
                locationLng: locationLng(),
                showMap: showMap(),
                startsAt,
                endsAt,
                allDay: allDay(),
                timezone: timezone() || null,
                recurrenceRule: recurrence() || null,
                recurrenceUntil: recurrence() && recurrenceUntil() ? joinIso(recurrenceUntil(), '23:59', false,) : null,
                status: status(),
                viewAccess: viewAccess(),
                viewMinTierId: viewAccess() === 'tier' ? viewTier() : null,
                registerAccess: registerAccess(),
                registerMinTierId: registerAccess() === 'tier' ? registerTier() : null,
                registrationEnabled: registrationEnabled(),
                registrationFields: registrationFields(),
                showRegistrantCount: showRegistrantCount(),
                ticketingEnabled: ticketingEnabled(),
            };

            const saved = props.event ? await cms.events.update(props.event.id, body,) : await cms.events.create(body,);
            await commentSwitches.save(saved.id,);

            // Tiers are a separate resource; only write them when relevant.
            if (ticketingEnabled()) {
                await cms.events.replaceTiers(
                    saved.id,
                    tiers().map((t, i,) => ({
                        id: t.id,
                        name: (t.name || 'Ticket').trim(),
                        priceCents: Number(t.priceCents ?? 0,),
                        currency: t.currency || props.defaultCurrency || 'USD',
                        quantityAvailable: t.quantityAvailable ?? null,
                        maxPerOrder: t.maxPerOrder ?? null,
                        position: i,
                        requiredTierId: t.requiredTierId ?? null,
                    })),
                );
            }
            setBaseGeneral(generalState(),);
            setBaseTickets(ticketsState(),);

            // The server owns slug uniqueness ("summer-gala" → "summer-gala-1"):
            // show the real slug rather than closing on a value that is no longer true.
            const requested = body.slug;
            if (requested && saved.slug !== requested) {
                setSlug(saved.slug,);
                setSlugTouched(true,);
                setBaseGeneral(generalState(),);
                props.onSaved(saved, { keepOpen: true, notice: `"${requested}" was already taken, so this event was saved as "${saved.slug}".`, },);
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

    const paidTiers = () => tiersList().filter((t,) => !t.isFree,);

    return (
        <ModalShell
            open
            size="lg"
            showClose
            // This modal holds a lot of state: it closes only via Cancel or ✕.
            dismissOnBackdrop={false}
            onClose={props.onClose}
            ariaLabel={isNew() ? 'New event' : 'Edit event'}
            class="event-modal"
        >
            <header class="event-modal__head">
                <h2>{isNew() ? 'New Event' : title() || 'Edit Event'}</h2>
                <Tabs items={tabs()} value={tab()} onChange={setTab} size="sm" />
            </header>

            <div class="event-modal__body">
                <Show when={error()}>
                    <div class="alert alert--error">{error()}</div>
                </Show>

                {/* ════════ General ════════ */}
                <Show when={tab() === 'general'}>
                    <section class="event-modal__section">
                        <div class="event-modal__row event-modal__row--name">
                            <FormField label="Event name" required>
                                <input type="text" value={title()} maxLength={255} onInput={(e,) => setTitle(e.currentTarget.value,)} placeholder="Community Town Hall" />
                            </FormField>
                            <FormField label="Status">
                                <select value={status()} onChange={(e,) => setStatus(e.currentTarget.value as never,)}>
                                    <option value="published">Published</option>
                                    <option value="draft">Draft</option>
                                    <option value="cancelled">Cancelled</option>
                                </select>
                            </FormField>
                        </div>
                        <Show when={props.notice}>
                            <div class="alert alert--warning">{props.notice}</div>
                        </Show>
                        <div class="event-modal__row">
                            <FormField label="URL slug" hint="The end of the event's public address.">
                                <div class="event-modal__slug">
                                    <input
                                        type="text"
                                        value={slug()}
                                        onInput={(e,) => {
                                            setSlug(e.currentTarget.value,);
                                            setSlugTouched(true,);
                                            // The notice describes the value just replaced.
                                            props.onDismissNotice?.();
                                        }}
                                        placeholder="community-town-hall"
                                    />
                                    <Show when={slug()}>
                                        <button
                                            type="button"
                                            class="ui-button ui-button--sm ui-button--ghost"
                                            onClick={() => { setSlug('',); setSlugTouched(false,); }}
                                            title="Clear and re-derive from the name"
                                        >
                                            Reset
                                        </button>
                                    </Show>
                                </div>
                            </FormField>
                        </div>
                        <LocationField
                            location={location()}
                            lat={locationLat()}
                            lng={locationLng()}
                            showMap={showMap()}
                            label={locationLabel()}
                            onLabel={setLocationLabel}
                            onLocation={setLocation}
                            onPoint={(lat, lng,) => { setLocationLat(lat,); setLocationLng(lng,); }}
                            onShowMap={setShowMap}
                        />
                        <FormField label="Description" hint="Markdown: **bold**, *italic*, [links](/x), lists, > quotes, `code`.">
                            <textarea rows={4} value={description()} onInput={(e,) => setDescription(e.currentTarget.value,)} />
                        </FormField>
                    </section>

                    <section class="event-modal__section">
                        <h3 class="event-modal__section-title">When</h3>
                        {/* Date(s) take half the row, each time a quarter. */}
                        <div class="event-modal__when">
                            <FormField label={multiDay() ? 'Start date' : 'Date'} required class={multiDay() ? '' : 'event-modal__when-date'}>
                                <input type="date" value={startDate()} onInput={(e,) => setStartDate(e.currentTarget.value,)} />
                            </FormField>
                            <Show when={multiDay()}>
                                <FormField label="End date">
                                    <input type="date" value={endDate()} min={startDate()} onInput={(e,) => setEndDate(e.currentTarget.value,)} />
                                </FormField>
                            </Show>
                            <FormField label="Start time">
                                <input type="time" value={startTime()} disabled={allDay()} onInput={(e,) => setStartTime(e.currentTarget.value,)} />
                            </FormField>
                            <FormField label="End time" hint={allDay() ? undefined : 'Optional'}>
                                <input type="time" value={endTime()} disabled={allDay()} onInput={(e,) => setEndTime(e.currentTarget.value,)} />
                            </FormField>
                        </div>
                        <div class="event-modal__toggles">
                            {/* Mutually exclusive: both at once is unrenderable. */}
                            <Show when={!multiDay()}>
                                <Toggle checked={allDay()} onChange={setAllDay} label="All day" />
                            </Show>
                            <Toggle checked={multiDay()} onChange={(v,) => { setMultiDay(v,); if (v) setAllDay(false,); }} label="Multiple days" />
                        </div>
                        <div class="event-modal__row event-modal__row--3">
                            <FormField label="Timezone">
                                <select value={timezone()} onChange={(e,) => setTimezone(e.currentTarget.value,)}>
                                    <option value="">Site default</option>
                                    <Show when={timezone() && !isKnownTimeZone(timezone(),)}>
                                        <option value={timezone()}>{timezone()}</option>
                                    </Show>
                                    <For each={TIMEZONES}>{(tz,) => <option value={tz.value}>{tz.label}</option>}</For>
                                </select>
                            </FormField>
                            <FormField label="Repeats">
                                <select value={recurrence()} onChange={(e,) => setRecurrence(e.currentTarget.value,)}>
                                    <For each={RECURRENCE_OPTIONS}>{(o,) => <option value={o.value}>{o.label}</option>}</For>
                                </select>
                            </FormField>
                            <Show when={recurrence()}>
                                <FormField label="Repeat until" hint="Empty = no end">
                                    <input type="date" value={recurrenceUntil()} min={startDate()} onInput={(e,) => setRecurrenceUntil(e.currentTarget.value,)} />
                                </FormField>
                            </Show>
                        </div>
                    </section>

                    <section class="event-modal__section">
                        <h3 class="event-modal__section-title">Access</h3>
                        <p class="event-modal__section-help">
                            Seeing an event and registering for it are separate: an event can be listed for everyone
                            while only members may register. Inherit follows <a href="/admin/events/settings">Event Settings</a>.
                        </p>
                        <div class="event-modal__row">
                            <AccessRuleField
                                label="Who can see it"
                                tooltip="Who sees the event in the calendar and can open its page."
                                rule={viewAccess()}
                                tierId={viewTier()}
                                tiers={tiersList()}
                                allowInherit
                                inheritLabel={inheritView()}
                                onChange={(r, t,) => { setViewAccess(r,); setViewTier(t,); }}
                            />
                            <AccessRuleField
                                label="Who can register"
                                tooltip="Who can register or get tickets. Never looser than who can see it."
                                rule={registerAccess()}
                                tierId={registerTier()}
                                tiers={tiersList()}
                                allowInherit
                                inheritLabel={inheritRegister()}
                                onChange={(r, t,) => { setRegisterAccess(r,); setRegisterTier(t,); }}
                            />
                        </div>
                    </section>
                </Show>

                {/* ════════ Tickets ════════ */}
                <Show when={tab() === 'tickets'}>
                    <section class="event-modal__section">
                        <h3 class="event-modal__section-title">Registration</h3>
                        <Toggle
                            checked={registrationEnabled()}
                            onChange={setRegistrationEnabled}
                            label="Allow registration"
                            hint="Visitors sign up for a date of this event (subject to Who can register on the General tab)."
                        />
                        <Show when={registrationEnabled()}>
                            <FormField label="Information to collect" hint="Email is always required — it identifies the registration.">
                                <div class="event-modal__checks">
                                    <For each={EVENT_REGISTRATION_FIELDS}>
                                        {(f,) => (
                                            <Toggle
                                                checked={registrationFields().includes(f.key,)}
                                                disabled={f.key === 'email'}
                                                onChange={() => toggleField(f.key,)}
                                                label={f.label}
                                            />
                                        )}
                                    </For>
                                </div>
                            </FormField>
                            <Toggle checked={showRegistrantCount()} onChange={setShowRegistrantCount} label="Show the number of registrants on the event page" />
                        </Show>
                    </section>

                    <section class="event-modal__section">
                        <h3 class="event-modal__section-title">Ticket sales</h3>
                        <Show
                            when={ticketsAllowed()}
                            fallback={<p class="form-help-muted">Ticket sales are off for the site. Turn them on in <a href="/admin/events/settings">Event Settings</a>.</p>}
                        >
                            <Toggle
                                checked={ticketingEnabled()}
                                disabled={!registrationEnabled()}
                                onChange={(v,) => { setTicketingEnabled(v,); if (v && tiers().length === 0) addTier(); }}
                                label="Sell tickets"
                                hint={registrationEnabled() ? 'Buyers become registrants. Paid tickets go through the shop checkout.' : 'Turn on registration first.'}
                            />
                            <Show when={registrationEnabled() && ticketingEnabled()}>
                                <div class="event-modal__tiers">
                                    <div class="event-modal__tier event-modal__tier--head" aria-hidden="true">
                                        <span>Ticket type</span><span>Price</span><span>Quantity</span><span>Per person</span><span>Requires membership</span><span />
                                    </div>
                                    {/*
                                      * <Index> (keyed by POSITION), not <For>: updateTier replaces the
                                      * object, and <For> would rebuild the row and drop focus. Values
                                      * commit on `change` (blur/Enter) so "12.50" is not read mid-typing.
                                      */}
                                    <Index each={tiers()}>
                                        {(tier, i,) => (
                                            <div class="event-modal__tier">
                                                <input type="text" placeholder="Ticket name" aria-label="Ticket type" value={tier().name ?? ''} onChange={(e,) => updateTier(i, { name: e.currentTarget.value, },)} />
                                                <input
                                                    type="number" min="0" step="0.01" placeholder="0.00" aria-label="Price"
                                                    value={((tier().priceCents ?? 0) / 100).toFixed(2,)}
                                                    onChange={(e,) => updateTier(i, { priceCents: Math.round(Number(e.currentTarget.value || 0,) * 100,), },)}
                                                />
                                                <input
                                                    type="number" min="0" placeholder="Unlimited" aria-label="Quantity"
                                                    value={tier().quantityAvailable ?? ''}
                                                    onChange={(e,) => updateTier(i, { quantityAvailable: e.currentTarget.value === '' ? null : Number(e.currentTarget.value,), },)}
                                                />
                                                <input
                                                    type="number" min="1" placeholder="No limit" aria-label="Most per person"
                                                    value={tier().maxPerOrder ?? ''}
                                                    onChange={(e,) => updateTier(i, { maxPerOrder: e.currentTarget.value === '' ? null : Math.max(1, Math.floor(Number(e.currentTarget.value,),),), },)}
                                                />
                                                <select
                                                    aria-label="Requires membership"
                                                    value={tier().requiredTierId ?? ''}
                                                    onChange={(e,) => updateTier(i, { requiredTierId: e.currentTarget.value || null, },)}
                                                >
                                                    <option value="">Anyone</option>
                                                    <For each={paidTiers()}>{(t,) => <option value={t.id}>{t.name} and up</option>}</For>
                                                </select>
                                                <button type="button" class="ui-button ui-button--sm ui-button--ghost event-modal__tier-remove" title="Remove this ticket type" onClick={() => removeTier(i,)}>✕</button>
                                            </div>
                                        )}
                                    </Index>
                                    <div class="event-modal__tiers-foot">
                                        <button type="button" class="ui-button ui-button--sm ui-button--secondary" onClick={addTier}>+ Add ticket type</button>
                                        <span class="form-help-muted">
                                            Empty quantity = unlimited. A free type with a quantity runs a free event with a capacity.
                                            Per person caps how many of a type one email address may hold for a date.
                                            A required membership limits who can buy that type.
                                        </span>
                                    </div>
                                </div>
                            </Show>
                        </Show>
                    </section>

                    <Show
                        when={!isNew() && registrationEnabled() && props.event}
                        fallback={<Show when={isNew()}><p class="form-help-muted">Registrations appear here after the event is saved.</p></Show>}
                    >
                        <section class="event-modal__section">
                            {/* A series has one attendee list per date — pick which. */}
                            <Show when={registrantDates().choices.length > 1}>
                                <FormField label="Registrations for">
                                    <select value={registrantDate()} onChange={(e,) => setRegistrantDate(e.currentTarget.value,)}>
                                        <For each={registrantDates().choices}>{(c,) => <option value={c.date}>{c.label}</option>}</For>
                                    </select>
                                </FormField>
                            </Show>
                            <RegistrantsTable eventId={props.event!.id} occurrenceDate={registrantDate()} />
                        </section>
                    </Show>
                </Show>

                {/* ════════ Comments ════════ */}
                <Show when={tab() === 'comments'}>
                    <section class="event-modal__section">
                        <Show
                            when={commentsOn()}
                            fallback={<p class="form-help-muted">Comments are off for the site. Turn on the Comments feature in <a href="/admin/settings?tab=general#features">Settings → Features</a>.</p>}
                        >
                            <CommentSwitchesFields ctl={commentSwitches} />
                        </Show>
                    </section>
                </Show>
            </div>

            <footer class="event-modal__foot">
                <Show when={!isNew()}>
                    <button type="button" class="ui-button ui-button--danger" onClick={remove}>Delete</button>
                </Show>
                <span class="event-modal__spacer" />
                <Show when={generalDirty() || ticketsDirty() || commentSwitches.isDirty()}>
                    <span class="event-modal__unsaved">Unsaved changes</span>
                </Show>
                <button type="button" class="ui-button ui-button--secondary" onClick={props.onClose}>Cancel</button>
                <button type="button" class="ui-button ui-button--primary" onClick={save} disabled={!canSave() || saving()}>
                    {saving() ? 'Saving…' : isNew() ? 'Create Event' : 'Save Event'}
                </button>
            </footer>
        </ModalShell>
    );
};

export default EventModal;
