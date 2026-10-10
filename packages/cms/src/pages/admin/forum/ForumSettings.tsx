/**
 * /admin/forum/settings — the forum's title, who may read / start threads /
 * reply (compared with the subscription tier ranks), approval rules and page
 * sizes, plus the shared engine settings (reactions, post length, edit window
 * — Comments → Settings edits the same values).
 */
import type { DiscussionsSettings, ForumSettings, SubscriptionTierOption, } from '@sitesurge/types';
import { DEFAULT_DISCUSSIONS_SETTINGS, DEFAULT_FORUM_SETTINGS, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import Toggle from '../../../components/admin/common/Toggle';
import EngineSettingsSection from '../../../components/discussions/admin/EngineSettingsSection';
import { FormField, } from '../../../components/admin/forms';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import './ForumAdmin.scss';

const ForumSettingsPage: Component = () => {
    const toast = useToast();
    const [s, setS,] = createSignal<ForumSettings>({ ...DEFAULT_FORUM_SETTINGS, },);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const set = (p: Partial<ForumSettings>,) => setS((cur,) => ({ ...cur, ...p, }));
    const [engine, setEngine,] = createSignal<DiscussionsSettings>({ ...DEFAULT_DISCUSSIONS_SETTINGS, },);

    const [loaded,] = createResource(async () => {
        const [v, e,] = await Promise.all([cms.forum.settings(), cms.discussions.settings(),],);
        setS(v,);
        setEngine(e,);
        return v;
    },);
    const [tiers,] = createResource(() => cms.subscriptionTiers.options().catch(() => [] as SubscriptionTierOption[]),);
    // The free tier is rank 0 = "any signed-in member"; paid tiers 1, 2, …
    const paidTiers = () => (tiers() ?? []).filter((t,) => t.sortOrder > 0);

    const save = async () => {
        setSaving(true,);
        setError('',);
        try {
            const e = engine();
            const [v, saved,] = await Promise.all([
                cms.forum.updateSettings(s(),),
                cms.discussions.updateSettings({
                    reactionsEnabled: e.reactionsEnabled, reactions: e.reactions, maxLength: e.maxLength, editWindowMinutes: e.editWindowMinutes,
                },),
            ],);
            setS(v,);
            setEngine(saved,);
            toast.success('Forum settings saved',);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the settings.',);
        } finally {
            setSaving(false,);
        }
    };

    const RankSelect: Component<{ value: number; onChange: (v: number,) => void; }> = (p,) => (
        <select value={String(p.value,)} onChange={(e,) => p.onChange(Number(e.currentTarget.value,),)}>
            <option value="0">Any signed-in member</option>
            <For each={paidTiers()}>{(t,) => <option value={t.sortOrder}>{t.name} or higher</option>}</For>
        </select>
    );

    return (
        <div class="admin-forum">
            <AdminTitle>Forum Settings</AdminTitle>
            <div class="admin-header">
                <A href="/admin/forum" class="admin-header__back">← Forum</A>
                <h1>Forum Settings</h1>
                <div class="admin-header__actions">
                    <button type="button" class="ui-button ui-button--primary" onClick={save} disabled={saving() || loaded.loading}>
                        {saving() ? 'Saving…' : 'Save Settings'}
                    </button>
                </div>
            </div>

            <Show when={error()}><div class="alert alert--error">{error()}</div></Show>
            <Show when={loaded.loading}><p>Loading…</p></Show>

            <section class="admin-section">
                <header class="admin-section__header"><h2>Forum</h2></header>
                <FormField label="Title" hint="Shown at the top of /forum.">
                    <input type="text" value={s().title} onChange={(e,) => set({ title: e.currentTarget.value, },)} />
                </FormField>
                <FormField label="Description" hint="Markdown. Shown under the title on /forum.">
                    <textarea rows={3} value={s().description} onChange={(e,) => set({ description: e.currentTarget.value, },)} />
                </FormField>
            </section>

            <section class="admin-section">
                <header class="admin-section__header"><h2>Access</h2></header>
                <FormField label="Who can read the forum" hint="Each category can raise this further.">
                    <select value={s().readAccess} onChange={(e,) => set({ readAccess: e.currentTarget.value as ForumSettings['readAccess'], },)}>
                        <option value="public">Everyone</option>
                        <option value="members">Signed-in members</option>
                        <option value="tier">Subscribers of a tier…</option>
                    </select>
                </FormField>
                <Show when={s().readAccess === 'tier'}>
                    <FormField label="Read tier">
                        <RankSelect value={s().readMinRank} onChange={(v,) => set({ readMinRank: v, },)} />
                    </FormField>
                </Show>
                <FormField label="Who can start threads">
                    <RankSelect value={s().threadMinRank} onChange={(v,) => set({ threadMinRank: v, },)} />
                </FormField>
                <FormField label="Who can reply">
                    <RankSelect value={s().replyMinRank} onChange={(v,) => set({ replyMinRank: v, },)} />
                </FormField>
                <p class="form-help-muted">
                    Tiers rank by price (Free = 0). The permissions <code>forum:thread_create</code> and <code>forum:reply</code> also apply
                    (Settings → Permissions).
                </p>
            </section>

            <section class="admin-section">
                <header class="admin-section__header"><h2>Moderation</h2></header>
                <Toggle checked={s().approveAll} onChange={(v,) => set({ approveAll: v, },)} label="Hold every new thread and reply for approval" />
                <FormField label="Approve new members' first posts" hint="Hold a member's posts until they have this many approved forum posts. 0 = off.">
                    <input
                        type="number"
                        min="0"
                        max="100"
                        class="admin-forum__number"
                        value={s().approveUntil}
                        onChange={(e,) => set({ approveUntil: Number(e.currentTarget.value,) || 0, },)}
                    />
                </FormField>
                <p class="form-help-muted">
                    Pending and reported posts are in <A href="/admin/comments?scope=forum">the moderation queue</A>.
                </p>
            </section>

            <EngineSettingsSection value={engine()} onChange={(p,) => setEngine((cur,) => ({ ...cur, ...p, }))} />

            <section class="admin-section">
                <header class="admin-section__header"><h2>Display</h2></header>
                <FormField label="Threads per page">
                    <input type="number" min="5" max="100" class="admin-forum__number" value={s().threadsPerPage} onChange={(e,) => set({ threadsPerPage: Number(e.currentTarget.value,) || 25, },)} />
                </FormField>
                <FormField label="Posts per page">
                    <input type="number" min="5" max="100" class="admin-forum__number" value={s().postsPerPage} onChange={(e,) => set({ postsPerPage: Number(e.currentTarget.value,) || 20, },)} />
                </FormField>
                <Toggle checked={s().showActivityCounts} onChange={(v,) => set({ showActivityCounts: v, },)} label="Show each member's activity count on their posts" />
            </section>
        </div>
    );
};

export default ForumSettingsPage;
