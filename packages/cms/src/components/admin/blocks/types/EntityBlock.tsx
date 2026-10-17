/**
 * Admin edit panel for the `entity` block: pick an entity type → a content-block
 * template for it → a data binding (current-page entity / a specific entity /
 * specific records or a live query, via the shared "Set data…" control).
 */
import type { EntityBinding, EntityQuery, SlotBinding, TemplateSlot, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createEffect, createResource, For, Show, Suspense, } from 'solid-js';
import { cms, } from '../../../../services/cmsClient';
import EntityBindingSummary from '../../entities/EntityBindingSummary';
import DataBindingField from '../../entities/DataBindingField';
import { slotDisplayName, slotTypeLabel, } from '../../../../utils/templateSlots';

interface EntityCfg {
    templateId: string;
    entityType: string;
    binding: EntityBinding;
    layout?: 'stack' | 'carousel';
    slots?: Record<string, SlotBinding>;
}

const EntityBlockEdit: Component<{
    data: Record<string, any>;
    mode: 'edit';
    onUpdate: (d: Record<string, any>,) => void;
}> = (props,) => {
    const cfg = (): EntityCfg =>
        (props.data.entity ?? { templateId: '', entityType: '', binding: { mode: 'context' }, }) as EntityCfg;
    const setCfg = (patch: Partial<EntityCfg>,) => props.onUpdate({ ...props.data, entity: { ...cfg(), ...patch, }, },);
    const setBinding = (binding: EntityBinding,) => setCfg({ binding, },);

    const [types] = createResource(async () => {
        try {
            return await cms.entityTypes.list();
        } catch {
            return [];
        }
    },);
    const [templates] = createResource(
        () => cfg().entityType,
        async (type,) => {
            if (!type) return [];
            try {
                return await cms.contentBlockTemplates.list(type,);
            } catch {
                return [];
            }
        },
    );

    /** The template being rendered (its mode + record cap shape the picker). */
    const template = () => (templates() ?? []).find((t,) => t.id === cfg().templateId);
    /** The binding as "Set data…" sees it: specific records or a live query. */
    const dataBinding = (): SlotBinding | null => {
        const b = cfg().binding;
        return b.mode === 'single' || b.mode === 'list' || b.mode === 'query' ? b : null;
    };
    const isData = () => dataBinding() !== null;

    // ─── Template slots ──────────────────────────────────────────────
    // The chosen template's declared data inputs; this block fills each one.
    const templateSlots = (): TemplateSlot[] => template()?.slots ?? [];
    const setSlotBinding = (id: string, b: SlotBinding | undefined,) => {
        const next = { ...(cfg().slots ?? {}), };
        if (b) next[id] = b;
        else delete next[id];
        setCfg({ slots: next, },);
    };

    // Re-apply the selected value AFTER the async option lists load. A native
    // <select value={x}> whose matching <option> doesn't exist yet (resource
    // still loading) falls back to the first option ("— select —") and isn't
    // re-synced when the options arrive; these effects re-set it once they do.
    let typeSelect: HTMLSelectElement | undefined;
    let templateSelect: HTMLSelectElement | undefined;
    createEffect(() => {
        types();
        const v = cfg().entityType;
        if (typeSelect) typeSelect.value = v;
    },);
    createEffect(() => {
        templates();
        const v = cfg().templateId;
        if (templateSelect) templateSelect.value = v;
    },);

    // Local Suspense boundary: changing the entity type re-fetches `templates`
    // (a new resource key with no cached value → suspends). Without this, that
    // suspension bubbles to the page-level Suspense, whose fallback empties the
    // whole editor for a few frames — collapsing the page height and clamping
    // scroll to the top. Containing it here keeps the reflow local (the panel
    // just shows a tiny "Loading…"), so the page never collapses.
    return (
        <Suspense fallback={<div class="block-edit-form entity-block-edit"><small class="form-help-muted">Loading…</small></div>}>
        <div class="block-edit-form entity-block-edit">
            <label class="block-edit-form__field">
                <span>Entity type</span>
                <select
                    ref={typeSelect}
                    value={cfg().entityType}
                    onChange={(e,) => setCfg({ entityType: e.currentTarget.value, templateId: '', },)}
                >
                    <option value="">— select —</option>
                    <For each={types() ?? []}>{(t,) => <option value={t.key}>{t.label}</option>}</For>
                </select>
            </label>

            <Show when={cfg().entityType}>
                <label class="block-edit-form__field">
                    <span>Template</span>
                    <select ref={templateSelect} value={cfg().templateId} onChange={(e,) => setCfg({ templateId: e.currentTarget.value, },)}>
                        <option value="">— select —</option>
                        <For each={templates() ?? []}>
                            {(t,) => <option value={t.id}>{t.name} ({t.mode})</option>}
                        </For>
                    </select>
                    <Show when={(templates() ?? []).length === 0}>
                        <small class="form-help-muted">No templates yet — create one in Entities → {cfg().entityType} → Templates.</small>
                    </Show>
                </label>
                {/* Outside the <label> so a click follows the link rather than
                    focusing the select. New tab, like the Component block's
                    "Edit Component", so the page being edited stays open. */}
                <Show when={cfg().templateId}>
                    <A
                        href={`/admin/entities/${encodeURIComponent(cfg().entityType,)}/templates/${cfg().templateId}`}
                        class="ui-button ui-button--sm ui-button--secondary entity-block-edit__template-link"
                        target="_blank"
                    >
                        Edit template
                    </A>
                </Show>
            </Show>

            <Show when={cfg().templateId}>
                <label class="block-edit-form__field">
                    <span>Data source</span>
                    <select
                        value={isData() ? 'data' : cfg().binding.mode}
                        onChange={(e,) => {
                            const mode = e.currentTarget.value;
                            if (mode === 'none') setBinding({ mode: 'none', },);
                            else if (mode === 'data') {
                                if (!isData()) setBinding({ mode: 'list', refs: [], },);
                            } else setBinding({ mode: 'context', },);
                        }}
                    >
                        <option value="none">None — just render the template</option>
                        <option value="context">Current page entity</option>
                        <option value="data">Specific records or a live query</option>
                    </select>
                </label>

                {/* Set data… covers both: tick records for a fixed selection, or
                    tick none to save the filters/sort/limit as a live query. */}
                <Show when={isData()}>
                    <DataBindingField
                        entityType={cfg().entityType}
                        value={dataBinding()}
                        maxRecords={template()?.mode === 'list' ? template()?.maxRecords ?? undefined : undefined}
                        clearLabel={false}
                        onChange={(b,) => setBinding(b ?? { mode: 'list', refs: [], },)}
                    >
                        {/* What the binding actually resolves to — which records,
                            and what a saved query matches right now. */}
                        <EntityBindingSummary
                            entityType={cfg().entityType ?? ''}
                            refs={
                                cfg().binding.mode === 'single'
                                    ? ((cfg().binding as { ref?: string; }).ref ? [(cfg().binding as { ref: string; }).ref,] : undefined)
                                    : cfg().binding.mode === 'list'
                                    ? (cfg().binding as { refs?: string[]; }).refs
                                    : undefined
                            }
                            query={cfg().binding.mode === 'query' ? (cfg().binding as { query?: EntityQuery; }).query : undefined}
                        />
                    </DataBindingField>
                </Show>

                <label class="block-edit-form__field">
                    <span>Layout (multiple records)</span>
                    <select
                        value={cfg().layout ?? 'stack'}
                        onChange={(e,) => setCfg({ layout: e.currentTarget.value as 'stack' | 'carousel', },)}
                    >
                        <option value="stack">Stack (vertical)</option>
                        <option value="carousel">Carousel (swipeable)</option>
                    </select>
                </label>

                <Show when={templateSlots().length > 0}>
                    <div class="block-edit-form__field entity-block-edit__slots">
                        <span>Slots</span>
                        <For each={templateSlots()}>
                            {(slot,) => {
                                const binding = () => cfg().slots?.[slot.id];
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
                                            onChange={(b,) => setSlotBinding(slot.id, b ?? undefined,)}
                                        />
                                    </div>
                                );
                            }}
                        </For>
                    </div>
                </Show>
            </Show>

        </div>
        </Suspense>
    );
};

export default EntityBlockEdit;
