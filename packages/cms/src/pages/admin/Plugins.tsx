import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import type { MarketplacePlugin, Plugin, } from '@sitesurge/types';
import { cms, } from '../../services/cmsClient';
import { loadEnabledPlugins, } from '../../stores/plugins';

const AdminPlugins: Component = () => {
    const [plugins, { refetch, },] = createResource(async () => {
        try { return await cms.plugins.list(); } catch { return [] as Plugin[]; }
    },);
    const [busy, setBusy,] = createSignal<string | null>(null,);
    const [error, setError,] = createSignal<string | null>(null,);
    const [showMarket, setShowMarket,] = createSignal(false,);

    let fileInput: HTMLInputElement | undefined;

    async function run(name: string, fn: () => Promise<unknown>,): Promise<void> {
        setBusy(name,); setError(null,);
        try {
            await fn();
            await refetch();
            // Refresh the shared enabled-plugins store so plugin-gated UI
            // elsewhere (e.g. the Shop's ShopifyManagedBanner) updates live
            // instead of staying stale until a full page reload.
            await loadEnabledPlugins(true,);
        } catch (e) {
            setError((e as Error).message,);
        } finally {
            setBusy(null,);
        }
    }

    async function onUpload(e: Event,): Promise<void> {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file,);
        await run('__upload__', () => cms.plugins.upload(fd,),);
        input.value = '';
    }

    function statusOf(p: Plugin,): { label: string; cls: string; } {
        if (p.error) return { label: 'Error', cls: 'badge--error', };
        if (p.enabled) return { label: 'Enabled', cls: 'badge--success', };
        if (p.installed) return { label: 'Installed', cls: 'badge--info', };
        return { label: 'Discovered', cls: 'badge--muted', };
    }

    return (
        <div>
            <Title>Plugins - Admin</Title>
            <div class="admin-header">
                <h1>Plugins</h1>
                <div class="admin-header__actions">
                    <button class="ui-button btn-secondary" disabled={!!busy()} onClick={() => run('__rescan__', () => cms.plugins.rescan(),)}>
                        {busy() === '__rescan__' ? 'Scanning…' : 'Rescan folder'}
                    </button>
                    <button class="ui-button btn-secondary" onClick={() => setShowMarket(true,)}>Marketplace</button>
                    <button class="ui-button btn-primary" disabled={!!busy()} onClick={() => fileInput?.click()}>
                        {busy() === '__upload__' ? 'Uploading…' : 'Upload .zip'}
                    </button>
                    <input ref={fileInput} type="file" accept=".zip,application/zip" style={{ display: 'none', }} onChange={onUpload} />
                </div>
            </div>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            <Show when={(plugins()?.length ?? 0) > 0} fallback={<div class="empty-state">No plugins yet. Upload a .zip, or drop a plugin folder into the backend <code>plugins/</code> directory and Rescan.</div>}>
                <table class="admin-table">
                    <thead>
                        <tr><th>Plugin</th><th>Version</th><th>Source</th><th>Status</th><th></th></tr>
                    </thead>
                    <tbody>
                        <For each={plugins()}>
                            {(p,) => {
                                const s = statusOf(p,);
                                return (
                                    <tr>
                                        <td>
                                            <A href={`/admin/plugins/${p.name}`} class="admin-table__link"><strong>{p.label}</strong></A>
                                            <div class="text-muted text-sm">{p.manifest?.description}</div>
                                        </td>
                                        <td>
                                            {p.version}
                                            <Show when={p.updateAvailable}><span class="badge badge--warning" style={{ 'margin-left': '.5em', }}>update</span></Show>
                                        </td>
                                        <td>{p.source}</td>
                                        <td><span class={`badge ${s.cls}`}>{s.label}</span></td>
                                        <td class="admin-table__actions">
                                            <Show when={!p.installed}>
                                                <button class="ui-button btn-sm btn-primary" disabled={busy() === p.name} onClick={() => run(p.name, () => cms.plugins.install(p.name,),)}>Install</button>
                                            </Show>
                                            <Show when={p.installed && !p.enabled}>
                                                <button class="ui-button btn-sm btn-success" disabled={busy() === p.name} onClick={() => run(p.name, () => cms.plugins.enable(p.name,),)}>Enable</button>
                                            </Show>
                                            <Show when={p.enabled}>
                                                <button class="ui-button btn-sm btn-secondary" disabled={busy() === p.name} onClick={() => run(p.name, () => cms.plugins.disable(p.name,),)}>Disable</button>
                                            </Show>
                                            <Show when={p.updateAvailable}>
                                                <button class="ui-button btn-sm btn-warning" disabled={busy() === p.name} onClick={() => run(p.name, () => cms.plugins.update(p.name,),)}>Update</button>
                                            </Show>
                                            <Show when={p.installed && p.hasUpdateHook && !p.updateAvailable}>
                                                <button class="ui-button btn-sm btn-secondary" disabled={busy() === p.name} onClick={() => run(p.name, () => cms.plugins.update(p.name,),)} title="Re-run this plugin's update() hook (e.g. re-fetch its bundle)">Re-sync</button>
                                            </Show>
                                            <A href={`/admin/plugins/${p.name}`} class="ui-button btn-sm btn-secondary">Configure</A>
                                        </td>
                                    </tr>
                                );
                            }}
                        </For>
                    </tbody>
                </table>
            </Show>

            <Show when={showMarket()}>
                <MarketplaceModal onClose={() => setShowMarket(false,)} onChanged={refetch} />
            </Show>
        </div>
    );
};

const MarketplaceModal: Component<{ onClose: () => void; onChanged: () => void; }> = (props) => {
    const [q, setQ,] = createSignal('',);
    const [results,] = createResource(q, async (query) => {
        try { return await cms.plugins.marketplaceSearch(query ? { q: query, } : undefined,); }
        catch { return [] as MarketplacePlugin[]; }
    },);
    const [msg, setMsg,] = createSignal<string | null>(null,);

    async function install(id: string,): Promise<void> {
        setMsg(null,);
        try { await cms.plugins.marketplaceInstall(id,); props.onChanged(); props.onClose(); }
        catch (e) { setMsg((e as Error).message,); }
    }

    return (
        <div class="modal-overlay" onClick={props.onClose}>
            <div class="modal" onClick={(e,) => e.stopPropagation()}>
                <div class="modal__header"><h2>Plugin Marketplace</h2><button class="modal__close" onClick={props.onClose}>×</button></div>
                <div class="modal__body">
                    <input class="input" placeholder="Search plugins…" value={q()} onInput={(e,) => setQ(e.currentTarget.value,)} />
                    <Show when={msg()}><div class="alert alert--warning" style={{ 'margin-top': '.75em', }}>{msg()}</div></Show>
                    <div class="marketplace-list" style={{ 'margin-top': '1em', }}>
                        <For each={results()} fallback={<div class="text-muted">No results.</div>}>
                            {(m,) => (
                                <div class="marketplace-item">
                                    <div>
                                        <strong>{m.label}</strong> <span class="text-muted text-sm">v{m.version}</span>
                                        <div class="text-muted text-sm">{m.description}</div>
                                    </div>
                                    <Show when={!m.installed} fallback={<span class="badge badge--muted">installed</span>}>
                                        <button class="ui-button btn-sm btn-primary" onClick={() => install(m.id,)}>Install</button>
                                    </Show>
                                </div>
                            )}
                        </For>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminPlugins;
