/**
 * EntitiesList — the entity-type registry landing page. Lists every entity
 * type as a custom row (label + description, core/custom/internal badges, live
 * record count, a Templates link, and an "Edit schema" action) and lets an
 * admin create a new custom type.
 */
import { Title, } from '@solidjs/meta';
import { A, useNavigate, } from '@solidjs/router';
import type { EntityTypeDef, } from '@sitesurge/types';
import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import FormCheck from '../../../components/admin/forms/FormCheck';
import FormField from '../../../components/admin/forms/FormField';
import ModalShell from '../../../components/admin/common/ModalShell';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import './EntitiesList.scss';

const EntitiesList: Component = () => {
    const toast = useToast();
    const navigate = useNavigate();
    const [types, setTypes,] = createSignal<EntityTypeDef[]>([],);
    const [counts, setCounts,] = createSignal<Record<string, number>>({},);
    const [templateCounts, setTemplateCounts,] = createSignal<Record<string, number>>({},);
    const [loading, setLoading,] = createSignal(true,);

    // Create-modal state.
    const [showCreate, setShowCreate,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [form, setForm,] = createSignal({
        key: '',
        label: '',
        labelPlural: '',
        description: '',
        hasSlug: true,
        hasStatus: false,
        searchable: true,
    },);
    const patch = (changes: Partial<ReturnType<typeof form>>,) => setForm({ ...form(), ...changes, },);

    const load = async () => {
        setLoading(true,);
        try {
            const list = await cms.entityTypes.list();
            setTypes(list,);
            // Record + template counts, best-effort and in parallel.
            const recEntries = await Promise.all(
                list.map(async (t,) => {
                    try {
                        return [t.key, await cms.entities.count(t.key,),] as const;
                    } catch {
                        return [t.key, 0,] as const;
                    }
                }),
            );
            const tplEntries = await Promise.all(
                list.map(async (t,) => {
                    try {
                        return [t.key, (await cms.contentBlockTemplates.list(t.key,)).length,] as const;
                    } catch {
                        return [t.key, 0,] as const;
                    }
                }),
            );
            setCounts(Object.fromEntries(recEntries,),);
            setTemplateCounts(Object.fromEntries(tplEntries,),);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to load entity types',);
        }
        setLoading(false,);
    };

    onMount(load,);

    const submitCreate = async () => {
        const f = form();
        if (!f.key.trim() || !f.label.trim()) {
            toast.error('Key and label are required',);
            return;
        }
        setSaving(true,);
        try {
            const created = await cms.entityTypes.create({
                key: f.key.trim(),
                label: f.label.trim(),
                labelPlural: f.labelPlural.trim() || undefined,
                description: f.description.trim() || undefined,
                hasSlug: f.hasSlug,
                hasStatus: f.hasStatus,
                searchable: f.searchable,
            },);
            toast.success(`Created "${created.label}"`,);
            setShowCreate(false,);
            navigate(`/admin/entities/${created.key}`,);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to create entity type',);
        }
        setSaving(false,);
    };

    return (
        <div>
            <Title>Entities - Admin</Title>
            <div class="admin-header">
                <h1>Entities</h1>
                <button class="btn btn--primary" onClick={() => setShowCreate(true,)}>New entity type</button>
            </div>

            <Show when={!loading()} fallback={<div class="empty-state">Loading…</div>}>
                <Show
                    when={types().length}
                    fallback={<div class="empty-state">No entity types yet. Create one to get started.</div>}
                >
                    <div class="entity-type-rows">
                        <For each={types()}>
                            {(type,) => (
                                <div class="entity-type-row">
                                    <div class="entity-type-row__main">
                                        <div class="entity-type-row__title">
                                            <span class="entity-type-row__label">{type.label}</span>
                                            <span class="entity-type-row__key">{type.key}</span>
                                            <span class={`badge ${type.origin === 'core' ? 'badge--info' : 'badge--muted'}`}>
                                                {type.origin}
                                            </span>
                                            <Show when={type.internal}>
                                                <span class="badge badge--warning">internal</span>
                                            </Show>
                                        </div>
                                        <Show when={type.description}>
                                            <div class="entity-type-row__desc">{type.description}</div>
                                        </Show>
                                    </div>

                                    <div class="entity-type-row__meta">
                                        <span>
                                            <span class="entity-type-row__count">{counts()[type.key] ?? 0}</span>{' '}
                                            record{(counts()[type.key] ?? 0) === 1 ? '' : 's'}
                                        </span>
                                    </div>

                                    <div class="entity-type-row__actions">
                                        <A href={`/admin/entities/${type.key}/templates`} class="btn btn--small btn--ghost">
                                            Templates
                                            <Show when={templateCounts()[type.key]}>
                                                {' '}({templateCounts()[type.key]})
                                            </Show>
                                        </A>
                                        <A href={`/admin/entities/${type.key}`} class="btn btn--small btn--secondary">
                                            Edit schema
                                        </A>
                                    </div>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
            </Show>

            <ModalShell open={showCreate()} onClose={() => setShowCreate(false,)} size="md" ariaLabel="New entity type">
                <div style={{ padding: '1.25rem', }}>
                    <h2 style={{ 'margin-top': '0', }}>New entity type</h2>
                    <FormField label="Key" hint="Machine name (snake_case). Used in routes, table name, and {{ }} functions.">
                        <input
                            type="text"
                            placeholder="e.g. recipe"
                            value={form().key}
                            onInput={(e,) => patch({ key: e.currentTarget.value, },)}
                        />
                    </FormField>
                    <FormField label="Label">
                        <input
                            type="text"
                            placeholder="Recipe"
                            value={form().label}
                            onInput={(e,) => patch({ label: e.currentTarget.value, },)}
                        />
                    </FormField>
                    <FormField label="Plural label" hint="Defaults to label + 's'">
                        <input
                            type="text"
                            placeholder="Recipes"
                            value={form().labelPlural}
                            onInput={(e,) => patch({ labelPlural: e.currentTarget.value, },)}
                        />
                    </FormField>
                    <FormField label="Description">
                        <textarea
                            value={form().description}
                            onInput={(e,) => patch({ description: e.currentTarget.value, },)}
                        />
                    </FormField>
                    <div style={{ display: 'flex', gap: '1rem', 'flex-wrap': 'wrap', margin: '0.5rem 0 1rem', }}>
                        <FormCheck
                            label="Has slug"
                            checked={form().hasSlug}
                            onChange={(v,) => patch({ hasSlug: v, },)}
                            plain
                        />
                        <FormCheck
                            label="Has status"
                            checked={form().hasStatus}
                            onChange={(v,) => patch({ hasStatus: v, },)}
                            plain
                        />
                        <FormCheck
                            label="Searchable"
                            checked={form().searchable}
                            onChange={(v,) => patch({ searchable: v, },)}
                            plain
                        />
                    </div>
                    <div style={{ display: 'flex', 'justify-content': 'flex-end', gap: '0.5rem', }}>
                        <button class="btn btn--secondary" onClick={() => setShowCreate(false,)} disabled={saving()}>
                            Cancel
                        </button>
                        <button class="btn btn--primary" onClick={submitCreate} disabled={saving()}>
                            {saving() ? 'Creating…' : 'Create'}
                        </button>
                    </div>
                </div>
            </ModalShell>
        </div>
    );
};

export default EntitiesList;
