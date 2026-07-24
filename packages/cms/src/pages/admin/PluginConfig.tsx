/**
 * Per-plugin config page (/admin/plugins/:name). Shows status + lifecycle
 * controls, then the config UI: the plugin's own `mountConfig(el, host)` if it
 * exports one, else the host-rendered declarative form from its configSchema.
 */
import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import { Component, createResource, createSignal, onCleanup, onMount, Show, } from 'solid-js';
import type { Plugin, } from '@sitesurge/types';
import { cms, } from '../../services/cmsClient';
import { useAuth, useIsAdmin, } from '../../stores/auth';
import { siteSettings, } from '../../stores/siteSettings';
import { buildHost, loadPluginModule, } from '../../plugins/host';
import PluginConfigForm from '../../components/plugins/PluginConfigForm';

const AdminPluginConfig: Component = () => {
    const params = useParams();
    const auth = useAuth();
    const isAdmin = useIsAdmin();
    const [plugin, { refetch, },] = createResource(() => params.name, async (name) => {
        try { return await cms.plugins.getByName(name,); } catch { return null; }
    },);
    const [busy, setBusy,] = createSignal<string | null>(null,);
    const [error, setError,] = createSignal<string | null>(null,);

    async function run(kind: string, fn: () => Promise<unknown>,): Promise<void> {
        setBusy(kind,); setError(null,);
        try { await fn(); await refetch(); } catch (e) { setError((e as Error).message,); }
        finally { setBusy(null,); }
    }

    const saveConfig = async (patch: Record<string, unknown>,): Promise<void> => {
        await cms.plugins.saveConfig(params.name ?? '', patch,);
        await refetch();
    };

    return (
        <div>
            <Title>Plugin — Admin</Title>
            <div class="admin-header">
                <div>
                    <A href="/admin/plugins" class="text-muted text-sm">← Plugins</A>
                    <h1>{plugin()?.label ?? params.name}</h1>
                </div>
            </div>

            <Show when={plugin()} fallback={<div class="empty-state">Plugin not found.</div>}>
                {(p) => (
                    <>
                        <div class="plugin-detail-meta">
                            <span>v{p().version}</span>
                            <span class={`badge ${p().enabled ? 'badge--success' : p().installed ? 'badge--info' : 'badge--muted'}`}>
                                {p().enabled ? 'Enabled' : p().installed ? 'Installed' : 'Discovered'}
                            </span>
                            <Show when={p().error}><span class="badge badge--error">Error</span></Show>
                        </div>
                        <Show when={p().error}><div class="alert alert--error">{p().error}</div></Show>
                        <Show when={p().manifest?.homepage}>
                            <p class="text-muted text-sm">{p().manifest.description} · <a href={p().manifest.homepage} target="_blank" rel="noreferrer">Homepage</a></p>
                        </Show>

                        <div class="plugin-detail-actions">
                            <Show when={!p().installed}>
                                <button class="btn btn-primary" disabled={!!busy()} onClick={() => run('install', () => cms.plugins.install(p().name,),)}>
                                    {busy() === 'install' ? 'Installing…' : 'Install'}
                                </button>
                            </Show>
                            <Show when={p().installed && !p().enabled}>
                                <button class="btn btn-success" disabled={!!busy()} onClick={() => run('enable', () => cms.plugins.enable(p().name,),)}>Enable</button>
                            </Show>
                            <Show when={p().enabled}>
                                <button class="btn btn-secondary" disabled={!!busy()} onClick={() => run('disable', () => cms.plugins.disable(p().name,),)}>Disable</button>
                            </Show>
                            <Show when={p().updateAvailable}>
                                <button class="btn btn-warning" disabled={!!busy()} onClick={() => run('update', () => cms.plugins.update(p().name,),)}>Update to v{p().version}</button>
                            </Show>
                            {/* Re-sync: a plugin that implements update() can be
                                refreshed on demand (e.g. re-fetch its vendor bundle)
                                even when no version bump is pending. */}
                            <Show when={p().installed && p().hasUpdateHook && !p().updateAvailable}>
                                <button class="btn btn-secondary" disabled={!!busy()} onClick={() => run('update', () => cms.plugins.update(p().name,),)}>
                                    {busy() === 'update' ? 'Updating…' : 'Re-sync / Update'}
                                </button>
                            </Show>
                        </div>

                        <Show when={error()}><div class="alert alert--error">{error()}</div></Show>

                        <section class="plugin-config-section">
                            <h2>Configuration</h2>
                            <ConfigArea plugin={p()} saveConfig={saveConfig}
                                host={{ user: auth.user ? { id: auth.user.id, role: String(auth.user.role,), } : null, isAdmin: isAdmin(), }} />
                        </section>
                    </>
                )}
            </Show>
        </div>
    );
};

/** Loads the plugin's own mountConfig if present; otherwise the declarative form. */
const ConfigArea: Component<{
    plugin: Plugin;
    saveConfig: (patch: Record<string, unknown>) => Promise<void>;
    host: { user: { id: string; role: string } | null; isAdmin: boolean; };
}> = (props) => {
    const [mode, setMode,] = createSignal<'loading' | 'custom' | 'declarative'>('loading',);
    let el: HTMLDivElement | undefined;
    const cleanups: Array<() => void> = [];

    onMount(async () => {
        const clientUrl = props.plugin.manifest?.client ? `/api/v1/plugins/${props.plugin.name}/client.js` : null;
        if (!clientUrl) { setMode('declarative',); return; }
        try {
            const mod = await loadPluginModule(clientUrl,);
            if (mod.mountConfig && el) {
                setMode('custom',);
                const host = buildHost({
                    name: props.plugin.name,
                    version: props.plugin.version,
                    config: props.plugin.config,
                    settings: (siteSettings() ?? {}) as Record<string, unknown>,
                    user: props.host.user,
                    isAdmin: props.host.isAdmin,
                    mountPoint: el,
                    cleanups,
                    saveConfig: props.saveConfig,
                });
                const teardown = mod.mountConfig(el, host,);
                if (typeof teardown === 'function') cleanups.push(teardown,);
            } else {
                setMode('declarative',);
            }
        } catch {
            setMode('declarative',);
        }
    },);

    onCleanup(() => { for (const fn of cleanups) { try { fn(); } catch { /* noop */ } } },);

    return (
        <>
            {/* The custom mount point is ALWAYS in the DOM so its ref is assigned
                before onMount runs (a `ref` inside a <Show> that starts false is
                undefined at mount — the plugin's mountConfig would never fire and
                the page silently fell back to the schema form). Hidden until the
                plugin's mountConfig has actually rendered into it. */}
            <div
                ref={el}
                class="plugin-custom-config"
                style={mode() === 'custom' ? undefined : { display: 'none', }}
            />
            <Show when={mode() === 'declarative'}>
                <PluginConfigForm plugin={props.plugin} onSave={props.saveConfig} />
            </Show>
            <Show when={mode() === 'loading'}>
                <div class="text-muted">Loading configuration…</div>
            </Show>
        </>
    );
};

export default AdminPluginConfig;
