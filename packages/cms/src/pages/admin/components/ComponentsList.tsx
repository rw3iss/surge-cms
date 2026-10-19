/**
 * Components — reusable block templates bound to no entity type.
 *
 * A component is one or more blocks (nested, styled, breakpoint-aware) authored
 * once and referenced from anywhere by a `template` block. Referenced, not
 * copied: editing here changes every place it is used.
 *
 * Storage is the SAME `content_block_templates` table the entity system uses;
 * these rows simply have no `entity_type_key`. The editor is literally the same
 * component (`TemplateEditor`), which is why this page is only a list.
 *
 * Collections (left sidebar) are folders for organisation only. "[None]" is the
 * built-in entry for components filed nowhere (`collectionId` null); it cannot
 * be edited or deleted. The selection lives in `?collection=` (`none` default).
 */
import type { ComponentCollection, ContentBlockTemplate, } from '@sitesurge/types';
import { formatDate, } from '@sitesurge/types';
import { A, useNavigate, useSearchParams, } from '@solidjs/router';
import { Component, createMemo, createResource, createSignal, For, Show, } from 'solid-js';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import ModalShell from '../../../components/admin/common/ModalShell';
import TemplateDeleteConfirm from '../../../components/admin/entities/TemplateDeleteConfirm';
import { FormField, } from '../../../components/admin/forms';
import { useToast, } from '../../../components/common/toast';
import RadioGroup from '../../../components/ui/RadioGroup';
import { cms, } from '../../../services/cmsClient';
import './ComponentsList.scss';

const NONE = 'none';

/** Name + description form, shared by the create modal and the inline editor. */
const CollectionFields: Component<{
    name: string;
    description: string;
    onName: (v: string,) => void;
    onDescription: (v: string,) => void;
    autofocus?: boolean;
}> = (props,) => (
    <>
        <FormField label="Name">
            <input
                type="text"
                value={props.name}
                maxLength={200}
                autofocus={props.autofocus}
                onInput={(e,) => props.onName(e.currentTarget.value,)}
            />
        </FormField>
        <FormField label="Description" hint="Optional.">
            <textarea rows={2} value={props.description} onInput={(e,) => props.onDescription(e.currentTarget.value,)} />
        </FormField>
    </>
);

const ComponentsList: Component = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [params, setParams,] = useSearchParams<{ collection?: string; }>();
    const selected = () => params.collection || NONE;

    const [templates, { refetch, },] = createResource(async () => {
        try {
            return await cms.components.list();
        } catch {
            return [] as ContentBlockTemplate[];
        }
    },);
    const [cols, { refetch: refetchCols, },] = createResource(async () => {
        try {
            return await cms.components.collections();
        } catch {
            return { collections: [] as ComponentCollection[], noneCount: 0, };
        }
    },);
    const reloadAll = () => {
        void refetch();
        void refetchCols();
    };

    const collection = createMemo(() => (cols()?.collections ?? []).find((c,) => c.id === selected()) ?? null);
    const visible = createMemo(() =>
        (templates() ?? []).filter((t,) => (selected() === NONE ? !t.collectionId : t.collectionId === selected()))
    );

    // ─── Component delete (usage-listing, type-the-name confirm) ───
    const [deleting, setDeleting,] = createSignal<ContentBlockTemplate | null>(null,);
    const [busy, setBusy,] = createSignal(false,);
    const usageCount = (t: ContentBlockTemplate,): number | null => t.usageCount ?? t.usages?.length ?? null;
    const confirmDelete = async () => {
        const t = deleting();
        if (!t) return;
        setBusy(true,);
        try {
            await cms.components.remove(t.id,);
            setDeleting(null,);
            toast.success('Component deleted.',);
            reloadAll();
        } catch (e) {
            toast.error(`Could not delete: ${e instanceof Error ? e.message : 'unknown error'}`,);
        } finally {
            setBusy(false,);
        }
    };

    const handleCopy = async (t: ContentBlockTemplate,) => {
        try {
            const created = await cms.components.create({
                name: `${t.name} copy`,
                description: t.description ?? undefined,
                mode: t.mode,
                maxRecords: t.maxRecords ?? null,
                collectionId: t.collectionId ?? null,
            } as never,);
            const blocks = await cms.components.getBlocks(t.id,);
            if (blocks.length > 0) await cms.components.saveBlocks(created.id, blocks,);
            navigate(`/admin/components/${created.id}`,);
        } catch { /* error bus surfaces the toast */ }
    };

    // ─── New collection modal ───
    const [creating, setCreating,] = createSignal(false,);
    const [newName, setNewName,] = createSignal('',);
    const [newDesc, setNewDesc,] = createSignal('',);
    const openCreate = () => {
        setNewName('',);
        setNewDesc('',);
        setCreating(true,);
    };
    const createCollection = async (e?: Event,) => {
        e?.preventDefault();
        if (!newName().trim()) return;
        setBusy(true,);
        try {
            const c = await cms.components.createCollection({ name: newName().trim(), description: newDesc().trim() || null, },);
            setCreating(false,);
            toast.success(`Collection "${c.name}" created.`,);
            await refetchCols();
            setParams({ collection: c.id, },);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not create the collection.',);
        } finally {
            setBusy(false,);
        }
    };

    // ─── Inline edit of the selected collection ───
    const [editing, setEditing,] = createSignal(false,);
    const [editName, setEditName,] = createSignal('',);
    const [editDesc, setEditDesc,] = createSignal('',);
    const startEdit = () => {
        const c = collection();
        if (!c) return;
        setEditName(c.name,);
        setEditDesc(c.description ?? '',);
        setEditing(true,);
    };
    const saveEdit = async () => {
        const c = collection();
        if (!c || !editName().trim()) return;
        setBusy(true,);
        try {
            await cms.components.updateCollection(c.id, { name: editName().trim(), description: editDesc().trim() || null, },);
            setEditing(false,);
            await refetchCols();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not save the collection.',);
        } finally {
            setBusy(false,);
        }
    };
    const select = (id: string,) => {
        setEditing(false,);
        setParams({ collection: id === NONE ? undefined : id, },);
    };

    // ─── Delete collection ───
    const [removing, setRemoving,] = createSignal<ComponentCollection | null>(null,);
    const [removeMode, setRemoveMode,] = createSignal<'detach' | 'delete'>('detach',);
    const openRemove = () => {
        setRemoveMode('detach',);
        setRemoving(collection(),);
    };
    const removeCollection = async () => {
        const c = removing();
        if (!c) return;
        setBusy(true,);
        try {
            const res = await cms.components.deleteCollection(c.id, removeMode(),);
            setRemoving(null,);
            setEditing(false,);
            setParams({ collection: undefined, },);
            toast.success(
                res.components === 0
                    ? `Collection "${c.name}" deleted.`
                    : removeMode() === 'delete'
                    ? `Collection "${c.name}" and its ${res.components} component${res.components === 1 ? '' : 's'} deleted.`
                    : `Collection "${c.name}" deleted; ${res.components} component${res.components === 1 ? '' : 's'} moved to [None].`,
            );
            reloadAll();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not delete the collection.',);
        } finally {
            setBusy(false,);
        }
    };

    const newHref = () => (selected() === NONE ? '/admin/components/new' : `/admin/components/new?collection=${selected()}`);

    return (
        <div class="admin-page components-page admin-full-bleed">
            <AdminTitle>Components</AdminTitle>
            <div class="admin-header">
                <div class="components-page__title">
                    <h1>Components</h1>
                    <p class="admin-header__subtitle">Re-usable templates with JS + SDK support.</p>
                </div>
                <div class="admin-header__actions">
                    <A href={newHref()} class="ui-button ui-button--primary">+ New component</A>
                </div>
            </div>

            <div class="components-page__layout">
                {/* ── Collections sidebar ── */}
                <aside class="components-page__sidebar" aria-label="Collections">
                    <div class="components-page__sidebar-head">
                        <h2>Collections</h2>
                        <button type="button" class="ui-button ui-button--sm ui-button--secondary" onClick={openCreate}>
                            + New
                        </button>
                    </div>
                    <ul class="components-page__collections">
                        <li>
                            <button
                                type="button"
                                class="components-page__collection components-page__collection--none"
                                classList={{ 'is-active': selected() === NONE, }}
                                onClick={() => select(NONE,)}
                            >
                                <span>[None]</span>
                                <span class="components-page__count">({cols()?.noneCount ?? 0})</span>
                            </button>
                        </li>
                        <For each={cols()?.collections ?? []}>
                            {(c,) => (
                                <li>
                                    <button
                                        type="button"
                                        class="components-page__collection"
                                        classList={{ 'is-active': selected() === c.id, }}
                                        title={c.description ?? undefined}
                                        onClick={() => select(c.id,)}
                                    >
                                        <span class="components-page__collection-name">{c.name}</span>
                                        <span class="components-page__count">({c.count})</span>
                                    </button>
                                </li>
                            )}
                        </For>
                    </ul>
                </aside>

                <div class="components-page__main">
                    {/* ── Selected collection: info / edit panel ── */}
                    <Show when={collection()}>
                        {(c,) => (
                            <section class="components-page__info">
                                <Show
                                    when={editing()}
                                    fallback={
                                        <>
                                            <div class="components-page__info-text">
                                                <h2>{c().name}</h2>
                                                <Show when={c().description} fallback={<p class="form-help-muted">No description.</p>}>
                                                    <p>{c().description}</p>
                                                </Show>
                                            </div>
                                            <div class="components-page__info-actions">
                                                <button type="button" class="ui-button ui-button--sm ui-button--secondary" onClick={startEdit}>
                                                    Edit
                                                </button>
                                                <button type="button" class="ui-button ui-button--sm ui-button--danger" onClick={openRemove}>
                                                    Delete
                                                </button>
                                            </div>
                                        </>
                                    }
                                >
                                    <form
                                        class="components-page__info-text components-page__info-form"
                                        onSubmit={(e,) => {
                                            e.preventDefault();
                                            void saveEdit();
                                        }}
                                    >
                                        <CollectionFields
                                            name={editName()}
                                            description={editDesc()}
                                            onName={setEditName}
                                            onDescription={setEditDesc}
                                            autofocus
                                        />
                                    </form>
                                    <div class="components-page__info-actions">
                                        <button
                                            type="button"
                                            class="ui-button ui-button--sm ui-button--primary"
                                            disabled={busy() || !editName().trim()}
                                            onClick={() => void saveEdit()}
                                        >
                                            {busy() ? 'Saving…' : 'Save'}
                                        </button>
                                        <button type="button" class="ui-button ui-button--sm ui-button--ghost" onClick={() => setEditing(false,)}>
                                            Cancel
                                        </button>
                                    </div>
                                </Show>
                            </section>
                        )}
                    </Show>

                    <Show
                        when={visible().length > 0}
                        fallback={
                            <div class="empty-state">
                                <Show
                                    when={(templates() ?? []).length > 0}
                                    fallback={
                                        <>
                                            No components yet. A component is a reusable set of blocks you can drop onto any
                                            page with a <strong>Template</strong> block — edit it here and every use updates.
                                        </>
                                    }
                                >
                                    No components in this collection. Choose a collection in a component's Settings, or{' '}
                                    <A href={newHref()}>create one here</A>.
                                </Show>
                            </div>
                        }
                    >
                        <div class="admin-table-container">
                            <table class="admin-table">
                                <thead>
                                    <tr>
                                        <th class="components-list__name">Name</th>
                                        <th>Description</th>
                                        <th>Mode</th>
                                        <th>Uses</th>
                                        <th>Updated</th>
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    <For each={visible()}>
                                        {(t,) => (
                                            <tr>
                                                <td>
                                                    <A href={`/admin/components/${t.id}`} class="table-link">{t.name}</A>
                                                </td>
                                                <td>{t.description || '—'}</td>
                                                <td>{t.mode}</td>
                                                <td>{usageCount(t,) ?? '—'}</td>
                                                <td>{t.updatedAt ? formatDate(t.updatedAt,) : '—'}</td>
                                                <td class="admin-table__actions">
                                                    <A href={`/admin/components/${t.id}`} class="ui-button ui-button--sm ui-button--ghost">
                                                        Edit
                                                    </A>
                                                    <button
                                                        type="button"
                                                        class="ui-button ui-button--sm ui-button--ghost"
                                                        onClick={() => void handleCopy(t,)}
                                                    >
                                                        Copy
                                                    </button>
                                                    <button
                                                        type="button"
                                                        class="ui-button ui-button--sm ui-button--danger"
                                                        onClick={() => setDeleting(t,)}
                                                    >
                                                        Delete
                                                    </button>
                                                </td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                        </div>
                    </Show>
                </div>
            </div>

            {/* ── New collection ── */}
            <ModalShell open={creating()} onClose={() => setCreating(false,)} size="sm" ariaLabel="New collection">
                <form class="components-page__modal" onSubmit={createCollection}>
                    <h2>New collection</h2>
                    <CollectionFields
                        name={newName()}
                        description={newDesc()}
                        onName={setNewName}
                        onDescription={setNewDesc}
                        autofocus
                    />
                    <div class="components-page__modal-actions">
                        <button type="button" class="ui-button ui-button--ghost" onClick={() => setCreating(false,)}>Cancel</button>
                        <button type="submit" class="ui-button ui-button--primary" disabled={busy() || !newName().trim()}>
                            {busy() ? 'Creating…' : 'Create collection'}
                        </button>
                    </div>
                </form>
            </ModalShell>

            {/* ── Delete collection ── */}
            <ModalShell open={removing() !== null} onClose={() => setRemoving(null,)} size="sm" ariaLabel="Delete collection">
                <div class="components-page__modal">
                    <h2>Delete collection "{removing()?.name}"?</h2>
                    <Show
                        when={(removing()?.count ?? 0) > 0}
                        fallback={<p>It has no components. This cannot be undone.</p>}
                    >
                        <p>
                            It holds {removing()?.count} component{removing()?.count === 1 ? '' : 's'}. What should happen to{' '}
                            {removing()?.count === 1 ? 'it' : 'them'}?
                        </p>
                        <RadioGroup
                            name="collection-delete-mode"
                            value={removeMode()}
                            onChange={(v,) => setRemoveMode(v as 'detach' | 'delete',)}
                            options={[
                                {
                                    value: 'detach',
                                    label: 'Move them to [None]',
                                    description: 'The components stay; they are just no longer filed in a collection.',
                                },
                                {
                                    value: 'delete',
                                    label: 'Delete them too',
                                    description: 'Every page, post or email using them loses that content. This cannot be undone.',
                                },
                            ]}
                        />
                    </Show>
                    <div class="components-page__modal-actions">
                        <button type="button" class="ui-button ui-button--ghost" onClick={() => setRemoving(null,)}>Cancel</button>
                        <button type="button" class="ui-button ui-button--danger" disabled={busy()} onClick={() => void removeCollection()}>
                            {busy() ? 'Deleting…' : removeMode() === 'delete' && (removing()?.count ?? 0) > 0 ? 'Delete collection + components' : 'Delete collection'}
                        </button>
                    </div>
                </div>
            </ModalShell>

            <TemplateDeleteConfirm
                open={deleting() !== null}
                title="Delete component"
                name={deleting()?.name ?? ''}
                usages={deleting()?.usages ?? null}
                loading={busy()}
                onConfirm={() => void confirmDelete()}
                onCancel={() => setDeleting(null,)}
            />
        </div>
    );
};

export default ComponentsList;
