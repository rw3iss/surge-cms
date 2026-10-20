/**
 * "Slots" — fill a template's / component's declared data inputs, one
 * **Set data…** per slot (records, or a live query). Shared by the Entity block
 * (its template's slots) and the Component (`template`) block, so both fill
 * slots the same way. Writes `Record<slotId, SlotBinding>`; a cleared slot is
 * removed from the map.
 */
import type { EntityBinding, EntityQuery, SlotBinding, TemplateSlot, } from '@sitesurge/types';
import { Component, For, Show, } from 'solid-js';
import { slotDisplayName, slotTypeLabel, } from '../../../utils/templateSlots';
import DataBindingField from './DataBindingField';
import EntityBindingSummary from './EntityBindingSummary';

/** What a binding points at, for the summary under its Set data… button. */
export function bindingSummaryProps(b: SlotBinding | EntityBinding | undefined,): { refs?: string[]; query?: EntityQuery; } {
    if (!b) return {};
    if (b.mode === 'single') return { refs: b.ref ? [b.ref,] : undefined, };
    if (b.mode === 'list') return { refs: b.refs, };
    if (b.mode === 'query') return { query: b.query, };
    return {};
}

const SlotBindingsField: Component<{
    slots: TemplateSlot[];
    value: Record<string, SlotBinding> | undefined;
    onChange: (next: Record<string, SlotBinding>,) => void;
}> = (props,) => {
    const set = (id: string, b: SlotBinding | undefined,) => {
        const next = { ...(props.value ?? {}), };
        if (b) next[id] = b;
        else delete next[id];
        props.onChange(next,);
    };
    return (
        <Show when={props.slots.length > 0}>
            <div class="block-edit-form__field entity-block-edit__slots">
                <span class="admin-form-field__label">Slots</span>
                <For each={props.slots}>
                    {(slot,) => {
                        const binding = () => props.value?.[slot.id];
                        return (
                            <div class="entity-block-edit__slot">
                                <div class="entity-block-edit__slot-head">
                                    <strong>{slotDisplayName(slot,)}</strong>
                                    <code>{slotTypeLabel(slot,)}</code>
                                </div>
                                <DataBindingField
                                    entityType={slot.entityType}
                                    value={binding()}
                                    allowMultiple={slot.array}
                                    onChange={(b,) => set(slot.id, b ?? undefined,)}
                                >
                                    {/* What the slot resolves to right now (records, or a query's current matches). */}
                                    <Show when={binding()}>
                                        <EntityBindingSummary
                                            entityType={slot.entityType}
                                            refs={bindingSummaryProps(binding(),).refs}
                                            query={bindingSummaryProps(binding(),).query}
                                        />
                                    </Show>
                                </DataBindingField>
                            </div>
                        );
                    }}
                </For>
            </div>
        </Show>
    );
};

export default SlotBindingsField;
