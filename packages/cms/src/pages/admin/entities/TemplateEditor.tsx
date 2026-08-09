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
import type { ContentBlockTemplate, EntityTypeDef, } from '@sitesurge/types';
import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import BlockEditor, { BlockData, } from '../../../components/admin/blocks/BlockEditor';
import { FormField, FormSection, } from '../../../components/admin/forms';
import { backendToEditor, type BackendBlock, editorToBackend, } from '../../../components/admin/mail/blockConverters';
import { cms, } from '../../../services/cmsClient';

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

    return (
        <div class="mail-template-edit-page">
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
                    </FormSection>
                </div>
            </section>

            <BlockEditor title="Template Blocks" blocks={blocks()} onBlocksChange={setBlocks} />

            <section class="admin-section">
                <header class="admin-section__header">
                    <h2>Available variables for {params.type}</h2>
                </header>
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
            </section>
        </div>
    );
};

export default TemplateEditor;
