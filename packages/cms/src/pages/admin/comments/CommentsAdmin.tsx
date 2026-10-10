/**
 * Comments → the moderation queue for comments on posts and events (forum
 * posts are moderated in the Forum section). Tabs: Needs review (pending +
 * reported) · Pending · Reported · Hidden · All. `?target=post:<id>` narrows
 * to one item (linked from the post editor / event modal).
 */
import { A, useSearchParams, } from '@solidjs/router';
import type { DiscussionsModerationAction, DiscussionsModerationQuery, ModerationItem, } from '@sitesurge/types';
import { Component, createEffect, createResource, createSignal, For, on, onCleanup, Show, } from 'solid-js';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import ModalShell from '../../../components/admin/common/ModalShell';
import Pagination from '../../../components/admin/common/Pagination';
import { useToast, } from '../../../components/common/toast';
import AuthorCard from '../../../components/discussions/AuthorCard';
import { Checkbox, } from '../../../components/ui/Checkbox';
import { cms, } from '../../../services/cmsClient';
import './CommentsAdmin.scss';

type Tab = NonNullable<DiscussionsModerationQuery['status']>;

const TABS: { key: Tab; label: string; }[] = [
    { key: 'queue', label: 'Needs review', },
    { key: 'pending', label: 'Pending', },
    { key: 'reported', label: 'Reported', },
    { key: 'hidden', label: 'Hidden', },
    { key: 'all', label: 'All', },
];

const LIMIT = 25;

const STATUS_LABEL: Record<string, string> = { visible: 'Visible', pending: 'Pending', hidden: 'Hidden', deleted: 'Deleted', };

const CommentsAdmin: Component = () => {
    const toast = useToast();
    const [params, setParams,] = useSearchParams<{ status?: string; target?: string; q?: string; page?: string; scope?: string; authorId?: string; }>();
    /** `forum` = forum threads/replies (the Forum admin links here), else comments on posts/events. */
    const scope = (): 'comments' | 'forum' => (params.scope === 'forum' ? 'forum' : 'comments');
    const isForum = () => scope() === 'forum';
    const tab = (): Tab => (TABS.some((t,) => t.key === params.status,) ? params.status as Tab : 'queue');
    const page = () => Math.max(1, Number(params.page ?? 1,) || 1,);
    const [search, setSearch,] = createSignal(params.q ?? '',);
    const [selected, setSelected,] = createSignal<Set<string>>(new Set(),);
    const [history, setHistory,] = createSignal<{ item: ModerationItem; rows: { body: string; editedAt: string; }[]; } | null>(null,);

    const query = () => ({
        status: tab(), scope: scope(), target: params.target as never, authorId: params.authorId || undefined, search: params.q || undefined, page: page(), limit: LIMIT,
    });
    const [list, { refetch, },] = createResource(query, async (q,) => {
        try {
            return await cms.discussions.moderation.list(q,);
        } catch (e) {
            toast.error(`Could not load comments: ${(e as Error).message}`,);
            return { data: [] as ModerationItem[], meta: { page: 1, limit: LIMIT, total: 0, totalPages: 1, }, };
        }
    },);
    const [counts, { refetch: refetchCounts, },] = createResource(scope, (s,) => cms.discussions.moderation.counts(s,).catch(() => null),);

    // Search-as-you-type box (the one deliberate exception to commit-on-blur).
    let timer: ReturnType<typeof setTimeout> | undefined;
    createEffect(on(search, (v,) => {
        clearTimeout(timer,);
        timer = setTimeout(() => setParams({ q: v || undefined, page: undefined, },), 300,);
    }, { defer: true, },),);
    onCleanup(() => clearTimeout(timer,));
    createEffect(on(query, () => setSelected(new Set<string>(),), { defer: true, },),);

    const items = () => list()?.data ?? [];
    const toggle = (id: string,) => {
        const next = new Set(selected(),);
        if (next.has(id,)) next.delete(id,); else next.add(id,);
        setSelected(next,);
    };
    const allSelected = () => items().length > 0 && items().every((i,) => selected().has(i.id,));
    const toggleAll = () => setSelected(allSelected() ? new Set<string>() : new Set(items().map((i,) => i.id),),);

    const done = () => { void refetch(); void refetchCounts(); };

    const act = async (item: ModerationItem, action: DiscussionsModerationAction,) => {
        if (action === 'delete' && !window.confirm('Delete this comment?',)) return;
        try {
            await cms.discussions.moderation.act(item.id, action,);
            done();
        } catch (e) {
            toast.error((e as Error).message,);
        }
    };

    const bulk = async (action: DiscussionsModerationAction,) => {
        const ids = [...selected(),];
        if (!ids.length) return;
        if (action === 'delete' && !window.confirm(`Delete ${ids.length} comment(s)?`,)) return;
        try {
            const r = await cms.discussions.moderation.bulk(ids, action,);
            toast.success(`${r.updated} updated`,);
            setSelected(new Set<string>(),);
            done();
        } catch (e) {
            toast.error((e as Error).message,);
        }
    };

    const openHistory = async (item: ModerationItem,) => {
        try {
            const rows = await cms.discussions.history(item.id,);
            setHistory({ item, rows, },);
        } catch (e) {
            toast.error((e as Error).message,);
        }
    };

    const badge = (key: Tab,) => {
        const c = counts();
        if (!c) return 0;
        return key === 'pending' ? c.pending : key === 'reported' ? c.reported : key === 'queue' ? c.pending + c.reported : 0;
    };

    return (
        <div class="comments-admin">
            <AdminTitle>{isForum() ? 'Forum moderation' : 'Comments'}</AdminTitle>
            <div class="admin-header">
                <Show when={isForum()}><A href="/admin/forum" class="admin-header__back">← Forum</A></Show>
                <h1>{isForum() ? 'Forum moderation' : 'Comments'}</h1>
                <div class="admin-header__actions">
                    <Show when={params.authorId}>
                        <button type="button" class="ui-button ui-button--secondary" onClick={() => setParams({ authorId: undefined, page: undefined, },)}>
                            Clear author filter
                        </button>
                    </Show>
                    <A href={isForum() ? '/admin/forum/settings' : '/admin/comments/settings'} class="ui-button ui-button--secondary">Settings</A>
                </div>
            </div>

            <div class="settings-tabs">
                <For each={TABS}>
                    {(t,) => (
                        <button
                            class={`settings-tabs__tab ${tab() === t.key ? 'settings-tabs__tab--active' : ''}`}
                            onClick={() => setParams({ status: t.key === 'queue' ? undefined : t.key, page: undefined, },)}
                        >
                            {t.label}
                            <Show when={badge(t.key,) > 0}>
                                <span class="comments-admin__badge">{badge(t.key,)}</span>
                            </Show>
                        </button>
                    )}
                </For>
            </div>

            <div class="comments-admin__toolbar">
                <input
                    type="search"
                    class="comments-admin__search"
                    placeholder="Search comment text or author…"
                    value={search()}
                    onInput={(e,) => setSearch(e.currentTarget.value,)}
                />
                <Show when={params.target}>
                    <span class="comments-admin__filter">
                        One item only
                        <button type="button" onClick={() => setParams({ target: undefined, page: undefined, },)} aria-label="Show all items">×</button>
                    </span>
                </Show>
                <Show when={selected().size > 0}>
                    <div class="comments-admin__bulk">
                        <span>{selected().size} selected</span>
                        <button class="ui-button ui-button--sm ui-button--secondary" onClick={() => void bulk('approve',)}>Approve</button>
                        <button class="ui-button ui-button--sm ui-button--secondary" onClick={() => void bulk('hide',)}>Hide</button>
                        <button class="ui-button ui-button--sm ui-button--danger" onClick={() => void bulk('delete',)}>Delete</button>
                    </div>
                </Show>
            </div>

            <Show when={!list.loading || list.latest} fallback={<div class="empty-state">Loading…</div>}>
                <Show when={items().length > 0} fallback={<div class="empty-state">Nothing here.</div>}>
                    <div class="comments-admin__select-all">
                        <Checkbox checked={allSelected()} onChange={toggleAll} label={<span>Select all on this page</span>} />
                    </div>
                    <ul class="comments-admin__list">
                        <For each={items()}>
                            {(item,) => (
                                <li class={`comments-admin__item comments-admin__item--${item.status}`}>
                                    <div class="comments-admin__check">
                                        <Checkbox checked={selected().has(item.id,)} onChange={() => toggle(item.id,)} />
                                    </div>
                                    <div class="comments-admin__main">
                                        <div class="comments-admin__meta">
                                            <AuthorCard author={item.author} compact />
                                            <Show when={item.guestEmail || item.guestIp}>
                                                <span class="comments-admin__guest">
                                                    {[item.guestEmail, item.guestIp,].filter(Boolean,).join(' · ',)}
                                                </span>
                                            </Show>
                                            <span class={`comments-admin__status comments-admin__status--${item.status}`}>{STATUS_LABEL[item.status] ?? item.status}</span>
                                            <span class="comments-admin__time">{new Date(item.createdAt,).toLocaleString()}</span>
                                        </div>
                                        <Show when={item.target}>
                                            {(t,) => (
                                                <div class="comments-admin__target">
                                                    on <a href={`${t().url}#comment-${item.id}`} target="_blank" rel="noopener">{t().title}</a>
                                                    {' · '}
                                                    <A href={`/admin/comments?target=${t().type}:${t().id}&status=all`}>all comments here</A>
                                                </div>
                                            )}
                                        </Show>
                                        <div class="comments-admin__body rich-text" innerHTML={item.bodyHtml ?? ''} />
                                        <Show when={item.reportCount > 0}>
                                            <ul class="comments-admin__reports">
                                                <For each={item.reports}>
                                                    {(r,) => (
                                                        <li>
                                                            <strong>Reported</strong> by {r.reporterName ?? 'a member'}
                                                            {r.reason ? `: “${r.reason}”` : ''} <span class="comments-admin__time">{new Date(r.createdAt,).toLocaleDateString()}</span>
                                                        </li>
                                                    )}
                                                </For>
                                            </ul>
                                        </Show>
                                        <div class="comments-admin__actions">
                                            <Show when={item.status === 'pending' || item.status === 'hidden'}>
                                                <button class="ui-button ui-button--sm ui-button--primary" onClick={() => void act(item, 'approve',)}>Approve</button>
                                            </Show>
                                            <Show when={item.status === 'visible'}>
                                                <button class="ui-button ui-button--sm ui-button--secondary" onClick={() => void act(item, 'hide',)}>Hide</button>
                                            </Show>
                                            <Show when={item.status === 'deleted'}>
                                                <button class="ui-button ui-button--sm ui-button--secondary" onClick={() => void act(item, 'restore',)}>Restore</button>
                                            </Show>
                                            <Show when={item.reportCount > 0}>
                                                <button class="ui-button ui-button--sm ui-button--secondary" onClick={() => void act(item, 'dismiss_reports',)}>Dismiss reports</button>
                                            </Show>
                                            <Show when={item.status !== 'deleted'}>
                                                <button class="ui-button ui-button--sm ui-button--danger" onClick={() => void act(item, 'delete',)}>Delete</button>
                                            </Show>
                                            <Show when={item.editCount > 0}>
                                                <button class="ui-button ui-button--sm ui-button--ghost" onClick={() => void openHistory(item,)}>
                                                    Edit history ({item.editCount})
                                                </button>
                                            </Show>
                                        </div>
                                    </div>
                                </li>
                            )}
                        </For>
                    </ul>
                    <Pagination
                        page={page()}
                        totalPages={list()?.meta?.totalPages ?? 1}
                        total={list()?.meta?.total}
                        limit={LIMIT}
                        onPageChange={(p,) => setParams({ page: p > 1 ? String(p,) : undefined, },)}
                    />
                </Show>
            </Show>

            <ModalShell open={history() !== null} onClose={() => setHistory(null,)} size="md" showClose ariaLabel="Edit history">
                <div class="comments-admin__history">
                    <h2>Edit history</h2>
                    <p class="form-help-muted">Earlier versions, newest first. The current text is in the queue.</p>
                    <For each={history()?.rows ?? []} fallback={<p>No earlier versions.</p>}>
                        {(r,) => (
                            <div class="comments-admin__version">
                                <div class="comments-admin__time">{new Date(r.editedAt,).toLocaleString()}</div>
                                <pre>{r.body}</pre>
                            </div>
                        )}
                    </For>
                </div>
            </ModalShell>
        </div>
    );
};

export default CommentsAdmin;
