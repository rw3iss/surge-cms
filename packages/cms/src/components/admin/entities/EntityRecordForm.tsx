/**
 * EntityRecordForm — a schema-driven form rendering one control per field of
 * an entity type. Controlled: the parent owns the `values` map and receives
 * an updated copy when a field COMMITS — on blur / Enter for text, number,
 * date and textarea fields (the admin rule: never per keystroke). `disabled` renders a read-only view.
 *
 * Media fields open the shared MediaSelectModal; relation fields open the
 * EntitySearchSelectModal (single) scoped to the field's target type.
 */
import { openMediaViewer, } from '@/stores/mediaViewer';
import type { EntityFieldDef, EntityRecord, EntityTypeDef, } from '@sitesurge/types';
import { Component, createSignal, For, Show, } from 'solid-js';
import Toggle from '../common/Toggle';
import { CommitInput, } from '../forms/CommitInput';
import FormField from '../forms/FormField';
import MediaSelectModal from '../media/MediaSelectModal';
import EntitySearchSelectModal from './EntitySearchSelectModal';
import './EntityRecordForm.scss';

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
                    <Toggle
                        label={field.label || key}
                        checked={Boolean(val(key,),)}
                        disabled={disabled}
                        onChange={(v,) => !disabled && setField(key, v,)}
                    />
                );
            case 'longtext':
            case 'markdown':
            case 'richtext':
                return (
                    <CommitInput
                        multiline
                        trim={false}
                        value={String(val(key,) ?? '',)}
                        disabled={disabled}
                        onCommit={(v,) => setField(key, v,)}
                    />
                );
            case 'json':
                return (
                    <>
                        {/* Parsed on blur (keeps the text while it is invalid). */}
                        <CommitInput
                            multiline
                            trim={false}
                            value={jsonValue(key,)}
                            disabled={disabled}
                            placeholder="{ }"
                            onCommit={(v,) => onJson(key, v,)}
                        />
                        <Show when={jsonError()[key]}>
                            <span class="form-help-muted form-help--error">
                                Invalid JSON — not saved
                            </span>
                        </Show>
                    </>
                );
            case 'number':
            case 'integer':
                return (
                    <CommitInput
                        type="number"
                        step={field.type === 'integer' ? '1' : 'any'}
                        value={val(key,) == null ? '' : String(val(key,),)}
                        disabled={disabled}
                        onCommit={(v,) => setField(key, v === '' ? undefined : Number(v,),)}
                    />
                );
            case 'date':
                return (
                    <CommitInput
                        type="date"
                        value={toDateInput(val(key,), false,)}
                        disabled={disabled}
                        onCommit={(v,) => setField(key, v || undefined,)}
                    />
                );
            case 'datetime':
                return (
                    <CommitInput
                        type="datetime-local"
                        value={toDateInput(val(key,), true,)}
                        disabled={disabled}
                        onCommit={(v,) => setField(key, v || undefined,)}
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
                        <CommitInput
                            placeholder="media id"
                            value={String(val(key,) ?? '',)}
                            disabled={disabled}
                            onCommit={(v,) => setField(key, v || undefined,)}
                        />
                        <Show when={!disabled}>
                            <button
                                type="button"
                                class="ui-button ui-button--sm ui-button--secondary"
                                onClick={() => setPicker({ key, kind: 'media', },)}
                            >
                                Select
                            </button>
                        </Show>
                        <Show when={val(key,)}>
                            <button
                                type="button"
                                class="ui-button ui-button--sm ui-button--secondary"
                                onClick={() => openMediaViewer({ id: String(val(key,),), },)}
                            >
                                View
                            </button>
                        </Show>
                    </div>
                );
            case 'relation':
                return (
                    <div class="entity-record-form__ref-row">
                        <CommitInput
                            placeholder="id or slug"
                            value={String(val(key,) ?? '',)}
                            disabled={disabled}
                            onCommit={(v,) => setField(key, v || undefined,)}
                        />
                        <Show when={!disabled && field.options?.relationType}>
                            <button
                                type="button"
                                class="ui-button ui-button--sm ui-button--secondary"
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
                    <CommitInput
                        value={String(val(key,) ?? '',)}
                        disabled={disabled}
                        onCommit={(v,) => setField(key, v || undefined,)}
                    />
                );
        }
    };

    return (
        <div class="entity-record-form">
            {/* Standard slug / status columns when the type declares them. */}
            <Show when={props.type.hasSlug}>
                <FormField label="Slug">
                    <CommitInput
                        value={String(val('slug',) ?? '',)}
                        disabled={props.disabled}
                        onCommit={(v,) => setField('slug', v || undefined,)}
                    />
                </FormField>
            </Show>
            <Show when={props.type.hasStatus}>
                <FormField label="Status">
                    <CommitInput
                        value={String(val('status',) ?? '',)}
                        disabled={props.disabled}
                        onCommit={(v,) => setField('status', v || undefined,)}
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
