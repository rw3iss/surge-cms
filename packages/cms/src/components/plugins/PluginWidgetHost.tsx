/**
 * Mounts enabled plugins' public-site widgets. Framework-agnostic: each plugin
 * bundle is dynamically imported and given a plain DOM element + host context.
 * Per-plugin `adminOnly` config gates the widget to signed-in admins.
 * Rendered once in the public Layout (after the footer).
 */
import { Component, For, createResource, onCleanup, onMount } from 'solid-js';
import type { PublicPlugin } from '@sitesurge/types';
import { cms } from '../../services/cmsClient';
import { useAuth, useIsAdmin } from '../../stores/auth';
import { siteSettings } from '../../stores/siteSettings';
import { buildHost, loadPluginModule } from '../../plugins/host';

const PluginWidgetMount: Component<{
    plugin: PublicPlugin;
    isAdmin: boolean;
    user: { id: string; role: string } | null;
}> = (props) => {
    let el: HTMLDivElement | undefined;
    const cleanups: Array<() => void> = [];

    onMount(async () => {
        if (!props.plugin.clientUrl || !el) return;
        try {
            const mod = await loadPluginModule(props.plugin.clientUrl);
            const host = buildHost({
                name: props.plugin.name,
                config: props.plugin.config,
                settings: (siteSettings() ?? {}) as Record<string, unknown>,
                user: props.user,
                isAdmin: props.isAdmin,
                mountPoint: el,
                cleanups,
            });
            const teardown = mod.mountWidget?.(el, host);
            if (typeof teardown === 'function') cleanups.push(teardown);
        } catch (err) {
            // A broken plugin must never break the site.
            console.warn(`[plugins] "${props.plugin.name}" widget failed to load`, err);
        }
    });

    onCleanup(() => {
        for (const fn of cleanups) {
            try { fn(); } catch { /* ignore teardown errors */ }
        }
    });

    return <div ref={el} class="plugin-widget" data-plugin={props.plugin.name} />;
};

const PluginWidgetHost: Component = () => {
    const auth = useAuth();
    const isAdmin = useIsAdmin();

    // Fetch enabled plugins directly — DON'T gate on the settings store. On a
    // fresh/hard load the public Layout loads settings asynchronously and the
    // client SWR-caches /settings/public in localStorage, so gating on
    // isFeatureEnabled('plugins') could stay false (stale/not-yet-loaded) and
    // never fire. GET /plugins/enabled is itself feature-gated server-side:
    // returns the plugins when the feature is on, 404s (→ []) when off.
    const [plugins] = createResource(async () => {
        try {
            return await cms.plugins.listEnabled();
        } catch {
            return [] as PublicPlugin[];
        }
    });

    const currentUser = (): { id: string; role: string } | null =>
        auth.user ? { id: auth.user.id, role: String(auth.user.role) } : null;

    const visible = (): PublicPlugin[] =>
        (plugins() ?? []).filter(
            (p) => p.clientUrl && p.capabilities.includes('public-widget') && (!p.adminOnly || isAdmin()),
        );

    return (
        <For each={visible()}>
            {(p) => <PluginWidgetMount plugin={p} isAdmin={isAdmin()} user={currentUser()} />}
        </For>
    );
};

export default PluginWidgetHost;
