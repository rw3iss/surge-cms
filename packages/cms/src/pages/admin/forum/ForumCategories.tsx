/**
 * /admin/forum/categories — create, edit, order and lock forum categories,
 * each with an optional minimum subscription tier to read / to post.
 */
import type { ForumCategory, ForumCategoryBody, SubscriptionTierOption, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import ConfirmModal from '../../../components/admin/common/ConfirmModal';
import ModalShell from '../../../components/admin/common/ModalShell';
import Toggle from '../../../components/admin/common/Toggle';
import { FormField, } from '../../../components/admin/forms';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import './ForumAdmin.scss';

/** A tier picker value: '' = the forum default (null), else the tier rank. */
const rankValue = (v: number | null | undefined,) => (v === null || v === undefined ? '' : String(v,));

const TierSelect: Component<{ value: number | null; onChange: (v: number | null,) => void; tiers: SubscriptionTierOption[]; defaultLabel: string; }> = (p,) => (
    <select value={rankValue(p.value,)} onChange={(e,) => p.onChange(e.currentTarget.value === '' ? null : Number(e.currentTarget.value,),)}>
        <option value="">{p.defaultLabel}</option>
        <For each={p.tiers}>{(t,) => <option value={t.sortOrder}>{t.name} or higher</option>}</For>
    </select>
);

const empty = (): ForumCategoryBody => ({ name: '', slug: '', description: '', readMinRank: null, postMinRank: null, locked: false, });

const ForumCategories: Component = () => {
    const toast = useToast();
    const [cats, { refetch, mutate, },] = createResource(() => cms.forum.categories.list(),);
    const [tiers,] = createResource(() => cms.subscriptionTiers.options().catch(() => [] as SubscriptionTierOption[]),);
    const [editing, setEditing,] = createSignal<{ id: string | null; body: ForumCategoryBody; } | null>(null,);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [confirm, setConfirm,] = createSignal<ForumCategory | null>(null,);

    const patch = (p: Partial<ForumCategoryBody>,) => setEditing((e,) => (e ? { ...e, body: { ...e.body, ...p, }, } : e));

    const save = async () => {
        const e = editing();
        if (!e) return;
        setSaving(true,);
        setError('',);
        try {
            const body = { ...e.body, slug: e.body.slug?.trim() || undefined, };
            if (e.id) await cms.forum.categories.update(e.id, body,);
            else await cms.forum.categories.create(body,);
            setEditing(null,);
            toast.success('Category saved',);
            refetch();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the category.',);
        } finally {
            setSaving(false,);
        }
    };

    const move = async (index: number, dir: -1 | 1,) => {
        const list = [...(cats() ?? []),];
        const j = index + dir;
        if (j < 0 || j >= list.length) return;
        [list[index], list[j],] = [list[j], list[index],];
        mutate(list,);
        try {
            await cms.forum.categories.reorder(list.map((c,) => c.id),);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not reorder',);
            refetch();
        }
    };

    const remove = async () => {
        const c = confirm();
        if (!c) return;
        try {
            await cms.forum.categories.remove(c.id,);
            toast.success('Category deleted',);
            refetch();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not delete the category',);
        } finally {
            setConfirm(null,);
        }
    };

    const tierName = (rank: number | null,) => {
        if (rank === null) return null;
        return (tiers() ?? []).find((t,) => t.sortOrder === rank,)?.name ?? `rank ${rank}`;
    };

    return (
        <div class="admin-forum">
            <AdminTitle>Forum Categories</AdminTitle>
            <div class="admin-header">
                <A href="/admin/forum" class="admin-header__back">← Forum</A>
                <h1>Forum Categories</h1>
                <div class="admin-header__actions">
                    <button type="button" class="ui-button ui-button--primary" onClick={() => { setError('',); setEditing({ id: null, body: empty(), },); }}>
                        New category
                    </button>
                </div>
            </div>

            <Show when={!cats.loading} fallback={<p>Loading…</p>}>
                <div class="admin-forum__categories">
                    <For each={cats() ?? []} fallback={<p>No categories yet.</p>}>
                        {(c, i,) => (
                            <div class="admin-forum__category">
                                <div class="admin-forum__order">
                                    <button type="button" class="ui-button ui-button--sm ui-button--ghost" aria-label="Move up" disabled={i() === 0} onClick={() => move(i(), -1,)}>▲</button>
                                    <button type="button" class="ui-button ui-button--sm ui-button--ghost" aria-label="Move down" disabled={i() === (cats()?.length ?? 0) - 1} onClick={() => move(i(), 1,)}>▼</button>
                                </div>
                                <div>
                                    <h3>{c.name} <Show when={c.locked}><span title="Locked">🔒</span></Show></h3>
                                    <Show when={c.description}><p>{c.description}</p></Show>
                                    <div class="admin-forum__meta">
                                        /forum/{c.slug} · {c.threadCount} threads · {c.postCount} posts
                                        <Show when={tierName(c.readMinRank,)}>{(n,) => <> · read: {n()}+</>}</Show>
                                        <Show when={tierName(c.postMinRank,)}>{(n,) => <> · post: {n()}+</>}</Show>
                                    </div>
                                </div>
                                <div class="admin-forum__actions">
                                    <button
                                        type="button"
                                        class="ui-button ui-button--sm ui-button--secondary"
                                        onClick={() => {
                                            setError('',);
                                            setEditing({
                                                id: c.id,
                                                body: {
                                                    name: c.name, slug: c.slug, description: c.description ?? '',
                                                    readMinRank: c.readMinRank, postMinRank: c.postMinRank, locked: c.locked,
                                                },
                                            },);
                                        }}
                                    >
                                        Edit
                                    </button>
                                    <button type="button" class="ui-button ui-button--sm ui-button--danger" onClick={() => setConfirm(c,)}>Delete</button>
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </Show>

            <ModalShell open={Boolean(editing(),)} onClose={() => setEditing(null,)} size="md" ariaLabel="Edit category">
                <Show when={editing()}>
                    {(e,) => (
                        <div class="admin-forum__form">
                            <h2>{e().id ? 'Edit category' : 'New category'}</h2>
                            <Show when={error()}><div class="alert alert--error">{error()}</div></Show>
                            <FormField label="Name" required>
                                <input type="text" value={e().body.name} onChange={(ev,) => patch({ name: ev.currentTarget.value, },)} />
                            </FormField>
                            <FormField label="Slug" hint="The URL part: /forum/<slug>. Leave empty to derive it from the name.">
                                <input type="text" value={e().body.slug ?? ''} onChange={(ev,) => patch({ slug: ev.currentTarget.value, },)} />
                            </FormField>
                            <FormField label="Description">
                                <textarea rows={3} value={e().body.description ?? ''} onChange={(ev,) => patch({ description: ev.currentTarget.value, },)} />
                            </FormField>
                            <FormField label="Who can read" hint="On top of the forum-wide rule in Settings.">
                                <TierSelect value={e().body.readMinRank ?? null} onChange={(v,) => patch({ readMinRank: v, },)} tiers={tiers() ?? []} defaultLabel="Forum default" />
                            </FormField>
                            <FormField label="Who can post" hint="Start threads and reply here.">
                                <TierSelect value={e().body.postMinRank ?? null} onChange={(v,) => patch({ postMinRank: v, },)} tiers={tiers() ?? []} defaultLabel="Forum default" />
                            </FormField>
                            <Toggle checked={Boolean(e().body.locked,)} onChange={(v,) => patch({ locked: v, },)} label="Locked (readable, no new threads or replies)" />
                            <div class="admin-forum__form-actions">
                                <button type="button" class="ui-button ui-button--secondary" onClick={() => setEditing(null,)}>Cancel</button>
                                <button type="button" class="ui-button ui-button--primary" disabled={saving() || !e().body.name.trim()} onClick={save}>
                                    {saving() ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </div>
                    )}
                </Show>
            </ModalShell>

            <ConfirmModal
                open={Boolean(confirm(),)}
                title="Delete category?"
                message="Only an empty category can be deleted — move or delete its threads first."
                confirmLabel="Delete"
                danger
                onCancel={() => setConfirm(null,)}
                onConfirm={remove}
            />
        </div>
    );
};

export default ForumCategories;
