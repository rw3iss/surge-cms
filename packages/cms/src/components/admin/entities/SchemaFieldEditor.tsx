/**
 * SchemaFieldEditor — edits the field list of an entity type's schema.
 *
 * CORE fields (`field.core === true`) are locked: shown read-only with a
 * "core" badge and no controls. Non-core fields are fully editable —
 * key/label/type + flags (required/unique/indexed/searchable), enum values,
 * relation target, numeric min/max, and a default value — plus add/remove.
 *
 * Controlled: the parent owns the `fields` array and receives a new array on
 * every change via `onChange`.
 *
 * FOCUS: two deliberate choices keep the caret where the user put it.
 *  1. Text inputs commit on `change` (blur / Enter), NOT `onInput` — state
 *     does not move while you are typing.
 *  2. The rows use `<Index>`, not `<For>`. `patch()` returns a NEW object for
 *     the edited field, and `<For>` keys by object identity, so that row's DOM
 *     was disposed and rebuilt on every commit — which blew away focus (and
 *     broke Tab between Key and Label). `<Index>` keys by position, so the
 *     input elements persist and only their reactive bindings update.
 */
import type { EntityFieldDef, EntityFieldOption, EntityFieldType, } from '@sitesurge/types';
import { Component, Index, Show, } from 'solid-js';
import FormCheck from '../forms/FormCheck';
import FormField from '../forms/FormField';

/** The full field-type vocabulary, in a sensible authoring order. */
export const ENTITY_FIELD_TYPES: EntityFieldType[] = [
    'text',
    'longtext',
    'richtext',
    'markdown',
    'slug',
    'number',
    'integer',
    'boolean',
    'date',
    'datetime',
    'enum',
    'json',
    'media',
    'relation',
    'blocks',
];

export interface SchemaFieldEditorProps {
    fields: EntityFieldDef[];
    onChange: (fields: EntityFieldDef[],) => void;
    /** Disable ALL editing (rare — e.g. a fully locked internal type). */
    disabled?: boolean;
}

function newFieldId(): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID ?
        crypto.randomUUID() :
        `f_${Math.abs(Date.now() ^ (performance.now() * 1000),)}`;
}

const SchemaFieldEditor: Component<SchemaFieldEditorProps> = (props,) => {
    const patch = (id: string, changes: Partial<EntityFieldDef>,) => {
        props.onChange(props.fields.map((f,) => (f.id === id ? { ...f, ...changes, } : f)),);
    };

    const patchOptions = (id: string, changes: Record<string, unknown>,) => {
        const field = props.fields.find((f,) => f.id === id,);
        patch(id, { options: { ...(field?.options ?? {}), ...changes, }, },);
    };

    /** The enum option rows for a field (label/value pairs). Falls back to
     *  legacy `options.values` (label = value) so old enum fields still edit. */
    const enumOptionsOf = (field: EntityFieldDef,): EntityFieldOption[] => {
        if (field.options?.enumOptions?.length) return field.options.enumOptions;
        if (field.options?.values?.length) return field.options.values.map((v,) => ({ label: v, value: v, }));
        return [];
    };

    /** Persist enum rows: keep `enumOptions` (label/value) AND `values` (the raw
     *  values, which back the DB CHECK) in sync. */
    const setEnumOptions = (id: string, rows: EntityFieldOption[],) => {
        patchOptions(id, { enumOptions: rows, values: rows.map((r,) => r.value), },);
    };
    const addEnumOption = (field: EntityFieldDef,) => {
        setEnumOptions(field.id, [...enumOptionsOf(field,), { label: '', value: '', },],);
    };
    const updateEnumOption = (field: EntityFieldDef, idx: number, changes: Partial<EntityFieldOption>,) => {
        setEnumOptions(field.id, enumOptionsOf(field,).map((r, i,) => (i === idx ? { ...r, ...changes, } : r)),);
    };
    const removeEnumOption = (field: EntityFieldDef, idx: number,) => {
        setEnumOptions(field.id, enumOptionsOf(field,).filter((_, i,) => i !== idx),);
    };

    const removeField = (id: string,) => {
        props.onChange(props.fields.filter((f,) => f.id !== id),);
    };

    const addField = () => {
        const field: EntityFieldDef = {
            id: newFieldId(),
            key: '',
            label: '',
            type: 'text',
            core: false,
            required: false,
            unique: false,
            indexed: false,
            searchable: false,
            filterable: false,
            position: props.fields.length,
        };
        props.onChange([...props.fields, field,],);
    };

    return (
        <div class="schema-field-list">
            <Index each={props.fields}>
                {(field,) => (
                    <div class={`schema-field ${field().core ? 'schema-field--core' : ''}`}>
                        <div class="schema-field__head">
                            <span class="schema-field__key">{field().key || '(unnamed)'}</span>
                            <span class="schema-field__type">· {field().type}</span>
                            <span class="schema-field__spacer" />
                            <div class="schema-field__flags">
                                <Show when={field().core}>
                                    <span class="badge badge--info">core</span>
                                </Show>
                                <Show when={field().required}>
                                    <span class="schema-flag-badge">required</span>
                                </Show>
                                <Show when={field().unique}>
                                    <span class="schema-flag-badge">unique</span>
                                </Show>
                                <Show when={field().indexed}>
                                    <span class="schema-flag-badge">indexed</span>
                                </Show>
                                <Show when={field().searchable}>
                                    <span class="schema-flag-badge">search</span>
                                </Show>
                                <Show when={field().filterable}>
                                    <span class="schema-flag-badge">filter</span>
                                </Show>
                                <Show when={!field().core && !props.disabled}>
                                    <button
                                        type="button"
                                        class="ui-button ui-button--sm ui-button--danger"
                                        onClick={() => removeField(field().id,)}
                                        aria-label={`Remove ${field().key}`}
                                    >
                                        Remove
                                    </button>
                                </Show>
                            </div>
                        </div>

                        <Show when={!field().core && !props.disabled}>
                            <div class="schema-field__body">
                                <FormField label="Key">
                                    <input
                                        type="text"
                                        value={field().key}
                                        placeholder="snake_case_key"
                                        onChange={(e,) => patch(field().id, { key: e.currentTarget.value, },)}
                                    />
                                </FormField>
                                <FormField label="Label">
                                    <input
                                        type="text"
                                        value={field().label}
                                        onChange={(e,) => patch(field().id, { label: e.currentTarget.value, },)}
                                    />
                                </FormField>
                                <FormField label="Type">
                                    <select
                                        value={field().type}
                                        onChange={(e,) =>
                                            patch(field().id, { type: e.currentTarget.value as EntityFieldType, },)}
                                    >
                                        <Index each={ENTITY_FIELD_TYPES}>
                                            {(t,) => <option value={t()}>{t()}</option>}
                                        </Index>
                                    </select>
                                </FormField>

                                <Show when={field().type === 'enum'}>
                                    <div class="schema-enum-editor">
                                        <FormField
                                            label="Enum values"
                                            hint="Label is shown in UIs / filter options; value is stored in the database."
                                        >
                                            <div class="schema-enum-rows">
                                                <Index each={enumOptionsOf(field(),)}>
                                                    {(opt, i,) => (
                                                        <div class="schema-enum-row">
                                                            <input
                                                                type="text"
                                                                class="schema-enum-row__label"
                                                                placeholder="Label"
                                                                value={opt().label}
                                                                onChange={(e,) =>
                                                                    updateEnumOption(field(), i, {
                                                                        label: e.currentTarget.value,
                                                                    },)}
                                                            />
                                                            <input
                                                                type="text"
                                                                class="schema-enum-row__value"
                                                                placeholder="value"
                                                                value={opt().value}
                                                                onChange={(e,) =>
                                                                    updateEnumOption(field(), i, {
                                                                        value: e.currentTarget.value,
                                                                    },)}
                                                            />
                                                            <button
                                                                type="button"
                                                                class="btn btn--small btn--danger-ghost"
                                                                aria-label="Remove value"
                                                                onClick={() => removeEnumOption(field(), i,)}
                                                            >
                                                                ✕
                                                            </button>
                                                        </div>
                                                    )}
                                                </Index>
                                                <button
                                                    type="button"
                                                    class="ui-button ui-button--sm ui-button--secondary"
                                                    onClick={() => addEnumOption(field(),)}
                                                >
                                                    + Add value
                                                </button>
                                            </div>
                                        </FormField>
                                    </div>
                                </Show>

                                <Show when={field().type === 'relation'}>
                                    <FormField label="Relation target" hint="Target entity type key">
                                        <input
                                            type="text"
                                            value={field().options?.relationType ?? ''}
                                            placeholder="e.g. author"
                                            onChange={(e,) =>
                                                patchOptions(field().id, { relationType: e.currentTarget.value, },)}
                                        />
                                    </FormField>
                                </Show>

                                <Show when={field().type === 'number' || field().type === 'integer'}>
                                    <FormField label="Min">
                                        <input
                                            type="number"
                                            value={field().options?.min ?? ''}
                                            onChange={(e,) =>
                                                patchOptions(field().id, {
                                                    min: e.currentTarget.value === '' ?
                                                        undefined :
                                                        Number(e.currentTarget.value,),
                                                },)}
                                        />
                                    </FormField>
                                    <FormField label="Max">
                                        <input
                                            type="number"
                                            value={field().options?.max ?? ''}
                                            onChange={(e,) =>
                                                patchOptions(field().id, {
                                                    max: e.currentTarget.value === '' ?
                                                        undefined :
                                                        Number(e.currentTarget.value,),
                                                },)}
                                        />
                                    </FormField>
                                </Show>

                                <Show when={field().type !== 'blocks' && field().type !== 'json'}>
                                    <FormField label="Default value">
                                        <input
                                            type="text"
                                            value={field().defaultValue == null ? '' : String(field().defaultValue,)}
                                            onChange={(e,) =>
                                                patch(field().id, {
                                                    defaultValue: e.currentTarget.value === '' ?
                                                        undefined :
                                                        e.currentTarget.value,
                                                },)}
                                        />
                                    </FormField>
                                </Show>
                            </div>

                            <div class="schema-field__checks">
                                <FormCheck
                                    label="Required"
                                    checked={field().required}
                                    onChange={(v,) => patch(field().id, { required: v, },)}
                                    plain
                                />
                                <FormCheck
                                    label="Unique"
                                    checked={field().unique}
                                    onChange={(v,) => patch(field().id, { unique: v, },)}
                                    plain
                                />
                                <FormCheck
                                    label="Indexed"
                                    checked={field().indexed}
                                    onChange={(v,) => patch(field().id, { indexed: v, },)}
                                    plain
                                />
                                <FormCheck
                                    label="Searchable"
                                    checked={field().searchable}
                                    onChange={(v,) => patch(field().id, { searchable: v, },)}
                                    plain
                                />
                                <FormCheck
                                    label="Filterable"
                                    checked={field().filterable}
                                    onChange={(v,) => patch(field().id, { filterable: v, },)}
                                    plain
                                />
                            </div>
                        </Show>
                    </div>
                )}
            </Index>

            <Show when={!props.disabled}>
                <div>
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={addField}>
                        + Add field
                    </button>
                </div>
            </Show>
        </div>
    );
};

export default SchemaFieldEditor;
