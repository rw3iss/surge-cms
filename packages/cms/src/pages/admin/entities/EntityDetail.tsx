/**
 * EntityDetail — a single entity type with two tabs:
 *
 *   Schema → edit the type's basic props (label, routing, caching, …) and its
 *            field list (SchemaFieldEditor). Core/internal types show these
 *            read-only; the key and core fields are always locked.
 *   Data   → the type's records (EntityDataTable).
 */
import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import type { EntityCaching, EntityRouting, EntityTypeDef, EntityTypeUpdateBody, } from '@sitesurge/types';
import { Component, createSignal, onMount, Show, } from 'solid-js';
import SchemaFieldEditor from '../../../components/admin/entities/SchemaFieldEditor';
import EntityDataTable from '../../../components/admin/entities/EntityDataTable';
import FormCheck from '../../../components/admin/forms/FormCheck';
import FormField from '../../../components/admin/forms/FormField';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import './EntitiesList.scss';

const clone = <T,>(v: T,): T => JSON.parse(JSON.stringify(v,),);

const EntityDetail: Component = () => {
    const params = useParams<{ type: string; }>();
    const toast = useToast();
    const [draft, setDraft,] = createSignal<EntityTypeDef | null>(null,);
    const [loading, setLoading,] = createSignal(true,);
    const [saving, setSaving,] = createSignal(false,);
    const [tab, setTab,] = createSignal<'schema' | 'data'>('schema',);

    const locked = () => {
        const d = draft();
        return !!d && (d.origin === 'core' || d.internal);
    };

    const load = async () => {
        setLoading(true,);
        try {
            setDraft(await cms.entityTypes.getOne(params.type,),);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to load entity type',);
        }
        setLoading(false,);
    };

    onMount(load,);

    const patch = (changes: Partial<EntityTypeDef>,) => {
        const d = draft();
        if (d) setDraft({ ...d, ...changes, },);
    };
    const patchRouting = (changes: Partial<EntityRouting>,) => {
        const d = draft();
        if (d) setDraft({ ...d, routing: { ...d.routing, ...changes, }, },);
    };
    const patchCaching = (changes: Partial<EntityCaching>,) => {
        const d = draft();
        if (d) setDraft({ ...d, caching: { ...d.caching, ...changes, }, },);
    };

    const save = async () => {
        const d = draft();
        if (!d) return;
        setSaving(true,);
        try {
            const body: EntityTypeUpdateBody = locked() ? { fields: d.fields, } : {
                label: d.label,
                labelPlural: d.labelPlural,
                description: d.description || undefined,
                hasStatus: d.hasStatus,
                searchable: d.searchable,
                routing: d.routing,
                caching: d.caching,
                fields: d.fields,
            };
            const updated = await cms.entityTypes.update(d.key, body,);
            setDraft(clone(updated,),);
            toast.success('Schema saved',);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to save schema',);
        }
        setSaving(false,);
    };

    return (
        <div>
            <Title>Entity: {params.type} - Admin</Title>
            <div class="admin-header">
                <h1>
                    <A href="/admin/entities" class="table-link">Entities</A> / {draft()?.label || params.type}
                </h1>
                <Show when={tab() === 'schema' && draft()}>
                    <button class="btn btn--primary" onClick={save} disabled={saving()}>
                        {saving() ? 'Saving…' : 'Save schema'}
                    </button>
                </Show>
            </div>

            <div class="settings-tabs">
                <button
                    class={`settings-tabs__tab ${tab() === 'schema' ? 'settings-tabs__tab--active' : ''}`}
                    onClick={() => setTab('schema',)}
                >
                    Schema
                </button>
                <button
                    class={`settings-tabs__tab ${tab() === 'data' ? 'settings-tabs__tab--active' : ''}`}
                    onClick={() => setTab('data',)}
                >
                    Data
                </button>
            </div>

            <Show when={!loading() && draft()} fallback={<div class="empty-state">Loading…</div>}>
                {/* ─── Schema tab ─── */}
                <Show when={tab() === 'schema'}>
                    <Show when={locked()}>
                        <div class="alert alert--warning">
                            This is a {draft()!.internal ? 'system/internal' : 'core'} type — its key and core fields
                            are locked. You can still add custom fields.
                        </div>
                    </Show>

                    <div class="entity-schema__section">
                        <h3 class="entity-schema__section-title">Basics</h3>
                        <div class="entity-schema__grid">
                            <FormField label="Key">
                                <input type="text" value={draft()!.key} disabled />
                            </FormField>
                            <FormField label="Label">
                                <input
                                    type="text"
                                    value={draft()!.label}
                                    disabled={locked()}
                                    onInput={(e,) => patch({ label: e.currentTarget.value, },)}
                                />
                            </FormField>
                            <FormField label="Plural label">
                                <input
                                    type="text"
                                    value={draft()!.labelPlural}
                                    disabled={locked()}
                                    onInput={(e,) => patch({ labelPlural: e.currentTarget.value, },)}
                                />
                            </FormField>
                            <FormField label="Singular variable" hint="{{ }} name (set at creation)">
                                <input type="text" value={draft()!.singularVar} disabled />
                            </FormField>
                            <FormField label="Plural variable" hint="{{ }} name (set at creation)">
                                <input type="text" value={draft()!.pluralVar} disabled />
                            </FormField>
                            <FormField label="Description" class="entity-record-form__field--wide">
                                <input
                                    type="text"
                                    value={draft()!.description ?? ''}
                                    disabled={locked()}
                                    onInput={(e,) => patch({ description: e.currentTarget.value, },)}
                                />
                            </FormField>
                        </div>
                        <div class="schema-field__checks">
                            <FormCheck
                                label="Has status"
                                checked={draft()!.hasStatus}
                                onChange={(v,) => patch({ hasStatus: v, },)}
                                plain
                            />
                            <FormCheck
                                label="Searchable"
                                checked={draft()!.searchable}
                                onChange={(v,) => patch({ searchable: v, },)}
                                plain
                            />
                        </div>
                    </div>

                    <div class="entity-schema__section">
                        <h3 class="entity-schema__section-title">Public routing</h3>
                        <div class="entity-schema__grid">
                            <FormCheck
                                label="Detail pages enabled"
                                checked={draft()!.routing.detailEnabled}
                                onChange={(v,) => patchRouting({ detailEnabled: v, },)}
                                plain
                            />
                            <FormField label="Detail prefix" hint="e.g. /recipes → /recipes/:slug">
                                <input
                                    type="text"
                                    value={draft()!.routing.detailPrefix}
                                    disabled={locked()}
                                    onInput={(e,) => patchRouting({ detailPrefix: e.currentTarget.value, },)}
                                />
                            </FormField>
                            <FormCheck
                                label="Index page enabled"
                                checked={draft()!.routing.indexEnabled}
                                onChange={(v,) => patchRouting({ indexEnabled: v, },)}
                                plain
                            />
                            <FormField label="Index prefix">
                                <input
                                    type="text"
                                    value={draft()!.routing.indexPrefix}
                                    disabled={locked()}
                                    onInput={(e,) => patchRouting({ indexPrefix: e.currentTarget.value, },)}
                                />
                            </FormField>
                        </div>
                    </div>

                    <div class="entity-schema__section">
                        <h3 class="entity-schema__section-title">Caching</h3>
                        <div class="entity-schema__grid">
                            <FormCheck
                                label="Cache index"
                                checked={draft()!.caching.indexEnabled}
                                onChange={(v,) => patchCaching({ indexEnabled: v, },)}
                                plain
                            />
                            <FormField label="Index TTL (seconds)">
                                <input
                                    type="number"
                                    value={draft()!.caching.indexTtlSeconds}
                                    disabled={locked()}
                                    onInput={(e,) => patchCaching({ indexTtlSeconds: Number(e.currentTarget.value,) || 0, },)}
                                />
                            </FormField>
                            <FormCheck
                                label="Cache record"
                                checked={draft()!.caching.recordEnabled}
                                onChange={(v,) => patchCaching({ recordEnabled: v, },)}
                                plain
                            />
                            <FormField label="Record TTL (seconds)">
                                <input
                                    type="number"
                                    value={draft()!.caching.recordTtlSeconds}
                                    disabled={locked()}
                                    onInput={(e,) => patchCaching({ recordTtlSeconds: Number(e.currentTarget.value,) || 0, },)}
                                />
                            </FormField>
                        </div>
                    </div>

                    <div class="entity-schema__section">
                        <h3 class="entity-schema__section-title">Fields</h3>
                        <SchemaFieldEditor
                            fields={draft()!.fields}
                            onChange={(fields,) => patch({ fields, },)}
                        />
                    </div>

                    <div class="entity-schema__save-bar">
                        <button class="btn btn--primary" onClick={save} disabled={saving()}>
                            {saving() ? 'Saving…' : 'Save schema'}
                        </button>
                    </div>
                </Show>

                {/* ─── Data tab ─── */}
                <Show when={tab() === 'data'}>
                    <EntityDataTable type={draft()!} />
                </Show>
            </Show>
        </div>
    );
};

export default EntityDetail;
