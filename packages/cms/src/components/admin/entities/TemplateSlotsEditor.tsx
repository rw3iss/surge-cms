/**
 * Slots section of the template editor: the data inputs this template exposes,
 * filled later by the `entity` block that USES the template (see
 * `TemplateSlot`). Each row: ID + Label, then Data type + Array (remove button
 * centred at the right), and the preview data
 * used while editing (`previewBinding`; absent = auto).
 *
 * Rows live in the PARENT's `createStore` and are patched in place
 * (`setSlots(i, …)`), so `<For>` keeps each row mounted while it is edited.
 * Text fields keep a local draft and commit on blur / Enter.
 */
import {
    MAX_TEMPLATE_SLOTS,
    SLOT_AUTO_PREVIEW_ARRAY,
    type SlotBinding,
    type TemplateSlot,
} from '@sitesurge/types';
import { Component, createSignal, For, Show, } from 'solid-js';
import { produce, type SetStoreFunction, } from 'solid-js/store';
import { nextSlotId, slotIdError, } from '../../../utils/templateSlots';
import Toggle from '../common/Toggle';
import { FormField, FormRowAction, } from '../forms';
import DataBindingField from './DataBindingField';
import EntityTypeSelect from './EntityTypeSelect';
import { CommitInput, } from '../forms/CommitInput';
import './TemplateSlotsEditor.scss';

/** Shared commit-on-blur input (validate keeps the draft and reports the error). */
const DraftInput = CommitInput;

export interface TemplateSlotsEditorProps {
    slots: TemplateSlot[];
    setSlots: SetStoreFunction<TemplateSlot[]>;
}

const TemplateSlotsEditor: Component<TemplateSlotsEditorProps> = (props,) => {
    const addSlot = () => {
        props.setSlots(produce((s,) => {
            s.push({ id: nextSlotId(s,), entityType: '', array: true, },);
        },),);
    };
    const removeSlot = (i: number,) => props.setSlots(produce((s,) => { s.splice(i, 1,); },),);

    const setPreview = (i: number, b: SlotBinding | null,) =>
        props.setSlots(i, produce((s,) => {
            if (b) s.previewBinding = b;
            else delete s.previewBinding;
        },),);

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
                            {/* Two lines — ID + Label, then Data type + Array — with the
                                remove button centred against the row's right edge. */}
                            <div class="template-slots__main">
                                <div class="template-slots__fields">
                                    <div class="admin-form-row template-slots__line">
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
                                    </div>
                                    <div class="admin-form-row template-slots__line">
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
                                        </FormRowAction>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    class="ui-button ui-button--sm ui-button--ghost template-slots__remove"
                                    aria-label={`Remove slot ${slot.id}`}
                                    title="Remove slot"
                                    onClick={() => removeSlot(i(),)}
                                >
                                    ×
                                </button>
                            </div>
                            <div class="template-slots__preview">
                                <span class="template-slots__preview-label">Preview data:</span>
                                <Show
                                    when={slot.entityType}
                                    fallback={<span class="form-help-muted">Choose a data type first.</span>}
                                >
                                    <DataBindingField
                                        entityType={slot.entityType}
                                        value={slot.previewBinding}
                                        allowMultiple={slot.array}
                                        emptyText={`Auto (first ${slot.array ? `${SLOT_AUTO_PREVIEW_ARRAY} records` : 'record'})`}
                                        clearLabel="Use auto"
                                        onChange={(b,) => setPreview(i(), b,)}
                                    />
                                </Show>
                            </div>
                        </div>
                    );
                }}
            </For>

        </section>
    );
};

export default TemplateSlotsEditor;
