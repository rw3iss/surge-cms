/**
 * DataBindingField — the ONE "Set data…" control. Shows what a binding holds
 * ("Not set" / "3 selected: A, B, C…" / "Live: newest 6 · status = active"),
 * a single **Set data…** button that opens `EntitySearchSelectModal`
 * `mode="data"` (select records OR leave none selected to save a live query),
 * and Clear.
 *
 * Callers store whatever shape their block needs: they map their settings to
 * a `SlotBinding` for `value` and map the saved binding back in `onChange`.
 */
import type { EntityRecord, SlotBinding, } from '@sitesurge/types';
import { Component, createResource, createSignal, JSX, Show, } from 'solid-js';
import { bindingRefs, dataBindingSummary, recordLabel, } from '../../../utils/dataBinding';
import { FormField, } from '../forms';
import EntitySearchSelectModal from './EntitySearchSelectModal';
import { loadRecordRefs, } from './loadRecordRefs';
import './DataBindingField.scss';

export interface DataBindingFieldProps {
    entityType: string;
    value: SlotBinding | null | undefined;
    /** `null` = cleared. */
    onChange: (binding: SlotBinding | null, records: EntityRecord[],) => void;
    /** Field label (omit for a bare control). */
    label?: string;
    tooltip?: string | JSX.Element;
    hint?: string;
    /** false → one record (selecting replaces). Default true. */
    allowMultiple?: boolean;
    /** false → a selection is required. Default true. */
    allowQuery?: boolean;
    maxRecords?: number;
    /** Hide filter clauses / sort in the modal when the caller cannot store them. */
    queryFilters?: boolean;
    querySort?: boolean;
    /** Replaces the computed summary (e.g. a block-specific query reading). */
    summary?: string;
    /** Text when nothing is set. Default "Not set". */
    emptyText?: string;
    /** Clear button label (default "Clear"); `false` hides it. */
    clearLabel?: string | false;
    /** Extra content under the summary (chips, a live preview…). */
    children?: JSX.Element;
}

const DataBindingField: Component<DataBindingFieldProps> = (props,) => {
    const [open, setOpen,] = createSignal(false,);

    // Labels for the summary's first few records.
    const [names,] = createResource(
        () => {
            const refs = bindingRefs(props.value,).slice(0, 3,);
            return refs.length && props.entityType ? { type: props.entityType, refs, } : null;
        },
        async ({ type, refs, },) => {
            const found = await loadRecordRefs(type, refs,);
            const out: Record<string, string> = {};
            for (const [ref, rec,] of found) out[ref] = recordLabel(rec,);
            return out;
        },
    );

    const summaryText = () =>
        props.summary ?? dataBindingSummary(props.value, names.latest, props.emptyText ?? 'Not set',);
    const isSet = () => !!props.value && (props.value.mode === 'query' || bindingRefs(props.value,).length > 0);

    const control = (
        <div class="data-binding-field">
            <div class="data-binding-field__row">
                <span class="data-binding-field__summary" classList={{ 'is-empty': !isSet(), }} title={summaryText()}>
                    {summaryText()}
                </span>
                <button
                    type="button"
                    class="ui-button ui-button--sm ui-button--outline"
                    disabled={!props.entityType}
                    onClick={() => setOpen(true,)}
                >
                    Set data…
                </button>
                <Show when={props.clearLabel !== false && isSet()}>
                    <button type="button" class="ui-button ui-button--sm ui-button--ghost" onClick={() => props.onChange(null, [],)}>
                        {props.clearLabel || 'Clear'}
                    </button>
                </Show>
            </div>
            {props.children}
            <Show when={open()}>
                <EntitySearchSelectModal
                    mode="data"
                    entityType={props.entityType}
                    initial={props.value}
                    allowMultiple={props.allowMultiple}
                    allowQuery={props.allowQuery}
                    maxRecords={props.maxRecords}
                    queryFilters={props.queryFilters}
                    querySort={props.querySort}
                    onClose={() => setOpen(false,)}
                    onSave={(binding, records,) => {
                        setOpen(false,);
                        props.onChange(binding, records,);
                    }}
                />
            </Show>
        </div>
    );

    return (
        <Show when={props.label} fallback={control}>
            <FormField label={props.label!} tooltip={props.tooltip} hint={props.hint}>
                {control}
            </FormField>
        </Show>
    );
};

export default DataBindingField;
