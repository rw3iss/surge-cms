/**
 * Admin edit panel for the `entity` block: pick an entity type → a content-block
 * template for it → a data binding (current-page entity / a specific entity /
 * specific records or a live query, via the shared "Set data…" control).
 */
import type { EntityBinding, SlotBinding, TemplateSlot, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createEffect, createResource, For, Show, Suspense, } from 'solid-js';
import { cms, } from '../../../../services/cmsClient';
import EntityBindingSummary from '../../entities/EntityBindingSummary';
import DataBindingField from '../../entities/DataBindingField';
import SlotBindingsField, { bindingSummaryProps, } from '../../entities/SlotBindingsField';
import { FormField, } from '../../forms';
import { CommitInput, } from '../../forms/CommitInput';

interface EntityCfg {
    templateId: string;
    entityType: string;
    binding: EntityBinding;
    layout?: 'stack' | 'carousel';
    carouselPerPage?: number;
    carouselGap?: string;
    slots?: Record<string, SlotBinding>;
}

/** Binding summary input for one binding (selected refs or the live query). */
const EntityBlockEdit: Component<{
    data: Record<string, any>;
    mode: 'edit';
    onUpdate: (d: Record<string, any>,) => void;
}> = (props,) => {
    const cfg = (): EntityCfg =>
        (props.data.entity ?? { templateId: '', entityType: '', binding: { mode: 'context' }, }) as EntityCfg;
    const setCfg = (patch: Partial<EntityCfg>,) => props.onUpdate({ ...props.data, entity: { ...cfg(), ...patch, }, },);
    const setBinding = (binding: EntityBinding,) => setCfg({ binding, },);

    // A new TYPE invalidates everything bound to the old one: the binding holds
    // the old type's record ids, and the slots are keyed by the old template's
    // slot ids — keeping them ticked foreign ids in "Set data…" and saved
    // orphan bindings into the page.
    const changeType = (entityType: string,) =>
        setCfg({ entityType, templateId: '', binding: { mode: 'context', }, slots: {}, },);
    // A new TEMPLATE keeps only the slot bindings its own slots declare.
    const changeTemplate = (templateId: string,) => {
        const next = (templates() ?? []).find((t,) => t.id === templateId);
        const keep = new Set((next?.slots ?? []).map((sl,) => sl.id),);
        const slots = Object.fromEntries(Object.entries(cfg().slots ?? {},).filter(([id,],) => keep.has(id,)),);
        setCfg({ templateId, slots, },);
    };

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
    /** True when more than one record can render (a list template, or a list/query binding). */
    const rendersMany = () => template()?.mode === 'list' || cfg().binding.mode === 'list' || cfg().binding.mode === 'query';

    // ─── Template slots ──────────────────────────────────────────────
    // The chosen template's declared data inputs; this block fills each one.
    const templateSlots = (): TemplateSlot[] => template()?.slots ?? [];

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
            <FormField label="Entity type">
                <select
                    ref={typeSelect}
                    value={cfg().entityType}
                    onChange={(e,) => changeType(e.currentTarget.value,)}
                >
                    <option value="">— select —</option>
                    <For each={types() ?? []}>{(t,) => <option value={t.key}>{t.label}</option>}</For>
                </select>
            </FormField>

            <Show when={cfg().entityType}>
                <FormField
                    label="Template"
                    hint={(templates() ?? []).length === 0 ? `No templates yet — create one in Entities → ${cfg().entityType} → Templates.` : undefined}
                >
                    <select ref={templateSelect} value={cfg().templateId} onChange={(e,) => changeTemplate(e.currentTarget.value,)}>
                        <option value="">— select —</option>
                        <For each={templates() ?? []}>
                            {(t,) => <option value={t.id}>{t.name} ({t.mode})</option>}
                        </For>
                    </select>
                </FormField>
                {/* Outside the <label> so a click follows the link rather than
                    focusing the select. New tab, like the Component block's
                    "Edit Component", so the page being edited stays open. */}
                <Show when={cfg().templateId}>
                    <A
                        href={`/admin/entities/${encodeURIComponent(cfg().entityType,)}/templates/${cfg().templateId}`}
                        class="entity-block-edit__template-link"
                        target="_blank"
                    >
                        Edit template
                    </A>
                </Show>
            </Show>

            <Show when={cfg().templateId}>
                <FormField label="Data source">
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
                </FormField>

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
                            refs={bindingSummaryProps(cfg().binding,).refs}
                            query={bindingSummaryProps(cfg().binding,).query}
                        />
                    </DataBindingField>
                </Show>

                {/* Layout only matters when more than one record can render. */}
                <Show when={rendersMany()}>
                    <FormField label="Layout (multiple records)">
                        <select
                            value={cfg().layout ?? 'stack'}
                            onChange={(e,) => setCfg({ layout: e.currentTarget.value as 'stack' | 'carousel', },)}
                        >
                            <option value="stack">Stack (vertical)</option>
                            <option value="carousel">Carousel (arrows, dots, swipe)</option>
                        </select>
                    </FormField>
                    <Show when={cfg().layout === 'carousel'}>
                        <div class="admin-form-row">
                            <FormField label="Visible at once">
                                <CommitInput
                                    type="number"
                                    min={1}
                                    max={8}
                                    value={cfg().carouselPerPage ?? 3}
                                    onCommit={(v,) => setCfg({ carouselPerPage: Math.min(8, Math.max(1, Number(v,) || 3,),), },)}
                                />
                            </FormField>
                            <FormField label="Gap" hint="Any CSS length">
                                <CommitInput value={cfg().carouselGap ?? ''} placeholder="16px" onCommit={(v,) => setCfg({ carouselGap: v || undefined, },)} />
                            </FormField>
                        </div>
                    </Show>
                </Show>

                <SlotBindingsField slots={templateSlots()} value={cfg().slots} onChange={(slots,) => setCfg({ slots, },)} />
            </Show>

        </div>
        </Suspense>
    );
};

export default EntityBlockEdit;
