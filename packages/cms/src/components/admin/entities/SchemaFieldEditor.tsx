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
 */
import type { EntityFieldDef, EntityFieldType, } from '@sitesurge/types';
import { Component, For, Show, } from 'solid-js';
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
            position: props.fields.length,
        };
        props.onChange([...props.fields, field,],);
    };

    return (
        <div class="schema-field-list">
            <For each={props.fields}>
                {(field,) => (
                    <div class={`schema-field ${field.core ? 'schema-field--core' : ''}`}>
                        <div class="schema-field__head">
                            <span class="schema-field__key">{field.key || '(unnamed)'}</span>
                            <span class="schema-field__type">· {field.type}</span>
                            <span class="schema-field__spacer" />
                            <div class="schema-field__flags">
                                <Show when={field.core}>
                                    <span class="badge badge--info">core</span>
                                </Show>
                                <Show when={field.required}>
                                    <span class="schema-flag-badge">required</span>
                                </Show>
                                <Show when={field.unique}>
                                    <span class="schema-flag-badge">unique</span>
                                </Show>
                                <Show when={field.indexed}>
                                    <span class="schema-flag-badge">indexed</span>
                                </Show>
                                <Show when={field.searchable}>
                                    <span class="schema-flag-badge">search</span>
                                </Show>
                                <Show when={!field.core && !props.disabled}>
                                    <button
                                        type="button"
                                        class="btn btn--small btn--danger"
                                        onClick={() => removeField(field.id,)}
                                        aria-label={`Remove ${field.key}`}
                                    >
                                        Remove
                                    </button>
                                </Show>
                            </div>
                        </div>

                        <Show when={!field.core && !props.disabled}>
                            <div class="schema-field__body">
                                <FormField label="Key">
                                    <input
                                        type="text"
                                        value={field.key}
                                        placeholder="snake_case_key"
                                        onInput={(e,) => patch(field.id, { key: e.currentTarget.value, },)}
                                    />
                                </FormField>
                                <FormField label="Label">
                                    <input
                                        type="text"
                                        value={field.label}
                                        onInput={(e,) => patch(field.id, { label: e.currentTarget.value, },)}
                                    />
                                </FormField>
                                <FormField label="Type">
                                    <select
                                        value={field.type}
                                        onChange={(e,) =>
                                            patch(field.id, { type: e.currentTarget.value as EntityFieldType, },)}
                                    >
                                        <For each={ENTITY_FIELD_TYPES}>
                                            {(t,) => <option value={t}>{t}</option>}
                                        </For>
                                    </select>
                                </FormField>

                                <Show when={field.type === 'enum'}>
                                    <FormField label="Enum values" hint="Comma-separated">
                                        <input
                                            type="text"
                                            value={(field.options?.values ?? []).join(', ',)}
                                            placeholder="draft, active, done"
                                            onInput={(e,) =>
                                                patchOptions(field.id, {
                                                    values: e.currentTarget.value
                                                        .split(',',)
                                                        .map((v,) => v.trim())
                                                        .filter(Boolean,),
                                                },)}
                                        />
                                    </FormField>
                                </Show>

                                <Show when={field.type === 'relation'}>
                                    <FormField label="Relation target" hint="Target entity type key">
                                        <input
                                            type="text"
                                            value={field.options?.relationType ?? ''}
                                            placeholder="e.g. author"
                                            onInput={(e,) =>
                                                patchOptions(field.id, { relationType: e.currentTarget.value, },)}
                                        />
                                    </FormField>
                                </Show>

                                <Show when={field.type === 'number' || field.type === 'integer'}>
                                    <FormField label="Min">
                                        <input
                                            type="number"
                                            value={field.options?.min ?? ''}
                                            onInput={(e,) =>
                                                patchOptions(field.id, {
                                                    min: e.currentTarget.value === '' ?
                                                        undefined :
                                                        Number(e.currentTarget.value,),
                                                },)}
                                        />
                                    </FormField>
                                    <FormField label="Max">
                                        <input
                                            type="number"
                                            value={field.options?.max ?? ''}
                                            onInput={(e,) =>
                                                patchOptions(field.id, {
                                                    max: e.currentTarget.value === '' ?
                                                        undefined :
                                                        Number(e.currentTarget.value,),
                                                },)}
                                        />
                                    </FormField>
                                </Show>

                                <Show when={field.type !== 'blocks' && field.type !== 'json'}>
                                    <FormField label="Default value">
                                        <input
                                            type="text"
                                            value={field.defaultValue == null ? '' : String(field.defaultValue,)}
                                            onInput={(e,) =>
                                                patch(field.id, {
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
                                    checked={field.required}
                                    onChange={(v,) => patch(field.id, { required: v, },)}
                                    plain
                                />
                                <FormCheck
                                    label="Unique"
                                    checked={field.unique}
                                    onChange={(v,) => patch(field.id, { unique: v, },)}
                                    plain
                                />
                                <FormCheck
                                    label="Indexed"
                                    checked={field.indexed}
                                    onChange={(v,) => patch(field.id, { indexed: v, },)}
                                    plain
                                />
                                <FormCheck
                                    label="Searchable"
                                    checked={field.searchable}
                                    onChange={(v,) => patch(field.id, { searchable: v, },)}
                                    plain
                                />
                            </div>
                        </Show>
                    </div>
                )}
            </For>

            <Show when={!props.disabled}>
                <div>
                    <button type="button" class="btn btn--secondary btn--small" onClick={addField}>
                        + Add field
                    </button>
                </div>
            </Show>
        </div>
    );
};

export default SchemaFieldEditor;
