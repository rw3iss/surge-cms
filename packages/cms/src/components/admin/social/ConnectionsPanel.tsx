import { useSearchParams, } from '@solidjs/router';
import { Component, createResource, createSignal, For, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';

/**
 * Provider connections manager. Relocated from Settings → Connections into the
 * Social hub's Configuration tab. Owns per-provider credential setup, OAuth,
 * enable/auto-publish settings, and the X free/api mode utility.
 */
const PROVIDERS = [
    { id: 'instagram', name: 'Instagram', icon: 'IG', oauth: true, },
    { id: 'facebook', name: 'Facebook', icon: 'FB', oauth: false, },
    { id: 'tiktok', name: 'TikTok', icon: 'TT', oauth: false, },
    { id: 'patreon', name: 'Patreon', icon: 'PA', oauth: false, },
    { id: 'youtube', name: 'YouTube', icon: 'YT', oauth: false, },
    { id: 'twitter', name: 'Twitter/X', icon: 'TW', oauth: false, },
];

const ConnectionsPanel: Component = () => {
    const [searchParams, setSearchParams,] = useSearchParams<{ oauth_success: string, oauth_error: string, }>();  // eslint-disable-line
    const [connections, { refetch, },] = createResource(async () => {
        try {
            return await cms.connections.list() as any[];
        } catch {
            return [] as any[];
        }
    },);
    const [editingProvider, setEditingProvider,] = createSignal<string | null>(null,);

    // Inline editor state
    const [enabled, setEnabled,] = createSignal(true,);
    const [autoPublish, setAutoPublish,] = createSignal(false,);
    const [autoPublishCount, setAutoPublishCount,] = createSignal<number | null>(null,);
    const [publishAll, setPublishAll,] = createSignal(false,);
    const [accessToken, setAccessToken,] = createSignal('',);
    const [apiKey, setApiKey,] = createSignal('',);
    const [appId, setAppId,] = createSignal('',);
    const [appSecret, setAppSecret,] = createSignal('',);
    const [twitterMode, setTwitterMode,] = createSignal<'free' | 'api'>('free',);
    const [connError, setConnError,] = createSignal('',);
    const [connSuccess, setConnSuccess,] = createSignal('',);
    const [oauthLoading, setOauthLoading,] = createSignal(false,);
    const [syncing, setSyncing,] = createSignal<string | null>(null,);

    // Handle OAuth callback params (works on whatever route this mounts).
    onMount(() => {
        if (searchParams.oauth_success) {
            setConnSuccess(`${searchParams.oauth_success} connected successfully!`,);
            refetch();
            setSearchParams({ oauth_success: undefined, },);
        }
        if (searchParams.oauth_error) {
            setConnError(decodeURIComponent(searchParams.oauth_error ?? '',),);
            setSearchParams({ oauth_error: undefined, },);
        }
    },);

    const getConnection = (providerId: string,) => connections()?.find((c: any,) => c.provider === providerId);
    const isOAuthProvider = (providerId: string,) => PROVIDERS.find((p,) => p.id === providerId)?.oauth;

    const startEditing = (providerId: string,) => {
        const conn = getConnection(providerId,);
        setEnabled(conn?.isEnabled !== false,);
        setAutoPublish(conn?.autoPublish || false,);
        setAutoPublishCount(conn?.autoPublishCount || null,);
        setPublishAll(!conn?.autoPublishCount,);
        setAccessToken('',);
        setApiKey(conn?.credentials?.apiKey || '',);
        setAppId(conn?.credentials?.appId || '',);
        setAppSecret('',);
        setTwitterMode(conn?.settings?.twitterMode === 'api' ? 'api' : 'free',);
        setConnError('',);
        setConnSuccess('',);
        setEditingProvider(providerId,);
    };

    const cancelEditing = () => setEditingProvider(null,);

    const handleSaveConnection = async () => {
        const provider = editingProvider();
        if (!provider) return;
        setConnError('',);
        setConnSuccess('',);

        const credentials: Record<string, unknown> = {};

        if (isOAuthProvider(provider,)) {
            if (appId()) credentials.appId = appId();
            if (appSecret()) credentials.appSecret = appSecret();
        } else {
            if (accessToken()) credentials.accessToken = accessToken();
            if (apiKey()) credentials.apiKey = apiKey();
        }

        const data: Record<string, unknown> = {
            provider,
            enabled: enabled(),
            autoPublish: autoPublish(),
            autoPublishCount: publishAll() ? null : (autoPublishCount() || null),
            credentials,
        };
        // X free/api mode lives in the connection settings blob.
        if (provider === 'twitter') data.settings = { twitterMode: twitterMode(), };

        const conn = getConnection(provider,);
        try {
            if (conn) {
                await cms.connections.update(provider, data as any,);
            } else {
                await cms.connections.upsert(data as any,);
            }
            setConnSuccess('Connection saved.',);
            setEditingProvider(null,);
            refetch();
        } catch (e) {
            setConnError(e instanceof Error ? e.message : 'Failed to save',);
        }
    };

    const handleOAuthConnect = async (provider: string,) => {
        setOauthLoading(true,);
        setConnError('',);

        try {
            const response = await cms.connections.oauthAuthorize(provider,) as { authUrl?: string; };
            if (response?.authUrl) {
                window.location.href = response.authUrl;
            } else {
                setConnError('Failed to start OAuth flow',);
                setOauthLoading(false,);
            }
        } catch (e) {
            setConnError(e instanceof Error ? e.message : 'Failed to start OAuth flow',);
            setOauthLoading(false,);
        }
    };

    const handleDisconnect = async (provider: string,) => {
        const providerName = PROVIDERS.find((p,) => p.id === provider)?.name || provider;
        if (!confirm(`Disconnect ${providerName}? This will remove the access token and stop auto-refresh.`,)) return;

        try {
            await cms.connections.remove(provider,);
            setConnSuccess(`${providerName} disconnected.`,);
            refetch();
        } catch (e) {
            setConnError(e instanceof Error ? e.message : 'Failed to disconnect',);
        }
    };

    const handleSyncNow = async (provider: string,) => {
        setSyncing(provider,);
        setConnError('',);
        setConnSuccess('',);
        try {
            const res = await cms.social.sync({ platform: provider as any, },) as { results?: Record<string, number>; };
            const count = res.results?.[provider] ?? 0;
            setConnSuccess(`Synced ${count} post(s) from ${provider}.`,);
            refetch();
        } catch (e) {
            setConnError(e instanceof Error ? e.message : 'Sync failed',);
        } finally {
            setSyncing(null,);
        }
    };

    const formatExpiry = (iso: string | null,) => {
        if (!iso) return null;
        const date = new Date(iso,);
        const days = Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24),);
        if (days < 0) return 'Expired';
        if (days === 0) return 'Expires today';
        return `Expires in ${days} days`;
    };

    return (
        <div class="connections-list">
            <Show when={connSuccess()}>
                <div class="alert alert--success" style={{ 'margin-bottom': '1rem', }}>{connSuccess()}</div>
            </Show>
            <Show when={connError() && !editingProvider()}>
                <div class="alert alert--error" style={{ 'margin-bottom': '1rem', }}>{connError()}</div>
            </Show>
            <For each={PROVIDERS}>
                {(provider,) => {
                    const conn = () => getConnection(provider.id,);
                    const isEditing = () => editingProvider() === provider.id;
                    const isConnected = () => conn()?.isConnected;
                    return (
                        <div
                            class={`connection-card ${isConnected() ? 'connection-card--connected' : ''} ${
                                isEditing() ? 'connection-card--editing' : ''
                            }`}
                        >
                            <div class="connection-card__row">
                                <div class="connection-card__icon">{provider.icon}</div>
                                <div class="connection-card__info">
                                    <div class="connection-card__name">{provider.name}</div>
                                    <div class="connection-card__status">
                                        <Show
                                            when={isConnected()}
                                            fallback={<span class="badge badge--muted">Not connected</span>}
                                        >
                                            <span class="badge badge--success">Connected</span>
                                            <Show when={conn()?.displayName}>
                                                <span class="connection-card__account">@{conn()?.displayName}</span>
                                            </Show>
                                            <Show when={conn()?.credentials?.tokenExpiresAt}>
                                                <span class="connection-card__expiry">
                                                    {formatExpiry(conn()?.credentials?.tokenExpiresAt,)}
                                                </span>
                                            </Show>
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
                                    <Show when={!isEditing()}>
                                        <button
                                            class="btn btn--small btn--secondary"
                                            onClick={() => startEditing(provider.id,)}
                                        >
                                            {conn() ? 'Edit' : 'Setup'}
                                        </button>
                                        <Show when={isConnected()}>
                                            <button
                                                class="btn btn--small"
                                                disabled={syncing() === provider.id}
                                                onClick={() => handleSyncNow(provider.id,)}
                                            >
                                                {syncing() === provider.id ? 'Syncing…' : 'Sync now'}
                                            </button>
                                            <button
                                                class="btn btn--small btn--danger"
                                                onClick={() => handleDisconnect(provider.id,)}
                                            >
                                                Disconnect
                                            </button>
                                        </Show>
                                    </Show>
                                </div>
                            </div>

                            <Show when={isEditing()}>
                                <div class="connection-card__editor">
                                    <Show when={connError()}>
                                        <div class="alert alert--error">{connError()}</div>
                                    </Show>

                                    {/* OAuth providers: App ID + Secret + Authorize button */}
                                    <Show when={provider.oauth} fallback={
                                        <>
                                            <Show when={provider.id === 'twitter'}>
                                                <FormField
                                                    label="Feed mode"
                                                    hint="Free: add/compose posts (no read API needed). API: auto-sync recent posts — requires a paid X Basic tier bearer token."
                                                    class="form-field--block"
                                                >
                                                    <select
                                                        value={twitterMode()}
                                                        onChange={(e,) => setTwitterMode(e.currentTarget.value as 'free' | 'api',)}
                                                    >
                                                        <option value="free">Free (compose / manual capture)</option>
                                                        <option value="api">API (paid Basic tier auto-sync)</option>
                                                    </select>
                                                </FormField>
                                            </Show>
                                            <FormField label="Access Token">
                                                <input
                                                    type="password"
                                                    value={accessToken()}
                                                    onInput={(e,) => setAccessToken(e.currentTarget.value,)}
                                                    placeholder={conn()?.credentials?.hasAccessToken ?
                                                        'Token saved (enter new to replace)' :
                                                        'Paste access token'}
                                                />
                                                <span class="form-help">API access token for {provider.name}</span>
                                            </FormField>
                                            <FormField label="API Key (optional)">
                                                <input
                                                    type="password"
                                                    value={apiKey()}
                                                    onInput={(e,) => setApiKey(e.currentTarget.value,)}
                                                    placeholder="API key if required"
                                                />
                                            </FormField>
                                        </>
                                    }>
                                        <FormField label="App ID" hint="From your Meta Developer App at developers.facebook.com">
                                            <input
                                                type="text"
                                                value={appId()}
                                                onInput={(e,) => setAppId(e.currentTarget.value,)}
                                                placeholder="Meta App ID"
                                            />
                                        </FormField>
                                        <FormField label="App Secret">
                                            <input
                                                type="password"
                                                value={appSecret()}
                                                onInput={(e,) => setAppSecret(e.currentTarget.value,)}
                                                placeholder={conn()?.credentials?.hasAppSecret ?
                                                    'Secret saved (enter new to replace)' :
                                                    'Meta App Secret'}
                                            />
                                        </FormField>
                                        <Show when={isConnected()}>
                                            <div class="alert alert--success" style={{ 'margin-bottom': '1rem', }}>
                                                Connected as @{conn()?.displayName}.
                                                Token auto-refreshes every 7 days.
                                                <Show when={conn()?.credentials?.tokenExpiresAt}>
                                                    {' '}{formatExpiry(conn()?.credentials?.tokenExpiresAt,)}.
                                                </Show>
                                            </div>
                                        </Show>
                                        <Show when={!isConnected()}>
                                            <div class="form-help" style={{ 'margin-bottom': '0.75rem', }}>
                                                Save your App ID and Secret first, then click "Authorize" to
                                                connect your {provider.name} account via OAuth.
                                            </div>
                                        </Show>
                                    </Show>

                                    <div class="form-group">
                                        <Toggle checked={enabled()} onChange={setEnabled} label="Enabled" />
                                    </div>
                                    <div class="form-group">
                                        <Toggle checked={autoPublish()} onChange={setAutoPublish} label="Auto-publish posts" />
                                    </div>
                                    <Show when={autoPublish()}>
                                        <div class="form-group" style={{ 'padding-left': '1.5rem', }}>
                                            <Toggle
                                                checked={publishAll()}
                                                onChange={(next,) => {
                                                    setPublishAll(next,);
                                                    if (next) setAutoPublishCount(null,);
                                                }}
                                                label="Publish all posts"
                                            />
                                            <Show when={!publishAll()}>
                                                <div style={{ 'margin-top': '0.5rem', }}>
                                                    <label>Number of recent posts</label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max="100"
                                                        value={autoPublishCount() || ''}
                                                        onInput={(e,) =>
                                                            setAutoPublishCount(
                                                                parseInt(e.currentTarget.value,) || null,
                                                            )}
                                                        style={{ width: '100px', }}
                                                    />
                                                </div>
                                            </Show>
                                        </div>
                                    </Show>
                                    <div class="form-actions u-flex-row" style={{ 'margin-top': '1rem', }}>
                                        <button class="btn btn--primary btn--small" onClick={handleSaveConnection}>
                                            Save
                                        </button>
                                        <Show when={provider.oauth && (conn()?.credentials?.hasAppSecret || appSecret())}>
                                            <button
                                                class="btn btn--small"
                                                style={{ background: '#1877f2', color: '#fff', }}
                                                onClick={() => handleOAuthConnect(provider.id,)}
                                                disabled={oauthLoading()}
                                            >
                                                {oauthLoading() ? 'Redirecting...' :
                                                    isConnected() ? 'Reconnect' : `Authorize ${provider.name}`}
                                            </button>
                                        </Show>
                                        <button class="btn btn--secondary btn--small" onClick={cancelEditing}>
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </Show>
                        </div>
                    );
                }}
            </For>
        </div>
    );
};

export default ConnectionsPanel;
