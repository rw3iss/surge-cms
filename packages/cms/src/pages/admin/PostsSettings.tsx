/**
 * Posts settings (`/admin/posts/settings`).
 *
 * Tabs: **General**, then one per post type that HAS options — a type gets a
 * tab by adding a panel to `TYPE_PANELS` (today only Live Show: the live
 * stream provider). Article and Video have none yet, so they are not shown.
 * Deep-linkable: `?tab=live`.
 */
import { A, useSearchParams, } from '@solidjs/router';
import type { LiveProviderDescriptor, PostsSettings, } from '@sitesurge/types';
import { getPostType, listPostTypes, } from '@sitesurge/types';
import { Component, createSignal, For, type JSX, onMount, Show, } from 'solid-js';
import { createStore, reconcile, unwrap, } from 'solid-js/store';
import AdminTitle from '../../components/admin/common/AdminTitle';
import { FormField, } from '../../components/admin/forms';
import LiveProviderSettings from '../../components/admin/posts/settings/LiveProviderSettings';
import { useToast, } from '../../components/common/toast';
import { cms, } from '../../services/cmsClient';

interface PanelCtx {
    providers: () => LiveProviderDescriptor[];
    provider: () => string | null;
    setProvider: (k: string | null,) => void;
    configs: Record<string, Record<string, unknown>>;
    setConfigs: ReturnType<typeof createStore<Record<string, Record<string, unknown>>>>[1];
}

/** Post types with a settings tab. Add an entry to give a type its own tab. */
const TYPE_PANELS: Record<string, (ctx: PanelCtx,) => JSX.Element> = {
    live: (ctx,) => (
        <LiveProviderSettings
            providers={ctx.providers()}
            provider={ctx.provider()}
            onProviderChange={ctx.setProvider}
            configs={ctx.configs}
            setConfigs={ctx.setConfigs}
        />
    ),
};

const AdminPostsSettings: Component = () => {
    const toast = useToast();
    const [params, setParams,] = useSearchParams<{ tab?: string; }>();
    const [loaded, setLoaded,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [providers, setProviders,] = createSignal<LiveProviderDescriptor[]>([],);
    const [defaultType, setDefaultType,] = createSignal('article',);
    const [provider, setProvider,] = createSignal<string | null>(null,);
    const [configs, setConfigs,] = createStore<Record<string, Record<string, unknown>>>({},);

    const tabs = () => [
        { key: 'general', label: 'General', },
        ...Object.keys(TYPE_PANELS,).map((k,) => ({ key: k, label: getPostType(k,).label, })),
    ];
    const tab = () => (tabs().some((t,) => t.key === params.tab,) ? params.tab! : 'general');

    const apply = (s: PostsSettings, list: LiveProviderDescriptor[],) => {
        setProviders(list,);
        setDefaultType(s.general.defaultPostType,);
        setProvider(s.live.provider,);
        setConfigs(reconcile(JSON.parse(JSON.stringify(s.live.providers,),),),);
    };

    onMount(async () => {
        try {
            const r = await cms.posts.settings();
            apply(r.settings, r.liveProviders,);
        } catch (e) {
            toast.error(`Could not load settings: ${(e as Error).message}`,);
        } finally {
            setLoaded(true,);
        }
    },);

    const save = async () => {
        setSaving(true,);
        try {
            const r = await cms.posts.updateSettings({
                general: { defaultPostType: defaultType(), },
                // A store is a Proxy: structuredClone() throws on it (DataCloneError), which
                // silently broke Save. unwrap() → plain data, then a JSON copy.
                live: { provider: provider(), providers: JSON.parse(JSON.stringify(unwrap(configs,),),), },
            },);
            apply(r.settings, r.liveProviders,);
            toast.success('Posts settings saved',);
        } catch (e) {
            toast.error(`Save failed: ${(e as Error).message}`,);
        } finally {
            setSaving(false,);
        }
    };

    const ctx: PanelCtx = { providers, provider, setProvider, configs, setConfigs, };

    return (
        <div class="posts-settings-page">
            <AdminTitle>Posts Settings</AdminTitle>
            <div class="admin-header">
                <A href="/admin/posts" class="admin-header__back">← Posts</A>
                <h1>Posts Settings</h1>
                <div class="admin-header__actions">
                    <button class="ui-button ui-button--primary" onClick={save} disabled={saving() || !loaded()}>
                        {saving() ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>

            <Show when={loaded()} fallback={<div class="empty-state">Loading…</div>}>
                <div class="settings-tabs">
                    <For each={tabs()}>
                        {(t,) => (
                            <button
                                class={`settings-tabs__tab ${tab() === t.key ? 'settings-tabs__tab--active' : ''}`}
                                onClick={() => setParams({ tab: t.key === 'general' ? undefined : t.key, },)}
                            >
                                {t.label}
                            </button>
                        )}
                    </For>
                </div>

                <Show when={tab() === 'general'}>
                    <section class="admin-section">
                        <header class="admin-section__header"><h2>New posts</h2></header>
                        <div class="form-section">
                            <FormField label="Default post type" hint="Highlighted in the New Post picker and used for /admin/posts/new without a type.">
                                <select value={defaultType()} onChange={(e,) => setDefaultType(e.currentTarget.value,)}>
                                    <For each={listPostTypes()}>
                                        {(t,) => <option value={t.key}>{t.label}</option>}
                                    </For>
                                </select>
                            </FormField>
                        </div>
                    </section>
                </Show>

                <Show when={tab() !== 'general' && TYPE_PANELS[tab()]}>
                    {TYPE_PANELS[tab()]!(ctx,)}
                </Show>
            </Show>
        </div>
    );
};

export default AdminPostsSettings;
