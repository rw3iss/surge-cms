/**
 * Mounts enabled plugins' public-site widgets. Framework-agnostic: each plugin
 * bundle is dynamically imported and given a plain DOM element + host context.
 * Per-plugin `visibleRoles` config gates the widget to users holding any of
 * those roles (main or extra role); none = everyone. The legacy `adminOnly`
 * flag still reads as admin + sysadmin (`pluginVisibleTo`).
 * Rendered once in the public Layout (after the footer).
 */
import { Component, For, Show, createMemo, createResource, onCleanup, onMount } from 'solid-js';
import { pluginVisibleTo, type PublicPlugin } from '@sitesurge/types';
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
    // Set on unmount. The bundle loads asynchronously, so the mount can be
    // removed (user switched, signed out) before mountWidget runs: then it must
    // not mount at all, and a teardown registered later runs at once.
    let disposed = false;
    const runCleanups = () => {
        for (const fn of cleanups.splice(0,)) {
            try { fn(); } catch { /* ignore teardown errors */ }
        }
    };

    onMount(async () => {
        if (!props.plugin.clientUrl || !el) return;
        try {
            const mod = await loadPluginModule(props.plugin.clientUrl);
            if (disposed) return;
            const host = buildHost({
                name: props.plugin.name,
                version: props.plugin.version,
                config: props.plugin.config,
                settings: (siteSettings() ?? {}) as Record<string, unknown>,
                user: props.user,
                isAdmin: props.isAdmin,
                mountPoint: el,
                cleanups,
                isDisposed: () => disposed,
            });
            const teardown = await mod.mountWidget?.(el, host);
            if (typeof teardown === 'function') host.onCleanup(teardown);
        } catch (err) {
            // A broken plugin must never break the site.
            console.warn(`[plugins] "${props.plugin.name}" widget failed to load`, err);
        }
    });

    onCleanup(() => {
        disposed = true;
        runCleanups();
    });

    return <div ref={el} class="plugin-widget" data-plugin={props.plugin.name} />;
};

const PluginWidgetHost: Component = () => {
    const auth = useAuth();
    const isAdmin = useIsAdmin();

    // Fetch enabled plugins directly — the endpoint is feature-gated server-side
    // (returns the plugins when the feature is on, 404 → [] when off), so this
    // doesn't depend on the settings store's async load / client cache timing.
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
            (p) => p.clientUrl && p.capabilities.includes('public-widget') && pluginVisibleTo(p, auth.user as { role?: string; extraRoles?: string[]; } | null,),
        );

    // Remount every widget when the signed-in user CHANGES (sign in / out /
    // switch account): each plugin re-checks its role rules and re-initialises
    // with the new user, and a widget the new user may not see is torn down.
    // Without the key, a widget still visible to both users kept the previous
    // user's context, and one that should disappear could linger until reload.
    // Only the FIRST auth load hides the widgets: later loading phases (a login
    // attempt, a session refresh) keep the last settled key, so a wrong
    // password no longer tears every widget down and remounts it.
    const userKey = createMemo<string | null>((prev,) => (auth.isLoading ? prev : auth.user?.id ?? 'anonymous'), null,);

    return (
        <Show when={userKey()} keyed>
            {(_key) => (
                <For each={visible()}>
                    {(p) => <PluginWidgetMount plugin={p} isAdmin={isAdmin()} user={currentUser()} />}
                </For>
            )}
        </Show>
    );
};

export default PluginWidgetHost;
