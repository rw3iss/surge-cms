import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';

const PROVIDERS = [
    { id: 'instagram', name: 'Instagram', icon: 'IG', },
    { id: 'facebook', name: 'Facebook', icon: 'FB', },
    { id: 'tiktok', name: 'TikTok', icon: 'TT', },
    { id: 'patreon', name: 'Patreon', icon: 'PA', },
    { id: 'youtube', name: 'YouTube', icon: 'YT', },
    { id: 'twitter', name: 'Twitter', icon: 'TW', },
];

function formatExpiry(iso: string | undefined | null,): string | null {
    if (!iso) return null;
    try {
        const d = new Date(iso,);
        const now = Date.now();
        const ms = d.getTime() - now;
        if (ms < 0) return 'Expired';
        const days = Math.floor(ms / 86_400_000,);
        if (days > 30) return `Expires ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', },)}`;
        if (days > 1) return `Expires in ${days}d`;
        const hours = Math.floor(ms / 3_600_000,);
        return hours > 0 ? `Expires in ${hours}h` : 'Expires soon';
    } catch {
        return null;
    }
}

const AdminConnections: Component = () => {
    const [connections, { refetch, },] = createResource(async () => {
        try {
            return await cms.connections.list() as any[];
        } catch {
            return [] as any[];
        }
    },);

    const getConnection = (providerId: string,) => {
        return connections()?.find((c: any,) => c.provider === providerId);
    };

    const handleDisconnect = async (provider: string,) => {
        if (!confirm(`Disconnect ${provider}? This will remove stored credentials.`,)) return;
        await cms.connections.remove(provider,);
        refetch();
    };

    const moveConnection = async (provider: string, direction: 'up' | 'down',) => {
        await cms.connections.reorder(provider, { direction, } as any,);
        refetch();
    };

    return (
        <div>
            <Title>Connections - Admin - RW</Title>
            <div class="admin-header">
                <h1>Connections</h1>
            </div>
            <div class="connections-list">
                <For each={PROVIDERS}>
                    {(provider, index,) => {
                        const conn = () => getConnection(provider.id,);
                        const expiry = () => formatExpiry(conn()?.credentials?.tokenExpiresAt,);
                        return (
                            <div class={`connection-card ${conn() ? 'connection-card--connected' : ''}`}>
                                <div class="connection-card__icon">{provider.icon}</div>
                                <div class="connection-card__info">
                                    <div class="connection-card__name">
                                        {provider.name}
                                        <Show when={conn()?.displayName}>
                                            <span class="connection-card__username">
                                                @{conn()!.displayName}
                                            </span>
                                        </Show>
                                    </div>
                                    <div class="connection-card__status">
                                        <Show
                                            when={conn()}
                                            fallback={<span class="badge badge--muted">Not connected</span>}
                                        >
                                            <span class="badge badge--success">Connected</span>
                                            <Show when={conn()?.autoPublish}>
                                                <span class="connection-card__meta">
                                                    Auto-publish: {conn()?.autoPublishCount ?
                                                        `last ${conn()?.autoPublishCount}` :
                                                        'all'}
                                                </span>
                                            </Show>
                                            <Show when={expiry()}>
                                                <span class={`connection-card__expiry ${
                                                    expiry() === 'Expired' ? 'connection-card__expiry--warn' : ''
                                                }`}>
                                                    {expiry()}
                                                </span>
                                            </Show>
                                            <Show when={conn()?.lastSyncedAt}>
                                                <span class="connection-card__meta">
                                                    Synced {new Date(conn()!.lastSyncedAt,).toLocaleDateString()}
                                                </span>
                                            </Show>
                                        </Show>
                                    </div>
                                </div>
                                <div class="connection-card__actions">
                                    <Show when={conn()}>
                                        <button
                                            class="btn btn--small btn--icon"
                                            onClick={() => moveConnection(provider.id, 'up',)}
                                            disabled={index() === 0}
                                            title="Move up"
                                        >
                                            &#9650;
                                        </button>
                                        <button
                                            class="btn btn--small btn--icon"
                                            onClick={() => moveConnection(provider.id, 'down',)}
                                            disabled={index() === PROVIDERS.length - 1}
                                            title="Move down"
                                        >
                                            &#9660;
                                        </button>
                                        <A
                                            href={`/admin/connections/${provider.id}`}
                                            class="btn btn--small btn--secondary"
                                        >
                                            Edit
                                        </A>
                                        <button
                                            class="btn btn--small btn--danger"
                                            onClick={() => handleDisconnect(provider.id,)}
                                        >
                                            Disconnect
                                        </button>
                                    </Show>
                                    <Show when={!conn()}>
                                        <A
                                            href={`/admin/connections/${provider.id}`}
                                            class="btn btn--small btn--primary"
                                        >
                                            Connect
                                        </A>
                                    </Show>
                                </div>
                            </div>
                        );
                    }}
                </For>
            </div>
        </div>
    );
};

export default AdminConnections;
