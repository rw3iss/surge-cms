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
import { useToast, } from '../../../components/common/toast';
import type { ContentBlockTemplate, EntityRecord, EntityTypeDef, } from '@sitesurge/types';
import { Component, createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import BlockEditor, { BlockData, } from '../../../components/admin/blocks/BlockEditor';
import { mountComponentScript, } from '../../../services/componentScript';
import JsEditor from '../../../components/admin/common/JsEditor';
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

/** Pick the most illustrative sub-field for an array-of-objects example. */
function preferredSub(keys: string[],): string {
    return ['price', 'url', 'title', 'name', 'label',].find((k,) => keys.includes(k,)) ?? keys[0];
}

const TemplateEditor: Component = () => {
    // `type` is absent on the Components route (/admin/components/:id): those
    // templates are bound to no entity. Everything entity-specific — the sample
    // record, the binding panel, the {{var}} reference — keys off this.
    const params = useParams<{ type?: string; id: string; }>();
    const navigate = useNavigate();
    const toast = useToast();
    const isNew = () => params.id === 'new';
    const isGlobal = () => !params.type;

    /**
     * The two template APIs differ only in whether an entity type is in the
     * path, so route through one adapter rather than branching at each of the
     * six call sites — where a missed branch would silently write a global
     * template into an entity's list, or vice versa.
     */
    const api = {
        getOne: (id: string,) =>
            isGlobal() ? cms.components.getOne(id,) : cms.contentBlockTemplates.getOne(params.type!, id,),
        create: (body: unknown,) =>
            isGlobal()
                ? cms.components.create(body as never,)
                : cms.contentBlockTemplates.create(params.type!, body as never,),
        update: (id: string, body: unknown,) =>
            isGlobal()
                ? cms.components.update(id, body as never,)
                : cms.contentBlockTemplates.update(params.type!, id, body as never,),
        remove: (id: string,) =>
            isGlobal() ? cms.components.remove(id,) : cms.contentBlockTemplates.remove(params.type!, id,),
        saveBlocks: (id: string, b: unknown,) =>
            isGlobal()
                ? cms.components.saveBlocks(id, b as never,)
                : cms.contentBlockTemplates.saveBlocks(params.type!, id, b as never,),
    };

    /** Where the list lives, for back-links and post-save navigation. */
    const listHref = () => (isGlobal() ? '/admin/components' : `/admin/entities/${params.type}/templates`);
    const itemHref = (id: string,) => `${listHref()}/${id}`;

    const [name, setName,] = createSignal('',);
    const [description, setDescription,] = createSignal('',);
    const [mode, setMode,] = createSignal<'single' | 'list'>('single',);
    const [maxRecords, setMaxRecords,] = createSignal<string>('',);
    const [blocks, setBlocks,] = createSignal<BlockData[]>([],);
    /**
     * The blocks as last SAVED. BlockEditor diffs against this to decide which
     * blocks are dirty; without it every block has no saved counterpart and is
     * therefore reported dirty forever — the "Unsaved changes" bar never
     * cleared, even immediately after a successful save.
     */
    const [savedBlocks, setSavedBlocks,] = createSignal<BlockData[]>([],);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);
    const [entityDef, setEntityDef,] = createSignal<EntityTypeDef | null>(null,);
    // Preview sample: explicit record ids override the auto-pick. Empty = auto.
    const [sampleRecordIds, setSampleRecordIds,] = createSignal<string[]>([],);
    const [sampleModalOpen, setSampleModalOpen,] = createSignal(false,);
    // Variable reference is collapsed by default — it's a lookup aid, not
    // primary content, so it shouldn't push the editor down on every visit.
    const [varsOpen, setVarsOpen,] = createSignal(false,);
    // Component JS. Only offered for a global component — an entity-bound
    // template renders per record and has no single element to mount against.
    const [script, setScript,] = createSignal('',);
    const [scriptEnabled, setScriptEnabled,] = createSignal(true,);
    const [scriptOpen, setScriptOpen,] = createSignal(false,);

    /**
     * Run the component's client module over its own editor previews.
     *
     * Re-mounts whenever the blocks change or the script is saved, tearing the
     * previous one down first — the module measures the DOM, and BlockEditor
     * rebuilds it on every edit, so a stale mount would hold references to
     * elements that no longer exist.
     *
     * Deliberately keyed on the SAVED script: `/client.js` serves what is
     * stored, so mounting on every keystroke in the JS editor would run
     * half-typed code.
     */
    const [scriptHost, setScriptHost,] = createSignal<HTMLElement | undefined>();
    const [savedScriptRev, setSavedScriptRev,] = createSignal(0,);
    /**
     * Signature of what the script actually renders against.
     *
     * Keyed on block CONTENT, not on the `blocks()` array identity: the editor
     * hands back a fresh array on plenty of things that don't change the
     * markup, and each one tore the mount down and rebuilt it. Between the two
     * the component sits un-enhanced, which for anything the script lays out
     * means a visible flash of the raw markup on every keystroke.
     */
    const blockSignature = createMemo(() =>
        JSON.stringify(blocks().map((b,) => [b.id, b.type, b.sort_order, b.data,]),),
    );
    createEffect(() => {
        const host = scriptHost();
        // Tracked so an edit re-runs the mount against the rebuilt DOM.
        const rev = savedScriptRev();
        void blockSignature();
        if (!isGlobal() || isNew() || !host || !params.id || rev < 0) return;

        let teardown: (() => void) | undefined;
        let disposed = false;
        // One frame's grace so BlockEditor has finished rendering the blocks
        // this run is meant to enhance.
        const t = window.setTimeout(() => {
            void (async () => {
                const ret = await mountComponentScript({ templateId: params.id!, el: host, },);
                if (disposed) ret();
                else teardown = ret;
            })();
        }, 60,);

        onCleanup(() => {
            disposed = true;
            window.clearTimeout(t,);
            try {
                teardown?.();
            } catch { /* a failing teardown must not break the editor */ }
        },);
    },);

    onMount(async () => {
        if (!isGlobal()) {
            try {
                setEntityDef(await cms.entityTypes.getOne(params.type!,),);
            } catch { /* ignore */ }
        }
        if (isNew()) return;
        try {
            const d = await api.getOne(params.id,);
            setName(d.name,);
            setDescription(d.description ?? '',);
            setMode(d.mode,);
            setMaxRecords(d.maxRecords != null ? String(d.maxRecords,) : '',);
            setSampleRecordIds(d.sampleRecordIds ?? [],);
            setScript(d.script ?? '',);
            setScriptEnabled(d.scriptEnabled !== false,);
            if (d.script) setScriptOpen(true,);
            const loaded = backendToEditor((d.blocks ?? []) as unknown as BackendBlock[],);
            setBlocks(loaded,);
            // Whatever the server just gave us IS the saved state.
            setSavedBlocks(structuredClone(loaded,),);
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
                // Only send script fields for a component — the backend gates
                // them behind `components:script`, so an entity template save
                // must not carry them or a non-admin editor would 403.
                ...(isGlobal() ? { script: script() || null, scriptEnabled: scriptEnabled(), } : {}),
            };
            if (isNew()) {
                const created = await api.create(meta,) as ContentBlockTemplate;
                if (blocks().length > 0) {
                    await api.saveBlocks(created.id, editorToBackend(blocks(),),);
                }
                setSavedBlocks(structuredClone(blocks(),),);
                toast.success(isGlobal() ? 'Component created.' : 'Template created.',);
                navigate(itemHref(created.id,),);
            } else {
                await api.update(params.id, meta,);
                await api.saveBlocks(params.id, editorToBackend(blocks(),),);
                // Snapshot AFTER the write succeeds, so a failed save leaves
                // the blocks correctly marked dirty.
                setSavedBlocks(structuredClone(blocks(),),);
                toast.success(isGlobal() ? 'Component saved.' : 'Template saved.',);
                // `/client.js` serves the SAVED script, so a save is the only
                // moment a re-mount can pick up new code.
                setSavedScriptRev((n,) => n + 1);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Save failed.';
            setError(msg,);
            toast.error(msg,);
        } finally {
            setSaving(false,);
        }
    };

    const handleDelete = async (): Promise<void> => {
        if (!confirm('Delete this template? This cannot be undone.',)) return;
        await api.remove(params.id,);
        navigate(listHref(),);
    };

    const singularVar = () => entityDef()?.singularVar ?? params.type ?? '';
    const pluralVar = () => entityDef()?.pluralVar ?? `${params.type ?? ''}s`;

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
        // A global template has no bound type, so there is no sample to load.
        () => ({ type: params.type ?? '', mode: mode(), limit: sampleLimit(), ids: sampleRecordIds(), }),
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
        const kind = params.type ?? '';
        setTemplatePreviewContext({
            [singularVar()]: { kind, data: first as Record<string, unknown>, id: String(first.id ?? '',), },
            [pluralVar()]: { kind, data: recs as unknown as Record<string, unknown>, id: '', },
        },);
    },);
    onCleanup(() => setTemplatePreviewContext(undefined,),);

    // Variables present on the loaded sample record but NOT declared as schema
    // fields — i.e. arrays/objects a data provider enriches onto every record
    // (e.g. the Shop provider's product.media / product.tags / product.variants).
    // Derived from real data so it's correct without a hardcoded per-type list.
    const extraVars = () => {
        const rec = sampleRecords()?.[0] as Record<string, unknown> | undefined;
        if (!rec) return [] as Array<{ key: string; isArray: boolean; subKeys: string[]; }>;
        const declared = new Set((entityDef()?.fields ?? []).map((f,) => f.key),);
        const managed = new Set(['id', 'slug', 'status', 'createdAt', 'updatedAt',],);
        return Object.entries(rec,)
            .filter(([k, v,],) =>
                !declared.has(k,) && !managed.has(k,)
                && (Array.isArray(v,) || (v != null && typeof v === 'object'))
            )
            .map(([k, v,],) => {
                const arr = Array.isArray(v,) ? v : null;
                const first = arr && arr.length && arr[0] && typeof arr[0] === 'object'
                    ? arr[0] as Record<string, unknown>
                    : null;
                return { key: k, isArray: !!arr, subKeys: first ? Object.keys(first,) : [], };
            });
    };

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
                <A href={listHref()} class="admin-header__back">
                    {isGlobal() ? '← Components' : '← Templates'}
                </A>
                <h1>
                    {isNew()
                        ? (isGlobal() ? 'New component' : `New ${params.type} template`)
                        : name() || '…'}
                </h1>
                <div class="admin-header__actions">
                    <Show when={!isNew()}>
                        <button type="button" class="ui-button ui-button--danger" onClick={handleDelete}>Delete</button>
                    </Show>
                    <button type="button" class="ui-button ui-button--primary" onClick={handleSave} disabled={saving()}>
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
                    {/* Entity binding + preview sample only exist for a template bound
                        to an entity type. A component has no records to bind. */}
                    <Show when={!isGlobal()}>
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
                                    <button type="button" class="ui-button ui-button--sm" onClick={() => setSampleModalOpen(true,)}>
                                        {sampleRecordIds().length > 0 ? 'Change' : 'Set'} sample{mode() === 'list' ? 's' : ''}…
                                    </button>
                                    <Show when={sampleRecordIds().length > 0}>
                                        <button
                                            type="button"
                                            class="ui-button ui-button--sm ui-button--ghost"
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
                    </Show>
                </div>
            </section>

            <Show when={sampleModalOpen()}>
                <EntitySearchSelectModal
                    entityType={params.type!}
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

            {/* The component's own client module runs over these previews, so
                a component whose layout its script produces (a ticker, anything
                measured) looks here the way it will on the site. Without it the
                editor showed inert markup — the one place you'd go to fix the
                component was the one place it didn't work. */}
            <div ref={setScriptHost}>
                <BlockEditor
                    title={isGlobal() ? 'Component Blocks' : 'Template Blocks'}
                    blocks={blocks()}
                    savedBlocks={savedBlocks()}
                    onBlocksChange={setBlocks}
                />
            </div>

            {/* Component JavaScript — global components only. */}
            <Show when={isGlobal()}>
                <section class="admin-section template-script-section">
                    <button
                        type="button"
                        class="template-vars-section__toggle"
                        aria-expanded={scriptOpen()}
                        onClick={() => setScriptOpen((v,) => !v)}
                    >
                        <span class="template-vars-section__chevron">{scriptOpen() ? '▼' : '▶'}</span>
                        <span>JavaScript{script() ? ' — in use' : ' (optional)'}</span>
                    </button>
                    <Show when={scriptOpen()}>
                        <div class="template-script-section__body">
                            <p class="form-help-muted">
                                Served as a same-origin ES module and mounted where this component
                                renders. Export <code>mount(el, ctx)</code>; return a function to
                                clean up.
                                {' '}
                                <code>ctx</code> gives <code>cms</code> (the SDK),
                                {' '}<code>user</code> (null when signed out), <code>settings</code>,
                                {' '}and <code>block</code> (the using block's settings).
                            </p>
                            <p class="form-help-muted">
                                This runs in every visitor's browser. Inline <code>&lt;script&gt;</code>
                                {' '}and <code>onclick</code> are blocked by the site's CSP, which is
                                {' '}why the code lives here instead of in an HTML block.
                            </p>
                            <p class="template-script-section__help">
                                <A href="/admin/help/sdk/component-js" target="_blank">
                                    Component JavaScript reference →
                                </A>
                                <span class="form-help-muted">
                                    {' '}The <code>mount</code> contract, everything on{' '}
                                    <code>ctx.cms</code>, and worked examples.
                                </span>
                            </p>
                            <label class="template-script-section__toggle-row">
                                <input
                                    type="checkbox"
                                    checked={scriptEnabled()}
                                    onChange={(e,) => setScriptEnabled(e.currentTarget.checked,)}
                                />
                                <span>Run this script (uncheck to disable without deleting it)</span>
                            </label>
                            <JsEditor
                                value={script()}
                                onChange={setScript}
                                height="360px"
                                placeholder={'export function mount(el, ctx) {\n  // ...\n  return () => {};\n}'}
                            />
                        </div>
                    </Show>
                </section>
            </Show>

            {/* The {{var}} reference lists the BOUND entity's fields; a component
                has none, so the section would be an empty table. */}
            <Show when={!isGlobal()}>
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

                    <Show when={extraVars().length > 0}>
                        <p class="form-help-muted" style={{ padding: '0.75rem 1rem 0', }}>
                            Enriched variables (arrays/objects added to every record by the type's data provider):
                        </p>
                        <table class="admin-table">
                            <thead><tr><th>Variable</th><th>Type</th></tr></thead>
                            <tbody>
                                <For each={extraVars()}>
                                    {(v,) => (
                                        <tr>
                                            <td>
                                                <code>{`{{${singularVar()}.${v.key}}}`}</code>
                                                <Show when={v.isArray && v.subKeys.length > 0}>
                                                    <div class="form-help-muted" style={{ 'font-size': '11px', 'margin-top': '2px', }}>
                                                        e.g. <code>{`{{${singularVar()}.${v.key}[0].${preferredSub(v.subKeys,)}}}`}</code>
                                                        {' · fields: '}{v.subKeys.join(', ',)}
                                                    </div>
                                                </Show>
                                            </td>
                                            <td>{v.isArray ? 'array' : 'object'}</td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </Show>
                </Show>
            </section>
            </Show>
        </div>
    );
};

export default TemplateEditor;
