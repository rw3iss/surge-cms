import { Title, } from '@solidjs/meta';
import { useNavigate, useParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, Show, } from 'solid-js';
import { api, } from '../../services/api';

const PROVIDER_NAMES: Record<string, string> = {
    instagram: 'Instagram',
    facebook: 'Facebook',
    tiktok: 'TikTok',
    patreon: 'Patreon',
    youtube: 'YouTube',
    twitter: 'Twitter',
};

const AdminConnectionEditor: Component = () => {
    const params = useParams();
    const navigate = useNavigate();
    const provider = () => params.provider;
    const providerName = () => PROVIDER_NAMES[provider()] || provider();

    const [connection,] = createResource(() => provider(), async (p,) => {
        const response = await api.get(`/connections/${p}`,);
        return response.success ? (response as any).data : null;
    },);

    const [enabled, setEnabled,] = createSignal(true,);
    const [autoPublish, setAutoPublish,] = createSignal(false,);
    const [autoPublishCount, setAutoPublishCount,] = createSignal<number | null>(null,);
    const [publishAll, setPublishAll,] = createSignal(false,);
    const [accessToken, setAccessToken,] = createSignal('',);
    const [apiKey, setApiKey,] = createSignal('',);
    const [error, setError,] = createSignal('',);
    const [success, setSuccess,] = createSignal(false,);

    createEffect(() => {
        const c = connection();
        if (c) {
            setEnabled(c.enabled !== false,);
            setAutoPublish(c.autoPublish || false,);
            setAutoPublishCount(c.autoPublishCount || null,);
            setPublishAll(!c.autoPublishCount,);
            setAccessToken(c.credentials?.accessToken || '',);
            setApiKey(c.credentials?.apiKey || '',);
        }
    },);

    const handleSave = async () => {
        setError('',);
        setSuccess(false,);

        const data = {
            provider: provider(),
            enabled: enabled(),
            autoPublish: autoPublish(),
            autoPublishCount: publishAll() ? null : (autoPublishCount() || null),
            credentials: {
                accessToken: accessToken() || undefined,
                apiKey: apiKey() || undefined,
            },
        };

        const response = connection() ?
            await api.put(`/connections/${provider()}`, data,) :
            await api.post('/connections', data,);

        if (response.success) {
            setSuccess(true,);
        } else {
            setError((response as any).error?.message || 'Failed to save connection',);
        }
    };

    return (
        <div>
            <Title>{providerName()} Connection - Admin - RW</Title>
            <div class="admin-header">
                <h1>{connection() ? 'Edit' : 'Connect'} {providerName()}</h1>
            </div>
            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>
            <Show when={success()}>
                <div class="alert alert--success">Connection saved successfully.</div>
            </Show>
            <div class="admin-form">
                <div class="form-section">
                    <h2>Credentials</h2>
                    <div class="form-group">
                        <label>Access Token</label>
                        <input
                            type="password"
                            value={accessToken()}
                            onInput={(e,) => setAccessToken(e.currentTarget.value,)}
                            placeholder="Paste access token"
                        />
                        <span class="form-help">OAuth access token for {providerName()} API</span>
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
                </div>
                <div class="form-section">
                    <h2>Settings</h2>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input
                                type="checkbox"
                                checked={enabled()}
                                onChange={(e,) => setEnabled(e.currentTarget.checked,)}
                            />
                            Enabled
                        </label>
                        <span class="form-help">When disabled, this connection won't sync or auto-publish.</span>
                    </div>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input
                                type="checkbox"
                                checked={autoPublish()}
                                onChange={(e,) => setAutoPublish(e.currentTarget.checked,)}
                            />
                            Auto-publish posts
                        </label>
                        <span class="form-help">Automatically import and publish posts from {providerName()}.</span>
                    </div>
                    <Show when={autoPublish()}>
                        <div class="form-group" style={{ 'margin-left': '1.5rem', }}>
                            <label class="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={publishAll()}
                                    onChange={(e,) => {
                                        setPublishAll(e.currentTarget.checked,);
                                        if (e.currentTarget.checked) setAutoPublishCount(null,);
                                    }}
                                />
                                Publish all posts
                            </label>
                            <Show when={!publishAll()}>
                                <div style={{ 'margin-top': '0.5rem', }}>
                                    <label>Number of recent posts to publish</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="100"
                                        value={autoPublishCount() || ''}
                                        onInput={(e,) => setAutoPublishCount(parseInt(e.currentTarget.value,) || null,)}
                                        style={{ width: '100px', }}
                                    />
                                </div>
                            </Show>
                        </div>
                    </Show>
                </div>
                <div class="form-actions">
                    <button class="btn btn--primary" onClick={handleSave}>
                        {connection() ? 'Save Changes' : 'Connect'}
                    </button>
                    <button class="btn btn--secondary" onClick={() => navigate('/admin/connections',)}>Cancel</button>
                </div>
            </div>
        </div>
    );
};

export default AdminConnectionEditor;
