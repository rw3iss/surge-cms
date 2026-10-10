/**
 * /admin/forum — every forum thread: filter, pin, lock, move, hide, restore,
 * delete. Categories and Settings are their own pages (header buttons);
 * pending/reported posts are moderated in the shared queue (Moderation).
 */
import type { ForumCategory, ForumThread, ForumThreadAction, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import ConfirmModal from '../../../components/admin/common/ConfirmModal';
import { DataTable, } from '../../../components/admin/common/DataTable';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import './ForumAdmin.scss';

const STATUSES = [
    { value: '', label: 'All (not deleted)', },
    { value: 'visible', label: 'Visible', },
    { value: 'pending', label: 'Pending', },
    { value: 'hidden', label: 'Hidden', },
    { value: 'deleted', label: 'Deleted', },
] as const;

const ForumAdmin: Component = () => {
    const toast = useToast();
    const [status, setStatus,] = createSignal('',);
    const [category, setCategory,] = createSignal('',);
    // Search-as-you-type box: commits per keystroke on purpose (debounced fetch).
    const [search, setSearch,] = createSignal('',);
    const [page, setPage,] = createSignal(1,);
    const [busy, setBusy,] = createSignal<string | null>(null,);
    const [confirmDelete, setConfirmDelete,] = createSignal<ForumThread | null>(null,);

    const [categories,] = createResource(() => cms.forum.categories.list().catch(() => [] as ForumCategory[]),);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const [term, setTerm,] = createSignal('',);
    const onSearch = (v: string,) => {
        setSearch(v,);
        clearTimeout(timer,);
        timer = setTimeout(() => { setTerm(v,); setPage(1,); }, 300,);
    };

    const [threads, { refetch, },] = createResource(
        () => ({ status: status(), category: category(), search: term(), page: page(), }),
        async (q,) => cms.forum.threads.adminList({
            status: (q.status || undefined) as never, category: q.category || undefined, search: q.search || undefined, page: q.page, limit: 25,
        },),
    );

    const act = async (t: ForumThread, action: ForumThreadAction,) => {
        setBusy(t.id,);
        try {
            await cms.forum.threads.act(t.id, action,);
            refetch();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Action failed',);
        } finally {
            setBusy(null,);
        }
    };

    const move = async (t: ForumThread, categoryId: string,) => {
        if (!categoryId || categoryId === t.categoryId) return;
        setBusy(t.id,);
        try {
            await cms.forum.threads.update(t.id, { categoryId, },);
            toast.success('Thread moved',);
            refetch();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not move the thread',);
        } finally {
            setBusy(null,);
        }
    };

    const date = (iso: string | null,) => (iso ? new Date(iso,).toLocaleString() : '—');

    return (
        <div class="admin-forum">
            <AdminTitle>Forum</AdminTitle>
            <div class="admin-header">
                <h1>Forum</h1>
                <div class="admin-header__actions">
                    <A href="/admin/comments?scope=forum" class="ui-button ui-button--secondary">Moderation</A>
                    <A href="/admin/forum/categories" class="ui-button ui-button--secondary">Categories</A>
                    <A href="/admin/forum/settings" class="ui-button ui-button--secondary">Settings</A>
                    <a href="/forum" target="_blank" rel="noopener" class="ui-button ui-button--secondary">View forum ↗</a>
                </div>
            </div>

            <div class="admin-forum__filters">
                <input
                    type="search"
                    placeholder="Search titles or authors…"
                    value={search()}
                    onInput={(e,) => onSearch(e.currentTarget.value,)}
                />
                <select value={status()} onChange={(e,) => { setStatus(e.currentTarget.value,); setPage(1,); }} aria-label="Status">
                    <For each={STATUSES}>{(s,) => <option value={s.value}>{s.label}</option>}</For>
                </select>
                <select value={category()} onChange={(e,) => { setCategory(e.currentTarget.value,); setPage(1,); }} aria-label="Category">
                    <option value="">All categories</option>
                    <For each={categories() ?? []}>{(c,) => <option value={c.slug}>{c.name}</option>}</For>
                </select>
            </div>

            <DataTable<ForumThread>
                items={threads.latest?.data ?? []}
                loading={threads.loading && !threads.latest}
                emptyMessage="No threads yet."
                pagination={threads.latest
                    ? { page: page(), totalPages: threads.latest.meta.totalPages ?? 1, total: threads.latest.meta.total, onPageChange: setPage, }
                    : undefined}
                columns={[
                    {
                        header: 'Thread',
                        cell: (t,) => (
                            <div class="admin-forum__title">
                                <span>
                                    <a href={t.url} target="_blank" rel="noopener">{t.title}</a>
                                    <span class="admin-forum__flags">
                                        <Show when={t.pinned}><span title="Pinned">📌</span></Show>
                                        <Show when={t.locked}><span title="Locked">🔒</span></Show>
                                    </span>
                                </span>
                                <small>{t.category.name} · by {t.author.name}</small>
                            </div>
                        ),
                    },
                    {
                        header: 'Status',
                        cell: (t,) => <span class={`admin-forum__status admin-forum__status--${t.status}`}>{t.status}</span>,
                    },
                    { header: 'Replies', cell: (t,) => t.replyCount, align: 'right', },
                    { header: 'Views', cell: (t,) => t.viewCount, align: 'right', },
                    { header: 'Last activity', cell: (t,) => date(t.lastReplyAt ?? t.createdAt,), },
                    {
                        header: '',
                        align: 'right',
                        cell: (t,) => (
                            <div class="admin-forum__actions">
                                <Show when={t.status === 'pending'}>
                                    <button type="button" class="ui-button ui-button--sm ui-button--primary" disabled={busy() === t.id} onClick={() => act(t, 'approve',)}>Approve</button>
                                </Show>
                                <button type="button" class="ui-button ui-button--sm ui-button--secondary" disabled={busy() === t.id} onClick={() => act(t, t.pinned ? 'unpin' : 'pin',)}>
                                    {t.pinned ? 'Unpin' : 'Pin'}
                                </button>
                                <button type="button" class="ui-button ui-button--sm ui-button--secondary" disabled={busy() === t.id} onClick={() => act(t, t.locked ? 'unlock' : 'lock',)}>
                                    {t.locked ? 'Unlock' : 'Lock'}
                                </button>
                                <select
                                    aria-label="Move to category"
                                    value=""
                                    disabled={busy() === t.id}
                                    onChange={(e,) => { void move(t, e.currentTarget.value,); e.currentTarget.value = ''; }}
                                >
                                    <option value="">Move to…</option>
                                    <For each={(categories() ?? []).filter((c,) => c.id !== t.categoryId)}>
                                        {(c,) => <option value={c.id}>{c.name}</option>}
                                    </For>
                                </select>
                                <Show
                                    when={t.status === 'visible' || t.status === 'pending'}
                                    fallback={<button type="button" class="ui-button ui-button--sm ui-button--secondary" disabled={busy() === t.id} onClick={() => act(t, 'restore',)}>Restore</button>}
                                >
                                    <button type="button" class="ui-button ui-button--sm ui-button--secondary" disabled={busy() === t.id} onClick={() => act(t, 'hide',)}>Hide</button>
                                </Show>
                                <Show when={t.status !== 'deleted'}>
                                    <button type="button" class="ui-button ui-button--sm ui-button--danger" disabled={busy() === t.id} onClick={() => setConfirmDelete(t,)}>Delete</button>
                                </Show>
                            </div>
                        ),
                    },
                ]}
            />

            <ConfirmModal
                open={Boolean(confirmDelete(),)}
                title="Delete thread?"
                message={`“${confirmDelete()?.title ?? ''}” and its replies will no longer show. You can restore it from the Deleted filter.`}
                confirmLabel="Delete"
                danger
                loading={busy() === confirmDelete()?.id}
                onCancel={() => setConfirmDelete(null,)}
                onConfirm={async () => {
                    const t = confirmDelete();
                    if (t) await act(t, 'delete',);
                    setConfirmDelete(null,);
                }}
            />
        </div>
    );
};

export default ForumAdmin;
