import { Title, } from '@solidjs/meta';
import { useNavigate, useParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, Show, } from 'solid-js';
import Toggle from '../../components/admin/common/Toggle';
import { cms, } from '../../services/cmsClient';

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
        try {
            return await cms.connections.getByProvider(p,) as any;
        } catch {
            return null;
        }
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

        try {
            if (connection()) {
                await cms.connections.update(provider(), data as any,);
            } else {
                await cms.connections.upsert(data as any,);
            }
            setSuccess(true,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save connection',);
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
                        <Toggle checked={enabled()} onChange={setEnabled} label="Enabled" />
                        <span class="form-help">When disabled, this connection won't sync or auto-publish.</span>
                    </div>
                    <div class="form-group">
                        <Toggle checked={autoPublish()} onChange={setAutoPublish} label="Auto-publish posts" />
                        <span class="form-help">Automatically import and publish posts from {providerName()}.</span>
                    </div>
                    <Show when={autoPublish()}>
                        <div class="form-group" style={{ 'margin-left': '1.5rem', }}>
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
