/**
 * Admin wiki — a tree of pages with inline add/edit/delete.
 *
 * A tree rather than a flat table because the hierarchy IS the wiki's
 * structure; a table would hide the one relationship that matters and make
 * "where does this page live" unanswerable at a glance.
 */
import { Title, } from '@solidjs/meta';
import { A, useNavigate, } from '@solidjs/router';
import { Component, createMemo, createResource, createSignal, For, Show, } from 'solid-js';
import type { WikiPage, WikiPageNode, } from '@sitesurge/types';
import { buildWikiTree, } from '@sitesurge/types';
import { cms, } from '../../services/cmsClient';
import { useToast, } from '../../components/common/toast';
import ModalShell from '../../components/admin/common/ModalShell';
import './Wiki.scss';

const AdminWiki: Component = () => {
    const navigate = useNavigate();
    const toast = useToast();

    const [pages, { refetch, },] = createResource(async () => {
        try {
            return await cms.wiki.list(true,);
        } catch {
            return [] as WikiPage[];
        }
    },);

    const tree = createMemo(() => buildWikiTree(pages() ?? [],),);

    /** Expanded node ids. Roots start expanded so the wiki isn't a wall of collapsed rows. */
    const [expanded, setExpanded,] = createSignal<Set<string>>(new Set(),);
    const toggle = (id: string,) =>
        setExpanded((prev,) => {
            const next = new Set(prev,);
            next.has(id,) ? next.delete(id,) : next.add(id,);
            return next;
        },);

    const [pendingDelete, setPendingDelete,] = createSignal<WikiPageNode | null>(null,);
    const [creating, setCreating,] = createSignal<{ parentId: string | null; } | null>(null,);
    const [newTitle, setNewTitle,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);

    const createPage = async () => {
        const target = creating();
        if (!target || !newTitle().trim()) return;
        setBusy(true,);
        try {
            const page = await cms.wiki.create({
                title: newTitle().trim(),
                parentId: target.parentId,
            } as never,);
            setCreating(null,); setNewTitle('',);
            await refetch();
            navigate(`/admin/wiki/${page.id}`,);
        } catch (e: any) {
            toast.error(e?.message || 'Could not create the page.',);
        } finally {
            setBusy(false,);
        }
    };

    /** `cascade` removes the subtree; `orphan` promotes children to roots. */
    const doDelete = async (mode: 'cascade' | 'orphan',) => {
        const target = pendingDelete();
        if (!target) return;
        setBusy(true,);
        try {
            const res = await cms.wiki.remove(target.id, mode,);
            toast.success(
                mode === 'cascade'
                    ? `Deleted ${res.deleted} page${res.deleted !== 1 ? 's' : ''}.`
                    : `Deleted. ${res.orphaned} child page${res.orphaned !== 1 ? 's' : ''} moved to the top level.`,
            );
            setPendingDelete(null,);
            await refetch();
        } catch (e: any) {
            toast.error(e?.message || 'Could not delete the page.',);
        } finally {
            setBusy(false,);
        }
    };

    const Row: Component<{ node: WikiPageNode; depth: number; }> = (p,) => {
        const hasChildren = () => p.node.children.length > 0;
        const isOpen = () => expanded().has(p.node.id,) || p.depth === 0;
        return (
            <>
                <div class="wiki-row" style={{ 'padding-left': `${p.depth * 22}px`, }}>
                    <button
                        type="button"
                        class="wiki-row__chev"
                        onClick={() => toggle(p.node.id,)}
                        // Only meaningful when there is something to reveal, but
                        // kept in the layout so titles stay aligned.
                        disabled={!hasChildren()}
                        aria-label={hasChildren() ? 'Expand' : undefined}
                    >
                        {hasChildren() ? (isOpen() ? '▾' : '▸') : '·'}
                    </button>

                    <A href={`/admin/wiki/${p.node.id}`} class="wiki-row__title">
                        {p.node.title}
                    </A>

                    <Show when={hasChildren()}>
                        <span class="wiki-row__count">{p.node.children.length}</span>
                    </Show>

                    <Show when={p.node.status !== 'published'}>
                        <span class="badge badge--muted">{p.node.status}</span>
                    </Show>

                    <Show when={p.node.viewRoles.length > 0}>
                        <span class="badge badge--info" title={`Visible to: ${p.node.viewRoles.join(', ',)}`}>
                            restricted
                        </span>
                    </Show>

                    <span class="wiki-row__spacer" />

                    <span class="wiki-row__date">
                        {new Date(p.node.updatedAt,).toLocaleDateString()}
                    </span>

                    <div class="wiki-row__actions">
                        <button
                            type="button" class="ui-button ui-button--ghost ui-button--sm"
                            onClick={() => { setCreating({ parentId: p.node.id, },); setNewTitle('',); }}
                        >+ Child</button>
                        <A href={`/admin/wiki/${p.node.id}`} class="ui-button ui-button--secondary ui-button--sm">
                            Edit
                        </A>
                        <button
                            type="button" class="ui-button ui-button--danger ui-button--sm"
                            onClick={() => setPendingDelete(p.node,)}
                        >Delete</button>
                    </div>
                </div>

                <Show when={isOpen()}>
                    <For each={p.node.children}>
                        {(child,) => <Row node={child} depth={p.depth + 1} />}
                    </For>
                </Show>
            </>
        );
    };

    return (
        <div class="admin-wiki">
            <Title>Wiki - Admin</Title>
            <div class="admin-header">
                <h1>Wiki</h1>
                <div class="admin-header__actions">
                    <a href="/wiki" target="_blank" rel="noopener" class="ui-button ui-button--ghost ui-button--sm">
                        View public wiki ↗
                    </a>
                    <button
                        type="button" class="ui-button ui-button--primary"
                        onClick={() => { setCreating({ parentId: null, },); setNewTitle('',); }}
                    >+ New page</button>
                </div>
            </div>

            <Show when={!pages.loading} fallback={<p class="form-help-muted">Loading…</p>}>
                <Show
                    when={tree().length > 0}
                    fallback={
                        <div class="empty-state">
                            No wiki pages yet. Create the first one to get started.
                        </div>
                    }
                >
                    <div class="wiki-tree">
                        <For each={tree()}>{(node,) => <Row node={node} depth={0} />}</For>
                    </div>
                </Show>
            </Show>

            {/* Create */}
            <ModalShell
                open={creating() !== null}
                size="sm"
                showClose
                dismissOnBackdrop={false}
                onClose={() => setCreating(null,)}
                ariaLabel="New wiki page"
                class="wiki-new"
            >
                <div class="wiki-new__body">
                    <h2>{creating()?.parentId ? 'New child page' : 'New wiki page'}</h2>
                    <input
                        type="text"
                        placeholder="Page title"
                        value={newTitle()}
                        onInput={(e,) => setNewTitle(e.currentTarget.value,)}
                        onKeyDown={(e,) => { if (e.key === 'Enter') void createPage(); }}
                    />
                    <div class="wiki-new__actions">
                        <button
                            type="button" class="ui-button ui-button--primary ui-button--sm"
                            disabled={!newTitle().trim() || busy()}
                            onClick={createPage}
                        >{busy() ? 'Creating…' : 'Create & edit'}</button>
                        <button
                            type="button" class="ui-button ui-button--ghost ui-button--sm"
                            onClick={() => setCreating(null,)}
                        >Cancel</button>
                    </div>
                </div>
            </ModalShell>

            {/* Delete — the child question is asked explicitly, because both
                answers are destructive in different ways. */}
            <ModalShell
                open={pendingDelete() !== null}
                size="sm"
                showClose
                dismissOnBackdrop={false}
                onClose={() => setPendingDelete(null,)}
                ariaLabel="Delete wiki page"
                class="wiki-delete"
            >
                <div class="wiki-delete__body">
                    <h2>Delete “{pendingDelete()?.title}”?</h2>
                    <Show
                        when={(pendingDelete()?.children.length ?? 0) > 0}
                        fallback={<p>This page will be permanently deleted.</p>}
                    >
                        <p>
                            This page has <strong>{pendingDelete()!.children.length}</strong>{' '}
                            child page{pendingDelete()!.children.length !== 1 ? 's' : ''}. What should
                            happen to them?
                        </p>
                    </Show>
                    <div class="wiki-delete__actions">
                        <Show when={(pendingDelete()?.children.length ?? 0) > 0}>
                            <button
                                type="button" class="ui-button ui-button--secondary ui-button--sm"
                                disabled={busy()}
                                onClick={() => doDelete('orphan',)}
                            >Keep children (move to top level)</button>
                            <button
                                type="button" class="ui-button ui-button--danger ui-button--sm"
                                disabled={busy()}
                                onClick={() => doDelete('cascade',)}
                            >Delete children too</button>
                        </Show>
                        <Show when={(pendingDelete()?.children.length ?? 0) === 0}>
                            <button
                                type="button" class="ui-button ui-button--danger ui-button--sm"
                                disabled={busy()}
                                onClick={() => doDelete('orphan',)}
                            >Delete</button>
                        </Show>
                        <button
                            type="button" class="ui-button ui-button--ghost ui-button--sm"
                            onClick={() => setPendingDelete(null,)}
                        >Cancel</button>
                    </div>
                </div>
            </ModalShell>
        </div>
    );
};

export default AdminWiki;
