import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { api, } from '../../services/api';

const PROVIDERS = [
    { id: 'instagram', name: 'Instagram', icon: 'IG', },
    { id: 'facebook', name: 'Facebook', icon: 'FB', },
    { id: 'tiktok', name: 'TikTok', icon: 'TT', },
    { id: 'patreon', name: 'Patreon', icon: 'PA', },
    { id: 'youtube', name: 'YouTube', icon: 'YT', },
    { id: 'twitter', name: 'Twitter', icon: 'TW', },
];

const AdminConnections: Component = () => {
    const [connections, { refetch, },] = createResource(async () => {
        const response = await api.get('/connections',);
        return response.success ? (response as any).data : [];
    },);

    const getConnection = (providerId: string,) => {
        return connections()?.find((c: any,) => c.provider === providerId);
    };

    const handleDisconnect = async (provider: string,) => {
        if (!confirm(`Disconnect ${provider}? This will remove stored credentials.`,)) return;
        await api.delete(`/connections/${provider}`,);
        refetch();
    };

    const moveConnection = async (provider: string, direction: 'up' | 'down',) => {
        await api.put(`/connections/${provider}/reorder`, { direction, },);
        refetch();
    };

    return (
        <div>
            <Title>Connections - Admin - Surge Media</Title>
            <div class="admin-header">
                <h1>Connections</h1>
            </div>
            <div class="connections-list">
                <For each={PROVIDERS}>
                    {(provider, index,) => {
                        const conn = () => getConnection(provider.id,);
                        return (
                            <div class={`connection-card ${conn() ? 'connection-card--connected' : ''}`}>
                                <div class="connection-card__icon">{provider.icon}</div>
                                <div class="connection-card__info">
                                    <div class="connection-card__name">{provider.name}</div>
                                    <div class="connection-card__status">
                                        <Show
                                            when={conn()}
                                            fallback={<span class="badge badge--muted">Not connected</span>}
                                        >
                                            <span class="badge badge--success">Connected</span>
                                            <Show when={conn()?.autoPublish}>
                                                <span class="connection-card__auto-publish">
                                                    Auto-publish: {conn()?.autoPublishCount ?
                                                        `last ${conn()?.autoPublishCount}` :
                                                        'all'}
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
