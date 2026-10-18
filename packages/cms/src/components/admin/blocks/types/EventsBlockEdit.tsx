/**
 * Events block editor. Source: **Data** — one "Set data…" (the shared
 * DataBindingField on entity type `event`): ticked events save as a list in
 * the picked order, none ticked saves the filters + sort as a live query
 * (default: upcoming, soonest first, 6) — or, inside a template,
 * **Template data** (the event record(s) the template renders; offered only
 * when the template binds `event`) or **Slot**. Then layout (grid / row /
 * column + its sizes, two fields per row), a heading with its alignment
 * buttons, what each card shows and the empty text.
 *
 * Text / number fields commit on blur (CommitInput); booleans are Toggles.
 */
import type { EventCardDisplay, EventsBlockLayout, SlotBinding, } from '@sitesurge/types';
import { DEFAULT_EVENTS_BINDING, normalizeEventsBlockSettings, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createEffect, createSignal, For, Show, } from 'solid-js';
import { isFeatureEnabled, } from '../../../../stores/siteSettings';
import { templateInfo, templateSlots, } from '../../../../stores/templateSlots';
import { slotChoices, slotOptionLabel, templateDataSourceState, } from '../../../../utils/templateSlots';
import AlignButtons from '../../common/AlignButtons';
import Toggle from '../../common/Toggle';
import DataBindingField from '../../entities/DataBindingField';
import { FormField, } from '../../forms';
import { CommitInput, } from '../../forms/CommitInput';
import './EventsBlockEdit.scss';

const LAYOUTS: { value: EventsBlockLayout; label: string; }[] = [
    { value: 'grid', label: 'Grid', },
    { value: 'row', label: 'Row (horizontal carousel)', },
    { value: 'column', label: 'Column (vertical list)', },
];

/** Display toggles, in card order. */
const TOGGLES: { key: keyof EventCardDisplay; label: string; }[] = [
    { key: 'showImage', label: 'Image', },
    { key: 'showDate', label: 'Date', },
    { key: 'showTime', label: 'Time', },
    { key: 'showLocation', label: 'Location', },
    { key: 'showDescription', label: 'Description', },
    { key: 'showTickets', label: 'Ticket types (price + how many are left)', },
    { key: 'showAccessBadge', label: 'Access badge (Public / Members)', },
    { key: 'showButton', label: 'Button', },
];

const EventsBlockEdit: Component<{
    data: Record<string, any>;
    onUpdate: (d: Record<string, any>,) => void;
}> = (props,) => {
    const d = () => normalizeEventsBlockSettings(props.data,);
    const source = () => d().source;
    const set = (patch: Record<string, unknown>,) => {
        const next: Record<string, unknown> = { ...props.data, ...patch, };
        // The legacy single-event keys are folded into `binding` on first edit.
        if (!next.binding && (next.eventId || next.eventSlug)) next.binding = d().binding;
        delete next.eventId;
        delete next.eventSlug;
        delete next.eventTitle;
        for (const k of Object.keys(next,)) if (next[k] === undefined) delete next[k];
        props.onUpdate(next,);
    };
    const num = (v: string,) => (v.trim() === '' ? undefined : Math.max(1, Math.round(Number(v,),),) || undefined);
    const toggles = (): EventCardDisplay => d();

    const offerSlot = () => templateSlots().length > 0 || source() === 'slot';
    const tplData = () => templateDataSourceState(templateInfo(), 'event', 'events', source() === 'template',);
    const offerSource = () => offerSlot() || tplData().offer;

    const binding = (): SlotBinding => d().binding;

    // The heading's draft (it commits on blur) so its alignment bar enables while typing.
    const [headingDraft, setHeadingDraft,] = createSignal(d().heading ?? '',);
    createEffect(() => setHeadingDraft(d().heading ?? '',),);

    return (
        <div class="events-block-edit block-edit-form">
            <Show when={!isFeatureEnabled('events',)}>
                <div class="alert alert--warning">The Events feature is off — this block shows nothing until it is enabled in Settings → Features.</div>
            </Show>

            <Show when={offerSource()}>
                <FormField
                    label="Source"
                    tooltip="This block's own data, the event(s) this template is rendering, or the events the block using this template puts in a slot."
                    hint={tplData().eachHint ?? undefined}
                >
                    <select
                        value={source()}
                        onChange={(e,) => {
                            const v = e.currentTarget.value;
                            set({ source: v === 'slot' || v === 'template' ? v : undefined, },);
                        }}
                    >
                        <option value="data">Data (selected events or a live query)</option>
                        <Show when={tplData().offer}>
                            <option value="template" disabled={!tplData().compatible}>
                                Template data (the event{templateInfo()?.mode === 'list' ? 's' : ''} this template renders)
                            </option>
                        </Show>
                        <Show when={offerSlot()}>
                            <option value="slot">Slot (from the block using this template)</option>
                        </Show>
                    </select>
                </FormField>
                <Show when={tplData().warning}>
                    <div class="alert alert--warning">{tplData().warning}</div>
                </Show>
            </Show>

            <Show when={source() === 'slot'}>
                <FormField label="Slot" hint="The block that uses this template chooses the events for this slot.">
                    <select value={d().slotId ?? ''} onChange={(e,) => set({ slotId: e.currentTarget.value || undefined, },)}>
                        <option value="">— select a slot —</option>
                        <For each={slotChoices(templateSlots(), 'event',)}>
                            {(c,) => (
                                <option value={c.slot.id} disabled={!c.compatible}>
                                    {slotOptionLabel(c.slot,)}{c.compatible ? '' : ' (incompatible)'}
                                </option>
                            )}
                        </For>
                    </select>
                </FormField>
            </Show>

            <Show when={source() === 'data'}>
                <DataBindingField
                    label="Events"
                    tooltip="Tick events for a fixed selection (shown in the order picked), or tick none to save the filters and sort as a live query — e.g. upcoming = true, sorted by start date. Members-only events only show to viewers who may see them."
                    entityType="event"
                    value={binding()}
                    maxRecords={50}
                    emptyText="No events selected"
                    clearLabel="Reset to upcoming"
                    onChange={(b,) => set({ binding: b ?? DEFAULT_EVENTS_BINDING, },)}
                >
                    <A href="/admin/events" class="form-help-muted">Manage events</A>
                </DataBindingField>
            </Show>

            <div class="admin-form-row events-block-edit__row">
                <FormField label="Layout">
                    <select value={d().layout} onChange={(e,) => set({ layout: e.currentTarget.value as EventsBlockLayout, },)}>
                        <For each={LAYOUTS}>{(l,) => <option value={l.value}>{l.label}</option>}</For>
                    </select>
                </FormField>
            </div>
            <Show when={d().layout === 'grid'}>
                <div class="admin-form-row events-block-edit__row">
                    <FormField label="Columns" tooltip="Cards per row on desktop. Fewer events than columns → one column per event, so the block's alignment can center them.">
                        <CommitInput type="number" min={1} max={6} value={d().columns} onCommit={(v,) => set({ columns: num(v,), },)} />
                    </FormField>
                    <FormField label="Columns (mobile)" tooltip="Cards per row at ≤768px wide.">
                        <CommitInput type="number" min={1} max={4} value={d().columnsMobile} onCommit={(v,) => set({ columnsMobile: num(v,), },)} />
                    </FormField>
                </div>
            </Show>
            <Show when={d().layout === 'row'}>
                <div class="admin-form-row events-block-edit__row">
                    <FormField label="Items per page" tooltip="Cards visible at once on desktop; arrows, dots and swipe page through the rest.">
                        <CommitInput type="number" min={1} max={6} value={d().itemsPerPage} onCommit={(v,) => set({ itemsPerPage: num(v,), },)} />
                    </FormField>
                    <FormField label="Items per page (mobile)" tooltip="Cards visible at once at ≤768px wide.">
                        <CommitInput type="number" min={1} max={4} value={d().itemsPerPageMobile} onCommit={(v,) => set({ itemsPerPageMobile: num(v,), },)} />
                    </FormField>
                </div>
            </Show>
            <div class="admin-form-row events-block-edit__row">
                <FormField label="Gap" tooltip="Space between cards — any CSS length.">
                    <CommitInput value={(props.data.gap as string) ?? ''} placeholder="16px" onCommit={(v,) => set({ gap: v.trim() || undefined, },)} />
                </FormField>
                <FormField
                    label="Item max width"
                    tooltip="Optional maximum card width (e.g. 300px). Empty = cards fill their column (grid), their page share (row) or the block (column). Desktop only — on mobile cards always fill."
                >
                    <CommitInput
                        value={d().itemMaxWidth ?? ''}
                        placeholder="fill"
                        onCommit={(v,) => set({ itemMaxWidth: v.trim() || undefined, itemWidth: undefined, },)}
                    />
                </FormField>
            </div>

            <FormField label="Heading" tooltip="Optional title above the cards. The buttons set its alignment (default center).">
                <div class="events-block-edit__heading">
                    <CommitInput
                        value={d().heading ?? ''}
                        placeholder="e.g. Upcoming events"
                        onDraft={setHeadingDraft}
                        onCommit={(v,) => set({ heading: v.trim() || undefined, },)}
                    />
                    <AlignButtons
                        label="Heading alignment"
                        value={d().headingAlign}
                        disabled={!headingDraft().trim()}
                        onChange={(v,) => set({ headingAlign: v === 'center' ? undefined : v, },)}
                    />
                </div>
            </FormField>

            <FormField label="Show on each card">
                <div class="events-block-edit__toggles">
                    <For each={TOGGLES}>
                        {(t,) => (
                            <Toggle checked={Boolean(toggles()[t.key],)} onChange={(v,) => set({ [t.key]: v, },)} label={t.label} />
                        )}
                    </For>
                </div>
            </FormField>
            <Show when={d().showDescription || d().showButton}>
                <div class="admin-form-row events-block-edit__row">
                    <Show when={d().showDescription}>
                        <FormField label="Description length" tooltip="Characters of the description to show; cut at a word boundary.">
                            <CommitInput type="number" min={20} max={2000} value={d().descriptionLength} onCommit={(v,) => set({ descriptionLength: num(v,), },)} />
                        </FormField>
                    </Show>
                    <Show when={d().showButton}>
                        <FormField label="Button label">
                            <CommitInput value={(props.data.buttonLabel as string) ?? ''} placeholder="View event" onCommit={(v,) => set({ buttonLabel: v.trim() || undefined, },)} />
                        </FormField>
                    </Show>
                </div>
            </Show>

            <FormField label="Empty text" hint="Shown on the site when there are no events. Empty = the block shows nothing.">
                <CommitInput value={d().emptyText ?? ''} placeholder="No upcoming events — check back soon." onCommit={(v,) => set({ emptyText: v.trim() || undefined, },)} />
            </FormField>
        </div>
    );
};

export default EventsBlockEdit;
