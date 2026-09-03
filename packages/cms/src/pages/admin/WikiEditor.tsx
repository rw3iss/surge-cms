/**
 * Edit one wiki page: properties and view permissions across the top, the
 * markdown editor filling the rest.
 *
 * The editor gets the space because writing is the job here — the properties
 * are set once and the body is edited forever.
 */
import { Title, } from '@solidjs/meta';
import { A, useNavigate, useParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, Show, } from 'solid-js';
import type { WikiPage, } from '@sitesurge/types';
import { generateSlug, } from '@sitesurge/types';
import { cms, } from '../../services/cmsClient';
import { useToast, } from '../../components/common/toast';
import { FormField, } from '../../components/admin/forms';
import CollapsiblePanel from '../../components/admin/common/CollapsiblePanel';
import MarkdownEditor from '../../components/admin/common/MarkdownEditor';
import ModalShell from '../../components/admin/common/ModalShell';
import './Wiki.scss';

/** Roles that can be granted view access to a single page. */
const VIEW_ROLES = ['anonymous', 'member', 'editor', 'admin', 'sysadmin',];

const WikiEditor: Component = () => {
    const params = useParams<{ id: string; }>();
    const navigate = useNavigate();
    const toast = useToast();

    const [page] = createResource(() => params.id, async (id,) => {
        try { return await cms.wiki.getByRef(id,); } catch { return null; }
    },);

    const [all] = createResource(async () => {
        try { return await cms.wiki.list(true,); } catch { return [] as WikiPage[]; }
    },);

    const [title, setTitle,] = createSignal('',);
    const [slug, setSlug,] = createSignal('',);
    /** Once the author edits the slug we stop deriving it, or we'd clobber their choice. */
    const [slugTouched, setSlugTouched,] = createSignal(false,);
    const [content, setContent,] = createSignal('',);
    const [tags, setTags,] = createSignal('',);
    const [categories, setCategories,] = createSignal('',);
    const [parentId, setParentId,] = createSignal('',);
    const [viewRoles, setViewRoles,] = createSignal<string[]>([],);
    const [status, setStatus,] = createSignal<WikiPage['status']>('published',);
    const [saving, setSaving,] = createSignal(false,);
    const [confirmDelete, setConfirmDelete,] = createSignal(false,);
    const [deleting, setDeleting,] = createSignal(false,);

    createEffect(() => {
        const p = page();
        if (!p) return;
        setTitle(p.title,);
        setSlug(p.slug ?? '',);
        setSlugTouched(Boolean(p.slug,),);
        setContent(p.content ?? '',);
        setTags((p.tags ?? []).join(', ',),);
        setCategories((p.categories ?? []).join(', ',),);
        setParentId(p.parentId ?? '',);
        setViewRoles(p.viewRoles ?? [],);
        setStatus(p.status,);
    },);

    // Derive the slug from the title as they type, until they take it over.
    createEffect(() => {
        const t = title();
        if (!slugTouched() && t) setSlug(generateSlug(t,),);
    },);

    /** Candidate parents: every other page. The server rejects cycles too. */
    const parentOptions = () => (all() ?? []).filter((p,) => p.id !== params.id);

    /** Direct children, so the delete dialog can ask what happens to them. */
    const childCount = () => (all() ?? []).filter((p,) => p.parentId === params.id).length;

    const doDelete = async (mode: 'cascade' | 'orphan',) => {
        setDeleting(true,);
        try {
            const res = await cms.wiki.remove(params.id, mode,);
            toast.success(
                mode === 'cascade'
                    ? `Deleted ${res.deleted} page${res.deleted !== 1 ? 's' : ''}.`
                    : `Deleted. ${res.orphaned} child page${res.orphaned !== 1 ? 's' : ''} moved to the top level.`,
            );
            // The page this editor is showing no longer exists, so staying here
            // would render a dead record.
            navigate('/admin/wiki',);
        } catch (e: any) {
            toast.error(e?.message || 'Could not delete the page.',);
        } finally {
            setDeleting(false,);
            setConfirmDelete(false,);
        }
    };

    const toggleRole = (role: string,) =>
        setViewRoles((prev,) =>
            prev.includes(role,) ? prev.filter((r,) => r !== role) : [...prev, role,]);

    const save = async () => {
        setSaving(true,);
        try {
            await cms.wiki.update(params.id, {
                title: title().trim(),
                slug: slug().trim() || null,
                content: content(),
                tags: tags().split(',',).map((t,) => t.trim()).filter(Boolean,),
                categories: categories().split(',',).map((t,) => t.trim()).filter(Boolean,),
                parentId: parentId() || null,
                viewRoles: viewRoles(),
                status: status(),
            } as never,);
            toast.success('Page saved.',);
        } catch (e: any) {
            toast.error(e?.message || 'Could not save the page.',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="admin-wiki-editor admin-full-bleed">
            <Title>{title() || 'Wiki page'} - Admin</Title>

            <div class="admin-header">
                <h1>
                    <A href="/admin/wiki" class="admin-wiki-editor__back">Wiki</A>
                    <span class="admin-wiki-editor__sep">/</span>
                    {title() || 'Untitled'}
                </h1>
                <div class="admin-header__actions">
                    <button
                        type="button" class="ui-button ui-button--danger ui-button--sm"
                        onClick={() => setConfirmDelete(true,)}
                    >Delete</button>
                    <Show when={page()?.slug || page()?.id}>
                        <a
                            href={`/wiki/${page()?.slug || page()?.id}`}
                            target="_blank" rel="noopener"
                            class="ui-button ui-button--ghost ui-button--sm"
                        >View ↗</a>
                    </Show>
                    <button
                        type="button" class="ui-button ui-button--primary"
                        disabled={saving()}
                        onClick={save}
                    >{saving() ? 'Saving…' : 'Save'}</button>
                </div>
            </div>

            <Show when={page()} fallback={<p class="form-help-muted">Loading…</p>}>
                <CollapsiblePanel
                    title="Page properties"
                    subtitle={slug() ? `/wiki/${slug()}` : `/wiki/${params.id}`}
                    defaultOpen
                >
                    {/* 80/20 split: the identity fields (title, slug, taxonomy)
                        get the room, while placement and status are narrow
                        pickers that only need enough width to read. */}
                    <div class="wiki-props">
                        <div class="wiki-props__main">
                            <FormField label="Title" required>
                                <input
                                    type="text" value={title()}
                                    onInput={(e,) => setTitle(e.currentTarget.value,)}
                                />
                            </FormField>

                            <FormField
                                label="Slug"
                                hint="Optional. Left empty, the page is reachable by its id."
                            >
                                <input
                                    type="text" value={slug()} placeholder="auto from title"
                                    onInput={(e,) => { setSlug(e.currentTarget.value,); setSlugTouched(true,); }}
                                />
                            </FormField>

                            <div class="wiki-props__pair">
                                <FormField label="Tags" hint="Comma separated.">
                                    <input
                                        type="text" value={tags()} placeholder="setup, billing"
                                        onInput={(e,) => setTags(e.currentTarget.value,)}
                                    />
                                </FormField>

                                <FormField label="Categories" hint="Comma separated.">
                                    <input
                                        type="text" value={categories()} placeholder="Guides"
                                        onInput={(e,) => setCategories(e.currentTarget.value,)}
                                    />
                                </FormField>
                            </div>
                        </div>

                        <div class="wiki-props__side">
                            <FormField label="Parent page" hint="Makes this a child in the tree.">
                                <select value={parentId()} onChange={(e,) => setParentId(e.currentTarget.value,)}>
                                    <option value="">— None (top level) —</option>
                                    <For each={parentOptions()}>
                                        {(p,) => <option value={p.id}>{p.title}</option>}
                                    </For>
                                </select>
                            </FormField>

                            <FormField label="Status">
                                <select value={status()} onChange={(e,) => setStatus(e.currentTarget.value as never,)}>
                                    <option value="published">Published</option>
                                    <option value="draft">Draft</option>
                                    <option value="archived">Archived</option>
                                </select>
                            </FormField>
                        </div>
                    </div>

                    <div class="wiki-props__perms">
                        <div class="wiki-props__perms-label">Who can view this page</div>
                        <p class="form-help-muted">
                            No roles selected means <strong>everyone</strong>, including logged-out
                            visitors. Selecting roles restricts it — staff can always view.
                        </p>
                        <div class="wiki-props__roles">
                            <For each={VIEW_ROLES}>
                                {(role,) => (
                                    <button
                                        type="button"
                                        class={`permission-chip${
                                            viewRoles().includes(role,) ? ' permission-chip--on' : ''
                                        }`}
                                        onClick={() => toggleRole(role,)}
                                    >{role}</button>
                                )}
                            </For>
                            <Show when={viewRoles().length > 0}>
                                <button
                                    type="button"
                                    class="ui-button ui-button--ghost ui-button--sm"
                                    onClick={() => setViewRoles([],)}
                                >Make public</button>
                            </Show>
                        </div>
                    </div>
                </CollapsiblePanel>

                <div class="admin-wiki-editor__body">
                    <MarkdownEditor
                        value={content()}
                        onChange={setContent}
                        height="calc(100vh - 380px)"
                        placeholder="Write the page in markdown…"
                    />
                </div>
            </Show>

            {/* Same question the index asks: both answers are destructive in
                different ways, so neither is defaulted. */}
            <ModalShell
                open={confirmDelete()}
                size="sm"
                showClose
                dismissOnBackdrop={false}
                onClose={() => setConfirmDelete(false,)}
                ariaLabel="Delete wiki page"
                class="wiki-delete"
            >
                <div class="wiki-delete__body">
                    <h2>Delete “{title()}”?</h2>
                    <Show
                        when={childCount() > 0}
                        fallback={<p>This page will be permanently deleted.</p>}
                    >
                        <p>
                            This page has <strong>{childCount()}</strong> child
                            page{childCount() !== 1 ? 's' : ''}. What should happen to them?
                        </p>
                    </Show>
                    <div class="wiki-delete__actions">
                        <Show when={childCount() > 0}>
                            <button
                                type="button" class="ui-button ui-button--secondary ui-button--sm"
                                disabled={deleting()}
                                onClick={() => doDelete('orphan',)}
                            >Keep children (move to top level)</button>
                            <button
                                type="button" class="ui-button ui-button--danger ui-button--sm"
                                disabled={deleting()}
                                onClick={() => doDelete('cascade',)}
                            >Delete children too</button>
                        </Show>
                        <Show when={childCount() === 0}>
                            <button
                                type="button" class="ui-button ui-button--danger ui-button--sm"
                                disabled={deleting()}
                                onClick={() => doDelete('orphan',)}
                            >Delete</button>
                        </Show>
                        <button
                            type="button" class="ui-button ui-button--ghost ui-button--sm"
                            onClick={() => setConfirmDelete(false,)}
                        >Cancel</button>
                    </div>
                </div>
            </ModalShell>
        </div>
    );
};

export default WikiEditor;
