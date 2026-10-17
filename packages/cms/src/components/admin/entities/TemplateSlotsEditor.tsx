/**
 * Slots section of the template editor: the data inputs this template exposes,
 * filled later by the `entity` block that USES the template (see
 * `TemplateSlot`). Each row: ID, Label, Data type, Array, and the preview data
 * used while editing (`previewBinding`; absent = auto).
 *
 * Rows live in the PARENT's `createStore` and are patched in place
 * (`setSlots(i, …)`), so `<For>` keeps each row mounted while it is edited.
 * Text fields keep a local draft and commit on blur / Enter.
 */
import {
    type EntityQuery,
    type EntityRecord,
    MAX_TEMPLATE_SLOTS,
    SLOT_AUTO_PREVIEW_ARRAY,
    type SlotBinding,
    type TemplateSlot,
} from '@sitesurge/types';
import { Component, createEffect, createSignal, For, Show, } from 'solid-js';
import { produce, type SetStoreFunction, } from 'solid-js/store';
import { nextSlotId, slotBindingSummary, slotIdError, } from '../../../utils/templateSlots';
import Toggle from '../common/Toggle';
import { FormField, FormRowAction, } from '../forms';
import EntitySearchSelectModal from './EntitySearchSelectModal';
import EntityTypeSelect from './EntityTypeSelect';
import './TemplateSlotsEditor.scss';

/** A text input with a local draft that commits on blur / Enter. `validate`
 *  returning a message keeps the draft and shows it instead of committing. */
const DraftInput: Component<{
    value: string;
    onCommit: (v: string,) => void;
    validate?: (v: string,) => string | null;
    placeholder?: string;
    onError?: (msg: string | null,) => void;
}> = (props,) => {
    let el: HTMLInputElement | undefined;
    const [draft, setDraft,] = createSignal(props.value,);
    createEffect(() => {
        const v = props.value;
        if (document.activeElement !== el) setDraft(v,);
    },);
    const commit = () => {
        const v = draft().trim();
        const err = props.validate?.(v,) ?? null;
        props.onError?.(err,);
        if (err) return;
        if (v !== props.value) props.onCommit(v,);
    };
    return (
        <input
            ref={el}
            type="text"
            value={draft()}
            placeholder={props.placeholder}
            onInput={(e,) => setDraft(e.currentTarget.value,)}
            onBlur={commit}
            onKeyDown={(e,) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        />
    );
};

export interface TemplateSlotsEditorProps {
    slots: TemplateSlot[];
    setSlots: SetStoreFunction<TemplateSlot[]>;
}

type PickerMode = 'single' | 'multiple' | 'query';

const TemplateSlotsEditor: Component<TemplateSlotsEditorProps> = (props,) => {
    const [picker, setPicker,] = createSignal<{ index: number; mode: PickerMode; } | null>(null,);

    const addSlot = () => {
        props.setSlots(produce((s,) => {
            s.push({ id: nextSlotId(s,), entityType: '', array: true, },);
        },),);
    };
    const removeSlot = (i: number,) => props.setSlots(produce((s,) => { s.splice(i, 1,); },),);

    const pickerSlot = () => {
        const p = picker();
        return p ? props.slots[p.index] : undefined;
    };

    const applyPick = (result: EntityRecord | EntityRecord[] | EntityQuery,) => {
        const p = picker();
        if (!p) return;
        let b: SlotBinding;
        if (p.mode === 'single') {
            const r = result as EntityRecord;
            b = { mode: 'single', ref: String(r.id,), };
        } else if (p.mode === 'multiple') {
            b = { mode: 'list', refs: (result as EntityRecord[]).map((r,) => String(r.id,)), };
        } else {
            b = { mode: 'query', query: result as EntityQuery, };
        }
        props.setSlots(p.index, 'previewBinding', b,);
        setPicker(null,);
    };

    return (
        <section class="admin-section template-slots">
            <header class="admin-section__header template-slots__header">
                <div>
                    <h2>Slots</h2>
                    <p class="form-help-muted">
                        Data inputs this template exposes. The block that uses the template chooses the
                        records for each slot; blocks inside the template (Gallery, Posts) can read from a slot.
                    </p>
                </div>
                <button
                    type="button"
                    class="ui-button ui-button--sm ui-button--secondary"
                    onClick={addSlot}
                    disabled={props.slots.length >= MAX_TEMPLATE_SLOTS}
                >
                    + Add slot
                </button>
            </header>

            <Show when={props.slots.length === 0}>
                <p class="form-help-muted template-slots__empty">No slots.</p>
            </Show>

            <For each={props.slots}>
                {(slot, i,) => {
                    const [idError, setIdError,] = createSignal<string | null>(null,);
                    const otherIds = () => props.slots.filter((_, j,) => j !== i()).map((s,) => s.id);
                    return (
                        <div class="template-slots__row">
                            <div class="admin-form-row">
                                <FormField label="ID" error={idError() ?? undefined} hint="Used by blocks to pick this slot.">
                                    <DraftInput
                                        value={slot.id}
                                        validate={(v,) => slotIdError(v, otherIds(),)}
                                        onError={setIdError}
                                        onCommit={(v,) => props.setSlots(i(), 'id', v,)}
                                    />
                                </FormField>
                                <FormField label="Label">
                                    <DraftInput
                                        value={slot.label ?? ''}
                                        placeholder={slot.id}
                                        onCommit={(v,) => props.setSlots(i(), 'label', v || undefined,)}
                                    />
                                </FormField>
                                <FormField label="Data type">
                                    <EntityTypeSelect
                                        value={slot.entityType}
                                        onChange={(key,) => {
                                            props.setSlots(i(), produce((s,) => {
                                                s.entityType = key;
                                                // Preview records of another type are meaningless.
                                                delete s.previewBinding;
                                            },),);
                                        }}
                                    />
                                </FormField>
                                <FormRowAction>
                                    <Toggle
                                        checked={slot.array}
                                        label="Array"
                                        onChange={(next,) => {
                                            props.setSlots(i(), produce((s,) => {
                                                s.array = next;
                                                // A single slot can't keep a list/query preview.
                                                if (!next && s.previewBinding && s.previewBinding.mode !== 'single') {
                                                    delete s.previewBinding;
                                                }
                                            },),);
                                        }}
                                    />
                                    <button
                                        type="button"
                                        class="ui-button ui-button--sm ui-button--ghost template-slots__remove"
                                        aria-label={`Remove slot ${slot.id}`}
                                        title="Remove slot"
                                        onClick={() => removeSlot(i(),)}
                                    >
                                        ×
                                    </button>
                                </FormRowAction>
                            </div>
                            <div class="template-slots__preview">
                                <span class="template-slots__preview-label">Preview data:</span>
                                <span class="template-slots__preview-value">
                                    {slot.previewBinding
                                        ? slotBindingSummary(slot.previewBinding,)
                                        : `Auto (first ${slot.array ? `${SLOT_AUTO_PREVIEW_ARRAY} records` : 'record'})`}
                                </span>
                                <Show when={slot.entityType}>
                                    <Show
                                        when={slot.array}
                                        fallback={
                                            <button
                                                type="button"
                                                class="ui-button ui-button--sm ui-button--outline"
                                                onClick={() => setPicker({ index: i(), mode: 'single', },)}
                                            >
                                                Preview data…
                                            </button>
                                        }
                                    >
                                        <button
                                            type="button"
                                            class="ui-button ui-button--sm ui-button--outline"
                                            onClick={() => setPicker({ index: i(), mode: 'multiple', },)}
                                        >
                                            Pick records…
                                        </button>
                                        <button
                                            type="button"
                                            class="ui-button ui-button--sm ui-button--outline"
                                            onClick={() => setPicker({ index: i(), mode: 'query', },)}
                                        >
                                            Live query…
                                        </button>
                                    </Show>
                                    <Show when={slot.previewBinding}>
                                        <button
                                            type="button"
                                            class="ui-button ui-button--sm ui-button--ghost"
                                            onClick={() => props.setSlots(i(), produce((s,) => { delete s.previewBinding; },),)}
                                        >
                                            Use auto
                                        </button>
                                    </Show>
                                </Show>
                            </div>
                        </div>
                    );
                }}
            </For>

            <Show when={picker() && pickerSlot()?.entityType}>
                <EntitySearchSelectModal
                    entityType={pickerSlot()!.entityType}
                    mode={picker()!.mode}
                    initialQuery={pickerSlot()?.previewBinding?.mode === 'query'
                        ? (pickerSlot()!.previewBinding as { query: EntityQuery; }).query
                        : undefined}
                    onClose={() => setPicker(null,)}
                    onSelect={applyPick}
                />
            </Show>
        </section>
    );
};

export default TemplateSlotsEditor;
