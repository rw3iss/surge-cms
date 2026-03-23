import { Title, } from '@solidjs/meta';
import { Component, createEffect, createResource, createSignal, For, lazy, Show, } from 'solid-js';
import { api, } from '../../services/api';

const HeroContentEditor = lazy(() => import('../../components/admin/HeroContentEditor'));

// ─── Collapsible Section ───

function CollapsibleSection(props: { title: string; defaultOpen?: boolean; children: any; },) {
    const [open, setOpen,] = createSignal(props.defaultOpen ?? true,);
    return (
        <div class={`settings-section ${open() ? 'settings-section--open' : ''}`}>
            <button
                type="button"
                class="settings-section__header"
                onClick={() => setOpen(!open(),)}
            >
                <h2>{props.title}</h2>
                <span class="settings-section__chevron">{open() ? '\u25B2' : '\u25BC'}</span>
            </button>
            <Show when={open()}>
                <div class="settings-section__body">
                    {props.children}
                </div>
            </Show>
        </div>
    );
}

// ─── Connection Editor (inline) ───

const PROVIDERS = [
    { id: 'instagram', name: 'Instagram', icon: 'IG', },
    { id: 'facebook', name: 'Facebook', icon: 'FB', },
    { id: 'tiktok', name: 'TikTok', icon: 'TT', },
    { id: 'patreon', name: 'Patreon', icon: 'PA', },
    { id: 'youtube', name: 'YouTube', icon: 'YT', },
    { id: 'twitter', name: 'Twitter/X', icon: 'TW', },
];

function ConnectionsPanel() {
    const [connections, { refetch, },] = createResource(async () => {
        const response = await api.get('/connections',);
        return response.success ? (response as any).data : [];
    },);
    const [editingProvider, setEditingProvider,] = createSignal<string | null>(null,);

    // Inline editor state
    const [enabled, setEnabled,] = createSignal(true,);
    const [autoPublish, setAutoPublish,] = createSignal(false,);
    const [autoPublishCount, setAutoPublishCount,] = createSignal<number | null>(null,);
    const [publishAll, setPublishAll,] = createSignal(false,);
    const [accessToken, setAccessToken,] = createSignal('',);
    const [apiKey, setApiKey,] = createSignal('',);
    const [connError, setConnError,] = createSignal('',);
    const [connSuccess, setConnSuccess,] = createSignal(false,);

    const getConnection = (providerId: string,) => connections()?.find((c: any,) => c.provider === providerId);

    const startEditing = (providerId: string,) => {
        const conn = getConnection(providerId,);
        setEnabled(conn?.enabled !== false,);
        setAutoPublish(conn?.autoPublish || false,);
        setAutoPublishCount(conn?.autoPublishCount || null,);
        setPublishAll(!conn?.autoPublishCount,);
        setAccessToken(conn?.credentials?.accessToken || '',);
        setApiKey(conn?.credentials?.apiKey || '',);
        setConnError('',);
        setConnSuccess(false,);
        setEditingProvider(providerId,);
    };

    const cancelEditing = () => setEditingProvider(null,);

    const handleSaveConnection = async () => {
        const provider = editingProvider();
        if (!provider) return;
        setConnError('',);
        setConnSuccess(false,);

        const data = {
            provider,
            enabled: enabled(),
            autoPublish: autoPublish(),
            autoPublishCount: publishAll() ? null : (autoPublishCount() || null),
            credentials: {
                accessToken: accessToken() || undefined,
                apiKey: apiKey() || undefined,
            },
        };

        const conn = getConnection(provider,);
        const response = conn ?
            await api.put(`/connections/${provider}`, data,) :
            await api.post('/connections', data,);

        if (response.success) {
            setConnSuccess(true,);
            setEditingProvider(null,);
            refetch();
        } else {
            setConnError((response as any).error?.message || 'Failed to save',);
        }
    };

    const handleDisconnect = async (provider: string,) => {
        if (!confirm(`Disconnect ${provider}? This will remove stored credentials.`,)) return;
        await api.delete(`/connections/${provider}`,);
        refetch();
    };

    return (
        <div class="connections-list">
            <Show when={connSuccess()}>
                <div class="alert alert--success" style={{ 'margin-bottom': '1rem', }}>Connection saved.</div>
            </Show>
            <For each={PROVIDERS}>
                {(provider,) => {
                    const conn = () => getConnection(provider.id,);
                    const isEditing = () => editingProvider() === provider.id;
                    return (
                        <div
                            class={`connection-card ${conn() ? 'connection-card--connected' : ''} ${
                                isEditing() ? 'connection-card--editing' : ''
                            }`}
                        >
                            <div class="connection-card__row">
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
                                    <Show when={!isEditing()}>
                                        <button
                                            class="btn btn--small btn--secondary"
                                            onClick={() => startEditing(provider.id,)}
                                        >
                                            {conn() ? 'Edit' : 'Connect'}
                                        </button>
                                        <Show when={conn()}>
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
                                    <div class="form-group">
                                        <label>Access Token</label>
                                        <input
                                            type="password"
                                            value={accessToken()}
                                            onInput={(e,) => setAccessToken(e.currentTarget.value,)}
                                            placeholder="Paste access token"
                                        />
                                        <span class="form-help">OAuth access token for {provider.name} API</span>
                                    </div>
                                    <div class="form-group">
                                        <label>API Key (optional)</label>
                                        <input
                                            type="password"
                                            value={apiKey()}
                                            onInput={(e,) => setApiKey(e.currentTarget.value,)}
                                            placeholder="API key if required"
                                        />
                                    </div>
                                    <div class="form-group">
                                        <label class="checkbox-label">
                                            <input
                                                type="checkbox"
                                                checked={enabled()}
                                                onChange={(e,) => setEnabled(e.currentTarget.checked,)}
                                            />
                                            <span>Enabled</span>
                                        </label>
                                    </div>
                                    <div class="form-group">
                                        <label class="checkbox-label">
                                            <input
                                                type="checkbox"
                                                checked={autoPublish()}
                                                onChange={(e,) => setAutoPublish(e.currentTarget.checked,)}
                                            />
                                            <span>Auto-publish posts</span>
                                        </label>
                                    </div>
                                    <Show when={autoPublish()}>
                                        <div class="form-group" style={{ 'padding-left': '1.5rem', }}>
                                            <label class="checkbox-label">
                                                <input
                                                    type="checkbox"
                                                    checked={publishAll()}
                                                    onChange={(e,) => {
                                                        setPublishAll(e.currentTarget.checked,);
                                                        if (e.currentTarget.checked) setAutoPublishCount(null,);
                                                    }}
                                                />
                                                <span>Publish all posts</span>
                                            </label>
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
                                    <div class="form-actions" style={{ 'margin-top': '1rem', }}>
                                        <button class="btn btn--primary btn--small" onClick={handleSaveConnection}>
                                            Save
                                        </button>
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
}

// ─── Main Settings Page ───

const AdminSettings: Component = () => {
    const [settings, { refetch, },] = createResource(async () => {
        const response = await api.get('/settings',);
        return response.success ? (response as any).data : {};
    },);

    const [siteName, setSiteName,] = createSignal('',);
    const [siteDescription, setSiteDescription,] = createSignal('',);
    const [contactEmail, setContactEmail,] = createSignal('',);
    const [analyticsId, setAnalyticsId,] = createSignal('',);
    const [saving, setSaving,] = createSignal(false,);
    const [success, setSuccess,] = createSignal(false,);

    createEffect(() => {
        const s = settings();
        if (!s) return;
        setSiteName(getValue(s, 'site_name', '',),);
        setSiteDescription(getValue(s, 'site_description', '',),);
        setContactEmail(getValue(s, 'contact_email', '',),);
        const analytics = getValue(s, 'analytics', null,);
        if (analytics && typeof analytics === 'object') {
            setAnalyticsId((analytics as any).googleAnalyticsId || '',);
        }
    },);

    function getValue(s: any, key: string, fallback: any,): any {
        if (s[key] && s[key].value !== undefined) return s[key].value;
        return fallback;
    }

    const handleSubmit = async (e: Event,) => {
        e.preventDefault();
        setSaving(true,);
        setSuccess(false,);

        const data: Record<string, any> = {
            siteName: siteName(),
            siteDescription: siteDescription(),
            contactEmail: contactEmail() || undefined,
        };
        if (analyticsId()) {
            data.analytics = { googleAnalyticsId: analyticsId(), };
        }

        await api.put('/settings', data,);
        setSaving(false,);
        setSuccess(true,);
        refetch();
    };

    return (
        <div>
            <Title>Settings - Admin - Surge Media</Title>
            <div class="admin-header">
                <h1>Settings</h1>
            </div>

            <Show when={success()}>
                <div class="alert alert--success">Settings saved successfully.</div>
            </Show>

            <div class="settings-sections">
                <CollapsibleSection title="General" defaultOpen={true}>
                    <form onSubmit={handleSubmit}>
                        <div class="form-group">
                            <label>Site Name</label>
                            <input
                                type="text"
                                value={siteName()}
                                onInput={(e,) => setSiteName(e.currentTarget.value,)}
                            />
                        </div>
                        <div class="form-group">
                            <label>Site Description</label>
                            <input
                                type="text"
                                value={siteDescription()}
                                onInput={(e,) => setSiteDescription(e.currentTarget.value,)}
                            />
                        </div>
                        <div class="form-group">
                            <label>Contact Email</label>
                            <input
                                type="email"
                                value={contactEmail()}
                                onInput={(e,) => setContactEmail(e.currentTarget.value,)}
                            />
                        </div>

                        <h3
                            style={{
                                'margin-top': '1.5rem',
                                'margin-bottom': '0.75rem',
                                'font-size': '0.9rem',
                                'font-weight': '600',
                                'color': '#666',
                            }}
                        >
                            Integrations
                        </h3>
                        <div class="form-group">
                            <label>Google Analytics ID</label>
                            <input
                                type="text"
                                value={analyticsId()}
                                onInput={(e,) => setAnalyticsId(e.currentTarget.value,)}
                            />
                            <span class="form-help">Measurement ID (e.g. G-XXXXXXX)</span>
                        </div>

                        <div class="form-actions">
                            <button type="submit" class="btn btn--primary" disabled={saving()}>
                                {saving() ? 'Saving...' : 'Save Settings'}
                            </button>
                        </div>
                    </form>
                </CollapsibleSection>

                <CollapsibleSection title="Home Page" defaultOpen={true}>
                    <HeroContentEditor />
                </CollapsibleSection>

                <CollapsibleSection title="Connections" defaultOpen={true}>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Connect your social media accounts to import and auto-publish content.
                    </p>
                    <ConnectionsPanel />
                </CollapsibleSection>
            </div>
        </div>
    );
};

export default AdminSettings;
