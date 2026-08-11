/**
 * Create/edit a content-block template for an entity type. Top: meta (name,
 * description, single/list mode, max records). Middle: the SAME BlockEditor +
 * style panel used for pages/posts/mail, bound to the template's block subtree.
 * Bottom: the entity's field reference (for `{{entity.field}}` authoring).
 *
 * Mirrors MailTemplateEdit; reuses the mail blockConverters (identical block
 * shape) to map editor ↔ backend blocks.
 */
import { Title, } from '@solidjs/meta';
import { A, useNavigate, useParams, } from '@solidjs/router';
import type { ContentBlockTemplate, EntityRecord, EntityTypeDef, } from '@sitesurge/types';
import { Component, createEffect, createResource, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import BlockEditor, { BlockData, } from '../../../components/admin/blocks/BlockEditor';
import EntitySearchSelectModal from '../../../components/admin/entities/EntitySearchSelectModal';
import { FormField, FormSection, } from '../../../components/admin/forms';
import { backendToEditor, type BackendBlock, editorToBackend, } from '../../../components/admin/mail/blockConverters';
import { cms, } from '../../../services/cmsClient';
import { setTemplatePreviewContext, } from '../../../stores/templatePreviewContext';
import './EntitiesList.scss';

/** Fallback sample-record count for a `list` template with no `maxRecords` set —
 *  how many records to load into the editor preview. Static for now. */
const DEFAULT_SAMPLE_LIST_COUNT = 4;

/** Best human label for a sample record chip (title/name/slug → id). */
function recordLabel(r: EntityRecord,): string {
    return String(
        (r.title as string) || (r.name as string) || r.slug || r.id || '(record)',
    );
}

const TemplateEditor: Component = () => {
    const params = useParams<{ type: string; id: string; }>();
    const navigate = useNavigate();
    const isNew = () => params.id === 'new';

    const [name, setName,] = createSignal('',);
    const [description, setDescription,] = createSignal('',);
    const [mode, setMode,] = createSignal<'single' | 'list'>('single',);
    const [maxRecords, setMaxRecords,] = createSignal<string>('',);
    const [blocks, setBlocks,] = createSignal<BlockData[]>([],);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);
    const [entityDef, setEntityDef,] = createSignal<EntityTypeDef | null>(null,);
    // Preview sample: explicit record ids override the auto-pick. Empty = auto.
    const [sampleRecordIds, setSampleRecordIds,] = createSignal<string[]>([],);
    const [sampleModalOpen, setSampleModalOpen,] = createSignal(false,);
    // Variable reference is collapsed by default — it's a lookup aid, not
    // primary content, so it shouldn't push the editor down on every visit.
    const [varsOpen, setVarsOpen,] = createSignal(false,);

    onMount(async () => {
        try {
            setEntityDef(await cms.entityTypes.getOne(params.type,),);
        } catch { /* ignore */ }
        if (isNew()) return;
        try {
            const d = await cms.contentBlockTemplates.getOne(params.type, params.id,);
            setName(d.name,);
            setDescription(d.description ?? '',);
            setMode(d.mode,);
            setMaxRecords(d.maxRecords != null ? String(d.maxRecords,) : '',);
            setSampleRecordIds(d.sampleRecordIds ?? [],);
            setBlocks(backendToEditor((d.blocks ?? []) as unknown as BackendBlock[],),);
        } catch { /* ignore */ }
    },);

    const handleSave = async (): Promise<void> => {
        setSaving(true,);
        setError(null,);
        try {
            const meta = {
                name: name(), description: description() || undefined,
                mode: mode(), maxRecords: maxRecords() ? Number(maxRecords(),) : null,
                sampleRecordIds: sampleRecordIds(),
            };
            if (isNew()) {
                const created = await cms.contentBlockTemplates.create(params.type, meta as never,) as ContentBlockTemplate;
                if (blocks().length > 0) {
                    await cms.contentBlockTemplates.saveBlocks(params.type, created.id, editorToBackend(blocks(),) as never,);
                }
                navigate(`/admin/entities/${params.type}/templates/${created.id}`,);
            } else {
                await cms.contentBlockTemplates.update(params.type, params.id, meta as never,);
                await cms.contentBlockTemplates.saveBlocks(params.type, params.id, editorToBackend(blocks(),) as never,);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Save failed.',);
        } finally {
            setSaving(false,);
        }
    };

    const handleDelete = async (): Promise<void> => {
        if (!confirm('Delete this template? This cannot be undone.',)) return;
        await cms.contentBlockTemplates.remove(params.type, params.id,);
        navigate(`/admin/entities/${params.type}/templates`,);
    };

    const singularVar = () => entityDef()?.singularVar ?? params.type;
    const pluralVar = () => entityDef()?.pluralVar ?? `${params.type}s`;

    // How many auto sample records to load: single → 1; list → maxRecords (or
    // the static fallback when no cap is set).
    const sampleLimit = (): number => {
        if (mode() !== 'list') return 1;
        const max = Number(maxRecords(),);
        return Number.isFinite(max,) && max > 0 ? max : DEFAULT_SAMPLE_LIST_COUNT;
    };

    // Resolve the sample record(s): explicit `sampleRecordIds` if chosen, else
    // the first record(s) of the bound type. Re-runs on type/mode/max/id change.
    const [sampleRecords] = createResource(
        () => ({ type: params.type, mode: mode(), limit: sampleLimit(), ids: sampleRecordIds(), }),
        async ({ type, mode: m, limit, ids, },): Promise<EntityRecord[]> => {
            if (!type) return [];
            try {
                if (ids.length > 0) {
                    const wanted = m === 'list' ? ids : ids.slice(0, 1,);
                    const recs = await Promise.all(
                        wanted.map((id,) => cms.entities.getOne(type, id,).catch(() => null,)),
                    );
                    return recs.filter((r,): r is EntityRecord => r != null);
                }
                const res = await cms.entities.list(type, { limit, } as never,);
                return ((res.data ?? []) as EntityRecord[]).slice(0, limit,);
            } catch {
                return [];
            }
        },
    );

    // Publish the sample into the block-editor preview context so template
    // blocks' `{{singular.field}}` (and `{{for plural as x}}`) resolve while
    // authoring. The editor edits ONE subtree, so the FIRST record binds under
    // the singular var; the whole set binds under the plural var. Cleared on
    // unmount so pages/posts/mail editors are unaffected.
    createEffect(() => {
        const recs = sampleRecords() ?? [];
        const first = recs[0];
        if (!first) { setTemplatePreviewContext(undefined,); return; }
        setTemplatePreviewContext({
            [singularVar()]: { kind: params.type, data: first as Record<string, unknown>, id: String(first.id ?? '',), },
            [pluralVar()]: { kind: params.type, data: recs as unknown as Record<string, unknown>, id: '', },
        },);
    },);
    onCleanup(() => setTemplatePreviewContext(undefined,),);

    // One-line description of the current sample source (auto vs custom).
    const sampleNote = (): string => {
        const n = sampleRecordIds().length;
        if (n > 0) return `Custom: ${n} ${n === 1 ? 'record' : 'records'} chosen.`;
        return mode() === 'list'
            ? `Auto: first ${sampleLimit()} ${pluralVar()}.`
            : `Auto: first ${singularVar()} found.`;
    };

    return (
        <div class="mail-template-edit-page admin-full-bleed">
            <Title>{isNew() ? 'New Template' : name() || 'Edit Template'} - Admin</Title>
            <div class="admin-header">
                <A href={`/admin/entities/${params.type}/templates`} class="admin-header__back">← Templates</A>
                <h1>{isNew() ? `New ${params.type} template` : name() || '…'}</h1>
                <div class="admin-header__actions">
                    <Show when={!isNew()}>
                        <button type="button" class="btn btn--danger" onClick={handleDelete}>Delete</button>
                    </Show>
                    <button type="button" class="btn btn--primary" onClick={handleSave} disabled={saving()}>
                        {saving() ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>

            <Show when={error()}><div class="alert alert--error">{error()}</div></Show>

            <section class="admin-section template-settings">
                <header class="admin-section__header"><h2>Settings</h2></header>
                <div class="template-settings__grid">
                    <FormSection title="Identity">
                        <FormField label="Name">
                            <input type="text" value={name()} onInput={(e,) => setName(e.currentTarget.value,)} />
                        </FormField>
                        <FormField label="Description">
                            <textarea rows={2} value={description()} onInput={(e,) => setDescription(e.currentTarget.value,)} />
                        </FormField>
                    </FormSection>
                    <FormSection title="Binding">
                        <FormField label="Mode" hint="Single binds one record; List renders once per record.">
                            <select value={mode()} onChange={(e,) => setMode(e.currentTarget.value as 'single' | 'list',)}>
                                <option value="single">Single</option>
                                <option value="list">List</option>
                            </select>
                        </FormField>
                        <Show when={mode() === 'list'}>
                            <FormField label="Max records" hint="Optional cap on how many records a using block may bind/query.">
                                <input type="number" min="1" value={maxRecords()} onInput={(e,) => setMaxRecords(e.currentTarget.value,)} />
                            </FormField>
                        </Show>
                        <FormField
                            label="Preview sample"
                            hint="Record(s) loaded so this template's {{ }} variables preview real data while editing."
                        >
                            <div class="template-sample">
                                <div class="template-sample__chips">
                                    <Show
                                        when={(sampleRecords() ?? []).length > 0}
                                        fallback={
                                            <span class="form-help-muted">
                                                {sampleRecords.loading ? 'Loading…' : `No ${pluralVar()} found to preview.`}
                                            </span>
                                        }
                                    >
                                        <For each={sampleRecords()}>
                                            {(r,) => (
                                                <span class="template-sample__chip" title={String(r.id,)}>
                                                    {recordLabel(r,)}
                                                </span>
                                            )}
                                        </For>
                                    </Show>
                                </div>
                                <div class="template-sample__actions">
                                    <button type="button" class="btn btn--small" onClick={() => setSampleModalOpen(true,)}>
                                        {sampleRecordIds().length > 0 ? 'Change' : 'Set'} sample{mode() === 'list' ? 's' : ''}…
                                    </button>
                                    <Show when={sampleRecordIds().length > 0}>
                                        <button
                                            type="button"
                                            class="btn btn--small btn--ghost"
                                            onClick={() => setSampleRecordIds([],)}
                                        >
                                            Use auto
                                        </button>
                                    </Show>
                                </div>
                                <span class="form-help-muted template-sample__note">{sampleNote()}</span>
                            </div>
                        </FormField>
                    </FormSection>
                </div>
            </section>

            <Show when={sampleModalOpen()}>
                <EntitySearchSelectModal
                    entityType={params.type}
                    mode={mode() === 'list' ? 'multiple' : 'single'}
                    max={mode() === 'list' ? sampleLimit() : undefined}
                    onClose={() => setSampleModalOpen(false,)}
                    onSelect={(result,) => {
                        if (mode() === 'list') {
                            setSampleRecordIds((result as EntityRecord[]).map((r,) => String(r.id,)),);
                        } else {
                            setSampleRecordIds([String((result as EntityRecord).id,),],);
                        }
                        setSampleModalOpen(false,);
                    }}
                />
            </Show>

            <BlockEditor title="Template Blocks" blocks={blocks()} onBlocksChange={setBlocks} />

            <section class="admin-section template-vars-section">
                <button
                    type="button"
                    class="template-vars-section__toggle"
                    aria-expanded={varsOpen()}
                    onClick={() => setVarsOpen(v => !v)}
                >
                    <span class="template-vars-section__chevron">{varsOpen() ? '▼' : '▶'}</span>
                    <span>Available variables for {params.type}</span>
                </button>
                <Show when={varsOpen()}>
                    <p class="form-help-muted" style={{ padding: '0 1rem', }}>
                        Use <code>{`{{${singularVar()}.<field>}}`}</code> inside any block to render the bound {params.type}.
                    </p>
                    <Show when={entityDef()}>
                        <table class="admin-table">
                            <thead><tr><th>Variable</th><th>Type</th></tr></thead>
                            <tbody>
                                <For each={entityDef()!.fields}>
                                    {(f,) => (
                                        <tr>
                                            <td><code>{`{{${singularVar()}.${f.key}}}`}</code></td>
                                            <td>{f.type}{f.core ? ' (core)' : ''}</td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </Show>
                </Show>
            </section>
        </div>
    );
};

export default TemplateEditor;
