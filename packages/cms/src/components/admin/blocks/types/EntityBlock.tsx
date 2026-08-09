/**
 * Admin edit panel for the `entity` block: pick an entity type → a content-block
 * template for it → a data binding (current-page entity / a specific entity /
 * several entities / a query). Reuses the shared EntitySearchSelectModal.
 */
import type { EntityBinding, EntityQuery, EntityRecord, } from '@sitesurge/types';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../../../services/cmsClient';
import EntitySearchSelectModal from '../../entities/EntitySearchSelectModal';

interface EntityCfg {
    templateId: string;
    entityType: string;
    binding: EntityBinding;
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

    const [modalMode, setModalMode,] = createSignal<'single' | 'multiple' | 'query' | null>(null,);

    return (
        <div class="block-edit-form entity-block-edit">
            <label class="block-edit-form__field">
                <span>Entity type</span>
                <select
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
                    <select value={cfg().templateId} onChange={(e,) => setCfg({ templateId: e.currentTarget.value, },)}>
                        <option value="">— select —</option>
                        <For each={templates() ?? []}>
                            {(t,) => <option value={t.id}>{t.name} ({t.mode})</option>}
                        </For>
                    </select>
                    <Show when={(templates() ?? []).length === 0}>
                        <small class="form-help-muted">No templates yet — create one in Entities → {cfg().entityType} → Templates.</small>
                    </Show>
                </label>
            </Show>

            <Show when={cfg().templateId}>
                <label class="block-edit-form__field">
                    <span>Data source</span>
                    <select
                        value={cfg().binding.mode}
                        onChange={(e,) => {
                            const mode = e.currentTarget.value as EntityBinding['mode'];
                            if (mode === 'single') setBinding({ mode, ref: '', },);
                            else if (mode === 'list') setBinding({ mode, refs: [], },);
                            else if (mode === 'query') setBinding({ mode, query: {}, },);
                            else setBinding({ mode: 'context', },);
                        }}
                    >
                        <option value="context">Current page entity</option>
                        <option value="single">A specific entity</option>
                        <option value="list">Several specific entities</option>
                        <option value="query">A query</option>
                    </select>
                </label>

                <Show when={cfg().binding.mode === 'single'}>
                    <button type="button" class="btn btn--small" onClick={() => setModalMode('single',)}>
                        {(cfg().binding as { ref?: string; }).ref ? `Entity: ${(cfg().binding as { ref: string; }).ref}` : 'Select entity…'}
                    </button>
                </Show>
                <Show when={cfg().binding.mode === 'list'}>
                    <button type="button" class="btn btn--small" onClick={() => setModalMode('multiple',)}>
                        Select entities ({((cfg().binding as { refs?: string[]; }).refs ?? []).length})
                    </button>
                </Show>
                <Show when={cfg().binding.mode === 'query'}>
                    <button type="button" class="btn btn--small" onClick={() => setModalMode('query',)}>
                        Configure query…
                    </button>
                </Show>
            </Show>

            <Show when={modalMode()}>
                <EntitySearchSelectModal
                    entityType={cfg().entityType}
                    mode={modalMode()!}
                    onClose={() => setModalMode(null,)}
                    onSelect={(result,) => {
                        const m = modalMode();
                        if (m === 'single') {
                            const r = result as EntityRecord;
                            setBinding({ mode: 'single', ref: String(r.slug ?? r.id), },);
                        } else if (m === 'multiple') {
                            const rs = result as EntityRecord[];
                            setBinding({ mode: 'list', refs: rs.map((r,) => String(r.id)), },);
                        } else if (m === 'query') {
                            setBinding({ mode: 'query', query: result as EntityQuery, },);
                        }
                        setModalMode(null,);
                    }}
                />
            </Show>
        </div>
    );
};

export default EntityBlockEdit;
