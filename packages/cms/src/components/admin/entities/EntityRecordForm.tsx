/**
 * EntityRecordForm — a schema-driven form rendering one control per field of
 * an entity type. Controlled: the parent owns the `values` map and receives
 * an updated copy on every edit. `disabled` renders a read-only view.
 *
 * Media fields open the shared MediaSelectModal; relation fields open the
 * EntitySearchSelectModal (single) scoped to the field's target type.
 */
import type { EntityFieldDef, EntityRecord, EntityTypeDef, } from '@sitesurge/types';
import { Component, createSignal, For, Show, } from 'solid-js';
import FormCheck from '../forms/FormCheck';
import FormField from '../forms/FormField';
import MediaSelectModal from '../media/MediaSelectModal';
import EntitySearchSelectModal from './EntitySearchSelectModal';
import '../../../pages/admin/entities/EntitiesList.scss';

export interface EntityRecordFormProps {
    type: EntityTypeDef;
    values: Record<string, unknown>;
    onChange: (values: Record<string, unknown>,) => void;
    disabled?: boolean;
}

type OpenPicker = { key: string; kind: 'media' | 'relation'; relationType?: string; };

/** Field types that get a full-width control (textareas). */
const WIDE_TYPES = new Set(['longtext', 'markdown', 'richtext', 'json',],);

function toDateInput(value: unknown, withTime: boolean,): string {
    if (!value) return '';
    const s = String(value,);
    // Trim an ISO string to what <input type=date|datetime-local> expects.
    return withTime ? s.slice(0, 16,) : s.slice(0, 10,);
}

const EntityRecordForm: Component<EntityRecordFormProps> = (props,) => {
    const [picker, setPicker,] = createSignal<OpenPicker | null>(null,);
    const [jsonText, setJsonText,] = createSignal<Record<string, string>>({},);
    const [jsonError, setJsonError,] = createSignal<Record<string, boolean>>({},);

    const setField = (key: string, value: unknown,) => {
        props.onChange({ ...props.values, [key]: value, },);
    };

    const val = (key: string,) => props.values[key];

    const onJson = (key: string, text: string,) => {
        setJsonText({ ...jsonText(), [key]: text, },);
        if (text.trim() === '') {
            setJsonError({ ...jsonError(), [key]: false, },);
            setField(key, undefined,);
            return;
        }
        try {
            const parsed = JSON.parse(text,);
            setJsonError({ ...jsonError(), [key]: false, },);
            setField(key, parsed,);
        } catch {
            setJsonError({ ...jsonError(), [key]: true, },);
        }
    };

    const jsonValue = (key: string,) => {
        if (key in jsonText()) return jsonText()[key];
        const v = val(key,);
        return v == null ? '' : JSON.stringify(v, null, 2,);
    };

    const control = (field: EntityFieldDef,) => {
        const key = field.key;
        const disabled = props.disabled;
        switch (field.type) {
            case 'boolean':
                return (
                    <FormCheck
                        label={field.label || key}
                        checked={Boolean(val(key,),)}
                        onChange={(v,) => !disabled && setField(key, v,)}
                    />
                );
            case 'longtext':
            case 'markdown':
            case 'richtext':
                return (
                    <textarea
                        value={String(val(key,) ?? '',)}
                        disabled={disabled}
                        onInput={(e,) => setField(key, e.currentTarget.value,)}
                    />
                );
            case 'json':
                return (
                    <>
                        <textarea
                            value={jsonValue(key,)}
                            disabled={disabled}
                            placeholder="{ }"
                            onInput={(e,) => onJson(key, e.currentTarget.value,)}
                        />
                        <Show when={jsonError()[key]}>
                            <span class="form-help-muted" style={{ color: 'var(--color-error, #c0392b)', }}>
                                Invalid JSON — not saved
                            </span>
                        </Show>
                    </>
                );
            case 'number':
            case 'integer':
                return (
                    <input
                        type="number"
                        step={field.type === 'integer' ? '1' : 'any'}
                        value={val(key,) == null ? '' : String(val(key,),)}
                        disabled={disabled}
                        onInput={(e,) =>
                            setField(key, e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value,),)}
                    />
                );
            case 'date':
                return (
                    <input
                        type="date"
                        value={toDateInput(val(key,), false,)}
                        disabled={disabled}
                        onInput={(e,) => setField(key, e.currentTarget.value || undefined,)}
                    />
                );
            case 'datetime':
                return (
                    <input
                        type="datetime-local"
                        value={toDateInput(val(key,), true,)}
                        disabled={disabled}
                        onInput={(e,) => setField(key, e.currentTarget.value || undefined,)}
                    />
                );
            case 'enum':
                return (
                    <select
                        value={String(val(key,) ?? '',)}
                        disabled={disabled}
                        onChange={(e,) => setField(key, e.currentTarget.value || undefined,)}
                    >
                        <option value="">—</option>
                        <For each={field.options?.values ?? []}>
                            {(v,) => <option value={v}>{v}</option>}
                        </For>
                    </select>
                );
            case 'media':
                return (
                    <div class="entity-record-form__ref-row">
                        <input
                            type="text"
                            placeholder="media id"
                            value={String(val(key,) ?? '',)}
                            disabled={disabled}
                            onInput={(e,) => setField(key, e.currentTarget.value || undefined,)}
                        />
                        <Show when={!disabled}>
                            <button
                                type="button"
                                class="btn btn--small btn--secondary"
                                onClick={() => setPicker({ key, kind: 'media', },)}
                            >
                                Select
                            </button>
                        </Show>
                    </div>
                );
            case 'relation':
                return (
                    <div class="entity-record-form__ref-row">
                        <input
                            type="text"
                            placeholder="id or slug"
                            value={String(val(key,) ?? '',)}
                            disabled={disabled}
                            onInput={(e,) => setField(key, e.currentTarget.value || undefined,)}
                        />
                        <Show when={!disabled && field.options?.relationType}>
                            <button
                                type="button"
                                class="btn btn--small btn--secondary"
                                onClick={() =>
                                    setPicker({ key, kind: 'relation', relationType: field.options!.relationType, },)}
                            >
                                Select
                            </button>
                        </Show>
                    </div>
                );
            case 'blocks':
                return <span class="form-help-muted">Block body — edit in the block editor.</span>;
            case 'text':
            case 'slug':
            default:
                return (
                    <input
                        type="text"
                        value={String(val(key,) ?? '',)}
                        disabled={disabled}
                        onInput={(e,) => setField(key, e.currentTarget.value || undefined,)}
                    />
                );
        }
    };

    return (
        <div class="entity-record-form">
            {/* Standard slug / status columns when the type declares them. */}
            <Show when={props.type.hasSlug}>
                <FormField label="Slug">
                    <input
                        type="text"
                        value={String(val('slug',) ?? '',)}
                        disabled={props.disabled}
                        onInput={(e,) => setField('slug', e.currentTarget.value || undefined,)}
                    />
                </FormField>
            </Show>
            <Show when={props.type.hasStatus}>
                <FormField label="Status">
                    <input
                        type="text"
                        value={String(val('status',) ?? '',)}
                        disabled={props.disabled}
                        onInput={(e,) => setField('status', e.currentTarget.value || undefined,)}
                    />
                </FormField>
            </Show>

            <For each={props.type.fields}>
                {(field,) => (
                    <FormField
                        label={`${field.label || field.key}${field.required ? ' *' : ''}`}
                        class={WIDE_TYPES.has(field.type,) ? 'entity-record-form__field--wide' : ''}
                    >
                        {control(field,)}
                    </FormField>
                )}
            </For>

            <Show when={picker()?.kind === 'media'}>
                <MediaSelectModal
                    onSelect={(media,) => {
                        setField(picker()!.key, media.id,);
                        setPicker(null,);
                    }}
                    onClose={() => setPicker(null,)}
                />
            </Show>
            <Show when={picker()?.kind === 'relation' && picker()?.relationType}>
                <EntitySearchSelectModal
                    entityType={picker()!.relationType!}
                    mode="single"
                    onSelect={(result,) => {
                        const rec = result as EntityRecord;
                        setField(picker()!.key, rec.id,);
                        setPicker(null,);
                    }}
                    onClose={() => setPicker(null,)}
                />
            </Show>
        </div>
    );
};

export default EntityRecordForm;
