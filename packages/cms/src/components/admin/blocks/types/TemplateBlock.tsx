/**
 * Edit panel for a `template` block: pick which Component to render.
 *
 * The block stores only `settings.templateId` — a REFERENCE. Nothing about the
 * component is copied here, so editing it under Components updates every block
 * using it. That is the whole point of the type; a copy would be a group block.
 */
import { Component, createEffect, createResource, For, on, Show, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import { A, } from '@solidjs/router';
import type { ContentBlockTemplate, SlotBinding, } from '@sitesurge/types';
import { cms, } from '../../../../services/cmsClient';
import FormField from '../../forms/FormField';
import { CommitInput, } from '../../forms/CommitInput';
import SlotBindingsField from '../../entities/SlotBindingsField';

type PropRow = { key: string; value: string; };
const toRows = (p: unknown,): PropRow[] =>
    Object.entries((p && typeof p === 'object' ? p : {}) as Record<string, unknown>,).map(([key, value,],) => ({ key, value: String(value ?? '',), }));
/** Rows → `settings.props` (blank keys dropped; keys trimmed). */
const toProps = (rows: PropRow[],): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const r of rows) if (r.key.trim()) out[r.key.trim()] = r.value;
    return out;
};

/** A prop is read as `{{ props.<key> }}`, so the key must be a plain identifier. */
const propKeyError = (v: string,): string | null =>
    !v.trim() || /^[A-Za-z_][\w-]*$/.test(v.trim(),) ? null : 'Letters, digits, - and _ only, starting with a letter — read as {{ props.name }}.';

export interface TemplateBlockEditProps {
    settings: Record<string, unknown>;
    onChange: (patch: Record<string, unknown>,) => void;
}

const TemplateBlockEdit: Component<TemplateBlockEditProps> = (props,) => {
    const [templates] = createResource(async () => {
        try {
            return await cms.components.list();
        } catch {
            return [] as ContentBlockTemplate[];
        }
    },);

    const selectedId = () => (props.settings.templateId as string | undefined) ?? '';
    const selected = () => (templates() ?? []).find((t,) => t.id === selectedId());

    // ── Props: key/value pairs the component reads as {{ props.<key> }} and
    // ctx.block.props. Rows live in a store (no remount on edit) and commit on blur.
    const [rows, setRows,] = createStore<PropRow[]>(toRows(props.settings.props,),);
    createEffect(on(() => JSON.stringify(props.settings.props ?? {},), () => {
        if (JSON.stringify(toProps(rows,),) !== JSON.stringify(props.settings.props ?? {},)) setRows(toRows(props.settings.props,),);
    }, { defer: true, },),);
    const commitRows = () => props.onChange({ props: toProps(rows,), },);

    /**
     * Switch component. Slot bindings for ids the new component does not
     * declare are dropped (they would sit in the block unseen and unused);
     * props stay — they are often shared between similar components.
     */
    const selectComponent = (id: string,) => {
        const next = (templates() ?? []).find((t,) => t.id === id);
        const ids = new Set((next?.slots ?? []).map((sl,) => sl.id),);
        const bound = (props.settings.slots ?? {}) as Record<string, SlotBinding>;
        const kept = Object.fromEntries(Object.entries(bound,).filter(([k,],) => ids.has(k,)),);
        props.onChange({ templateId: id, slots: kept, },);
    };
    // A component the block points at that no longer exists (deleted).
    const missing = () => Boolean(selectedId() && templates.state === 'ready' && !selected());

    return (
        <div class="block-edit-form__field template-block-edit">
            <FormField
                label="Component"
                hint="Rendered live from the component — editing it there updates every block using it."
            >
                <Show
                    when={(templates() ?? []).length > 0}
                    fallback={
                        <p class="form-help-muted">
                            No components yet. Create one under <A href="/admin/components">Components</A>.
                        </p>
                    }
                >
                    {/* Select + action on one row. The row wraps on a narrow
                        panel rather than shrinking the select to nothing —
                        the block edit panel is itself narrow on mobile. */}
                    <div class="template-block-edit__row">
                        <select
                            class="template-block-edit__select"
                            value={selectedId()}
                            onChange={(e,) => selectComponent(e.currentTarget.value,)}
                        >
                            <option value="">Select a component…</option>
                            {(templates() ?? []).map((t,) => <option value={t.id}>{t.name}</option>)}
                        </select>
                        <Show when={selected()}>
                            <A
                                href={`/admin/components/${selected()!.id}`}
                                class="template-block-edit__edit"
                                target="_blank"
                            >
                                Edit component ↗
                            </A>
                        </Show>
                    </div>
                </Show>
            </FormField>

            <Show when={missing()}>
                <p class="form-help-muted template-block-edit__missing" role="status">
                    The component this block used no longer exists, so it renders nothing. Choose another component.
                </p>
            </Show>

            <Show when={selected()?.description}>
                <p class="form-help-muted">{selected()!.description}</p>
            </Show>

            {/* The component's data inputs: Set data… per slot (records or a live query). */}
            <SlotBindingsField
                slots={selected()?.slots ?? []}
                value={props.settings.slots as Record<string, SlotBinding> | undefined}
                onChange={(slots,) => props.onChange({ slots, },)}
            />

            <Show when={selected()}>
                <FormField
                    label="Props"
                    tooltip="Options for this use of the component, read inside it as {{ props.name }} (and ctx.block.props in its JavaScript) — e.g. layout = column."
                >
                    <div class="template-block-edit__props">
                        <For each={rows}>
                            {(row, i,) => (
                                <div class="template-block-edit__prop">
                                    <CommitInput
                                        value={row.key}
                                        placeholder="name"
                                        aria-label="Prop name"
                                        validate={propKeyError}
                                        onCommit={(v,) => { setRows(i(), 'key', v,); commitRows(); }}
                                    />
                                    <CommitInput
                                        value={row.value}
                                        placeholder="value"
                                        aria-label="Prop value"
                                        onCommit={(v,) => { setRows(i(), 'value', v,); commitRows(); }}
                                    />
                                    <button
                                        type="button"
                                        class="template-block-edit__prop-remove"
                                        aria-label={`Remove prop ${row.key}`}
                                        onClick={() => { setRows((r,) => r.filter((_, j,) => j !== i()),); commitRows(); }}
                                    >
                                        ×
                                    </button>
                                </div>
                            )}
                        </For>
                        <button
                            type="button"
                            class="ui-button ui-button--sm ui-button--ghost template-block-edit__prop-add"
                            onClick={() => setRows(rows.length, { key: '', value: '', },)}
                        >
                            + Add prop
                        </button>
                    </div>
                </FormField>
            </Show>
        </div>
    );
};

export default TemplateBlockEdit;
