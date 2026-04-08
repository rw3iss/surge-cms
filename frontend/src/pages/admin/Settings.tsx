import { Title, } from '@solidjs/meta';
import { useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, lazy, onMount, Show, } from 'solid-js';
import MediaSelectModal from '../../components/admin/MediaSelectModal';
import MediaUploadModal from '../../components/admin/MediaUploadModal';
import ColorPicker from '../../components/admin/ColorPicker';
import ColorWheel from '../../components/admin/ColorWheel';
import Tooltip from '../../components/admin/Tooltip';
import { api, fetchAppearance, fetchSiteBranding, saveAppearance, saveSiteBranding, } from '../../services/api';
import { getSiteColors, saveSiteColors, } from '../../services/siteColors';

const HeroContentEditor = lazy(() => import('../../components/admin/HeroContentEditor'));
const SiteHeaderEditor = lazy(() => import('../../components/admin/SiteHeaderEditor'));

// ─── Tabs ───

const TABS = [
    { id: 'general', label: 'General', },
    { id: 'appearance', label: 'Appearance', },
    { id: 'site-header', label: 'Site Header', },
    { id: 'homepage', label: 'Home Page', },
    { id: 'connections', label: 'Connections', },
] as const;

type TabId = typeof TABS[number]['id'];

// ─── Connection Editor (inline) ───

const PROVIDERS = [
    { id: 'instagram', name: 'Instagram', icon: 'IG', oauth: true, },
    { id: 'facebook', name: 'Facebook', icon: 'FB', oauth: false, },
    { id: 'tiktok', name: 'TikTok', icon: 'TT', oauth: false, },
    { id: 'patreon', name: 'Patreon', icon: 'PA', oauth: false, },
    { id: 'youtube', name: 'YouTube', icon: 'YT', oauth: false, },
    { id: 'twitter', name: 'Twitter/X', icon: 'TW', oauth: false, },
];

function ConnectionsPanel() {
    const [searchParams, setSearchParams,] = useSearchParams();  // eslint-disable-line
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
    const [appId, setAppId,] = createSignal('',);
    const [appSecret, setAppSecret,] = createSignal('',);
    const [connError, setConnError,] = createSignal('',);
    const [connSuccess, setConnSuccess,] = createSignal('',);
    const [oauthLoading, setOauthLoading,] = createSignal(false,);

    // Handle OAuth callback params
    onMount(() => {
        if (searchParams.oauth_success) {
            setConnSuccess(`${searchParams.oauth_success} connected successfully!`,);
            refetch();
            setSearchParams({ oauth_success: undefined, },);
        }
        if (searchParams.oauth_error) {
            setConnError(decodeURIComponent(searchParams.oauth_error,),);
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

        const data = {
            provider,
            enabled: enabled(),
            autoPublish: autoPublish(),
            autoPublishCount: publishAll() ? null : (autoPublishCount() || null),
            credentials,
        };

        const conn = getConnection(provider,);
        const response = conn ?
            await api.put(`/connections/${provider}`, data,) :
            await api.post('/connections', data,);

        if (response.success) {
            setConnSuccess('Connection saved.',);
            setEditingProvider(null,);
            refetch();
        } else {
            setConnError((response as any).error?.message || 'Failed to save',);
        }
    };

    const handleOAuthConnect = async (provider: string,) => {
        setOauthLoading(true,);
        setConnError('',);

        try {
            const response = await api.get(`/connections/${provider}/oauth/authorize`,);
            if (response.success && (response as any).data?.authUrl) {
                window.location.href = (response as any).data.authUrl;
            } else {
                setConnError((response as any).error?.message || 'Failed to start OAuth flow',);
                setOauthLoading(false,);
            }
        } catch {
            setConnError('Failed to start OAuth flow',);
            setOauthLoading(false,);
        }
    };

    const handleDisconnect = async (provider: string,) => {
        const providerName = PROVIDERS.find((p,) => p.id === provider)?.name || provider;
        if (!confirm(`Disconnect ${providerName}? This will remove the access token and stop auto-refresh.`,)) return;

        const response = await api.delete(`/connections/${provider}`,);
        if (response.success) {
            setConnSuccess(`${providerName} disconnected.`,);
            refetch();
        } else {
            setConnError((response as any).error?.message || 'Failed to disconnect',);
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
                                            <div class="form-group">
                                                <label>Access Token</label>
                                                <input
                                                    type="password"
                                                    value={accessToken()}
                                                    onInput={(e,) => setAccessToken(e.currentTarget.value,)}
                                                    placeholder={conn()?.credentials?.hasAccessToken ?
                                                        'Token saved (enter new to replace)' :
                                                        'Paste access token'}
                                                />
                                                <span class="form-help">API access token for {provider.name}</span>
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
                                        </>
                                    }>
                                        <div class="form-group">
                                            <label>App ID</label>
                                            <input
                                                type="text"
                                                value={appId()}
                                                onInput={(e,) => setAppId(e.currentTarget.value,)}
                                                placeholder="Meta App ID"
                                            />
                                            <span class="form-help">
                                                From your Meta Developer App at developers.facebook.com
                                            </span>
                                        </div>
                                        <div class="form-group">
                                            <label>App Secret</label>
                                            <input
                                                type="password"
                                                value={appSecret()}
                                                onInput={(e,) => setAppSecret(e.currentTarget.value,)}
                                                placeholder={conn()?.credentials?.hasAppSecret ?
                                                    'Secret saved (enter new to replace)' :
                                                    'Meta App Secret'}
                                            />
                                        </div>
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
                                    <div class="form-actions" style={{ 'margin-top': '1rem', gap: '0.5rem', display: 'flex', }}>
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
}

// ─── Site Colors Panel ───

function isValidHex(hex: string,): boolean {
    return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex,);
}

function SiteColorsPanel() {
    const [colors, setColors,] = createSignal<string[]>([],);
    const [editingIndex, setEditingIndex,] = createSignal<number | null>(null,);
    const [editingColor, setEditingColor,] = createSignal('#ffffff',);
    const [showWheel, setShowWheel,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    onMount(async () => {
        const list = await getSiteColors();
        setColors(list,);
    },);

    const persist = async (next: string[],) => {
        const ok = await saveSiteColors(next,);
        if (!ok) {
            setError('Failed to save site colors',);
            return false;
        }
        setError('',);
        return true;
    };

    const handleSwatchClick = (index: number,) => {
        setEditingIndex(index,);
        setEditingColor(colors()[index] || '#ffffff',);
        setShowWheel(false,);
    };

    const handleAddSwatch = async () => {
        const next = [...colors(), '#ffffff',];
        if (await persist(next,)) {
            setColors(next,);
            setEditingIndex(next.length - 1,);
            setEditingColor('#ffffff',);
            setShowWheel(true,);
        }
    };

    const handleAcceptColor = async () => {
        const idx = editingIndex();
        if (idx === null) return;
        const next = [...colors(),];
        next[idx] = editingColor();
        if (await persist(next,)) {
            setColors(next,);
            setEditingIndex(null,);
            setShowWheel(false,);
        }
    };

    const handleDeleteSwatch = async () => {
        const idx = editingIndex();
        if (idx === null) return;
        const next = colors().filter((_, i,) => i !== idx);
        if (await persist(next,)) {
            setColors(next,);
            setEditingIndex(null,);
            setShowWheel(false,);
        }
    };

    const handleHexInput = (value: string,) => {
        let v = value.trim();
        if (v && !v.startsWith('#',)) v = '#' + v;
        setEditingColor(v,);
    };

    return (
        <div class="site-colors-panel">
            <Show when={error()}>
                <div class="alert alert--error" style={{ 'margin-bottom': '0.75rem', }}>{error()}</div>
            </Show>

            <div class="site-colors-grid">
                <For each={colors()}>
                    {(color, index,) => (
                        <button
                            type="button"
                            class={`site-colors-grid__swatch ${
                                editingIndex() === index() ? 'site-colors-grid__swatch--active' : ''
                            }`}
                            style={{ background: color, }}
                            onClick={() => handleSwatchClick(index(),)}
                            title={color}
                        />
                    )}
                </For>
                <button
                    type="button"
                    class="site-colors-grid__swatch site-colors-grid__swatch--add"
                    onClick={handleAddSwatch}
                    title="Add color"
                >
                    +
                </button>
            </div>

            <Show when={editingIndex() !== null}>
                <div class="site-colors-editor">
                    <div class="site-colors-editor__row">
                        <button
                            type="button"
                            class={`site-colors-editor__preview ${
                                showWheel() ? 'site-colors-editor__preview--active' : ''
                            }`}
                            style={{ background: isValidHex(editingColor(),) ? editingColor() : '#fff', }}
                            onClick={() => setShowWheel(!showWheel(),)}
                            title={showWheel() ? 'Close color wheel' : 'Open color wheel'}
                        />
                        <input
                            type="text"
                            class="site-colors-editor__hex"
                            value={editingColor()}
                            onInput={(e,) => handleHexInput(e.currentTarget.value,)}
                            placeholder="#ffffff"
                            maxLength={7}
                        />
                    </div>

                    <Show when={showWheel()}>
                        <div class="site-colors-editor__wheel-wrap">
                            <ColorWheel
                                value={editingColor()}
                                onChange={(c,) => setEditingColor(c.hex,)}
                                size={260}
                            />
                        </div>
                    </Show>

                    <div class="site-colors-editor__actions">
                        <button class="btn btn--primary btn--small" onClick={handleAcceptColor}>
                            Accept
                        </button>
                        <button class="btn btn--secondary btn--small" onClick={() => setEditingIndex(null,)}>
                            Cancel
                        </button>
                        <button
                            class="btn btn--ghost btn--small"
                            style={{ color: '#dc3545', 'margin-left': 'auto', }}
                            onClick={handleDeleteSwatch}
                        >
                            Delete Swatch
                        </button>
                    </div>
                </div>
            </Show>
        </div>
    );
}

// ─── Appearance Panel ───

// Reusable theme field row with label, control, optional sublabel, and tooltip
function ThemeField(props: {
    label: string;
    sublabel?: string;
    tooltip?: string;
    children: any;
},) {
    return (
        <div class="theme-field">
            <div class="theme-field__label-group">
                <label class="theme-field__label">
                    {props.label}
                    <Show when={props.tooltip}>
                        <Tooltip content={props.tooltip!} header={props.label} />
                    </Show>
                </label>
                <Show when={props.sublabel}>
                    <span class="theme-field__sublabel">{props.sublabel}</span>
                </Show>
            </div>
            <div class="theme-field__control">
                {props.children}
            </div>
        </div>
    );
}

function AppearancePanel() {
    // Colors
    const [backgroundColor, setBackgroundColor,] = createSignal('#ffffff',);
    const [textColor, setTextColor,] = createSignal('#1a1a1a',);
    const [primaryColor, setPrimaryColor,] = createSignal('#e63946',);
    const [linkColor, setLinkColor,] = createSignal('#e63946',);
    const [headingColor, setHeadingColor,] = createSignal('#1a1a1a',);
    const [borderColor, setBorderColor,] = createSignal('#e5e7eb',);

    // Typography
    const [fontFamily, setFontFamily,] = createSignal('Inter, -apple-system, sans-serif',);
    const [headingFontFamily, setHeadingFontFamily,] = createSignal('Inter, -apple-system, sans-serif',);
    const [fontSize, setFontSize,] = createSignal(16,);
    const [headingWeight, setHeadingWeight,] = createSignal('700',);
    const [lineHeight, setLineHeight,] = createSignal('1.5',);

    // Layout
    const [gutterWidth, setGutterWidth,] = createSignal('',);
    const [borderRadius, setBorderRadius,] = createSignal('',);
    const [maxContentWidth, setMaxContentWidth,] = createSignal('',);
    const [blockPadding, setBlockPadding,] = createSignal('',);

    const [isDirty, setIsDirty,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [success, setSuccess,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    onMount(async () => {
        try {
            const res = await fetchAppearance();
            if (res.success && res.data) {
                const d = res.data as any;
                if (d.backgroundColor) setBackgroundColor(d.backgroundColor,);
                if (d.textColor) setTextColor(d.textColor,);
                if (d.primaryColor) setPrimaryColor(d.primaryColor,);
                if (d.linkColor) setLinkColor(d.linkColor,);
                if (d.headingColor) setHeadingColor(d.headingColor,);
                if (d.borderColor) setBorderColor(d.borderColor,);
                if (d.fontFamily) setFontFamily(d.fontFamily,);
                if (d.headingFontFamily) setHeadingFontFamily(d.headingFontFamily,);
                if (d.fontSize) setFontSize(d.fontSize,);
                if (d.headingWeight) setHeadingWeight(d.headingWeight,);
                if (d.lineHeight) setLineHeight(d.lineHeight,);
                if (d.gutterWidth) setGutterWidth(d.gutterWidth,);
                if (d.borderRadius) setBorderRadius(d.borderRadius,);
                if (d.maxContentWidth) setMaxContentWidth(d.maxContentWidth,);
                if (d.blockPadding) setBlockPadding(d.blockPadding,);
            }
        } catch (e) {
            console.error('Failed to load appearance:', e,);
        }
    },);

    const markDirty = () => { setIsDirty(true,); setSuccess(false,); };

    const handleSave = async () => {
        setSaving(true,);
        setError('',);
        setSuccess(false,);

        try {
            const res = await saveAppearance({
                backgroundColor: backgroundColor(),
                textColor: textColor(),
                primaryColor: primaryColor(),
                linkColor: linkColor(),
                headingColor: headingColor(),
                borderColor: borderColor(),
                fontFamily: fontFamily(),
                headingFontFamily: headingFontFamily(),
                fontSize: fontSize(),
                headingWeight: headingWeight(),
                lineHeight: lineHeight(),
                gutterWidth: gutterWidth() || undefined,
                borderRadius: borderRadius() || undefined,
                maxContentWidth: maxContentWidth() || undefined,
                blockPadding: blockPadding() || undefined,
            },);

            if (res.success) {
                setIsDirty(false,);
                setSuccess(true,);
            } else {
                setError((res as any).error?.message || 'Failed to save',);
            }
        } catch {
            setError('Failed to save appearance settings',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="appearance-panel">
            <div class="appearance-panel__action-bar">
                <button
                    class="btn btn--primary"
                    disabled={!isDirty() || saving()}
                    onClick={handleSave}
                >
                    {saving() ? 'Saving...' : 'Save Appearance'}
                </button>
                <Show when={success()}>
                    <span class="appearance-panel__saved">Saved.</span>
                </Show>
            </div>

            <Show when={error()}>
                <div class="alert alert--error" style={{ 'margin-bottom': '1rem', }}>{error()}</div>
            </Show>

            {/* ─── Colors ─── */}
            <div class="theme-section">
                <h4 class="theme-section__title">Colors</h4>
                <div class="theme-section__fields">
                    <ThemeField
                        label="Background"
                        sublabel="Page background color"
                        tooltip="The base background color for all pages on the site. Applied to the body element and inherited everywhere."
                    >
                        <ColorPicker value={backgroundColor()} onChange={(hex,) => { setBackgroundColor(hex,); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Text Color"
                        sublabel="Default text color"
                        tooltip="The default color for paragraph text and unstyled elements. Override individual blocks via their style settings."
                    >
                        <ColorPicker value={textColor()} onChange={(hex,) => { setTextColor(hex,); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Heading Color"
                        sublabel="H1–H6 color"
                        tooltip="Color applied to all heading elements (H1 through H6) on the site. Defaults to the text color if not set."
                    >
                        <ColorPicker value={headingColor()} onChange={(hex,) => { setHeadingColor(hex,); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Primary / Brand"
                        sublabel="Brand accent color"
                        tooltip="The main brand/accent color used for primary buttons, focus rings, and progress indicators."
                    >
                        <ColorPicker value={primaryColor()} onChange={(hex,) => { setPrimaryColor(hex,); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Link Color"
                        sublabel="Hyperlink color"
                        tooltip="The color used for clickable text links on the public site. Defaults to the primary color if not set."
                    >
                        <ColorPicker value={linkColor()} onChange={(hex,) => { setLinkColor(hex,); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Item Border Color"
                        sublabel="Cards, form fields, list items"
                        tooltip="Color applied to borders around card-style items throughout the site: blog post cards, form answer choices, textareas, and other bordered elements."
                    >
                        <ColorPicker value={borderColor()} onChange={(hex,) => { setBorderColor(hex,); markDirty(); }} />
                    </ThemeField>
                </div>
            </div>

            {/* ─── Typography ─── */}
            <div class="theme-section">
                <h4 class="theme-section__title">Typography</h4>
                <div class="theme-section__fields">
                    <ThemeField
                        label="Body Font Family"
                        sublabel="CSS font-family stack"
                        tooltip="Default font for paragraph and body text. Use a CSS font-family stack like 'Inter, sans-serif' or 'Georgia, serif'."
                    >
                        <input
                            type="text"
                            value={fontFamily()}
                            onInput={(e,) => { setFontFamily(e.currentTarget.value,); markDirty(); }}
                            placeholder="Inter, sans-serif"
                            style={{ width: '320px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Heading Font Family"
                        sublabel="Font for H1–H6"
                        tooltip="Font stack used specifically for headings. Defaults to the body font family if not set."
                    >
                        <input
                            type="text"
                            value={headingFontFamily()}
                            onInput={(e,) => { setHeadingFontFamily(e.currentTarget.value,); markDirty(); }}
                            placeholder="Inter, sans-serif"
                            style={{ width: '320px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Base Font Size"
                        sublabel="Root rem unit (px)"
                        tooltip="The base font size in pixels. All rem-based sizing throughout the site scales from this value. Default: 16px."
                    >
                        <div style={{ display: 'flex', 'align-items': 'center', gap: '0.5rem', }}>
                            <button class="btn btn--secondary btn--small" onClick={() => { setFontSize(Math.max(10, fontSize() - 1,),); markDirty(); }}>-</button>
                            <span style={{ 'min-width': '40px', 'text-align': 'center', 'font-weight': '600', 'font-size': '0.875rem', }}>
                                {fontSize()}px
                            </span>
                            <button class="btn btn--secondary btn--small" onClick={() => { setFontSize(Math.min(32, fontSize() + 1,),); markDirty(); }}>+</button>
                        </div>
                    </ThemeField>

                    <ThemeField
                        label="Heading Weight"
                        sublabel="100–900"
                        tooltip="The CSS font-weight applied to all headings. Common values: 400 (normal), 600 (semibold), 700 (bold), 800 (extrabold)."
                    >
                        <select
                            value={headingWeight()}
                            onChange={(e,) => { setHeadingWeight(e.currentTarget.value,); markDirty(); }}
                            class="theme-field__input"
                            style={{ width: '140px', }}
                        >
                            <option value="400">400 — Normal</option>
                            <option value="500">500 — Medium</option>
                            <option value="600">600 — Semibold</option>
                            <option value="700">700 — Bold</option>
                            <option value="800">800 — Extrabold</option>
                            <option value="900">900 — Black</option>
                        </select>
                    </ThemeField>

                    <ThemeField
                        label="Line Height"
                        sublabel="Body text line spacing"
                        tooltip="Vertical space between lines of body text. Use a unitless multiplier like 1.5 (recommended) or a value with units."
                    >
                        <input
                            type="text"
                            value={lineHeight()}
                            onInput={(e,) => { setLineHeight(e.currentTarget.value,); markDirty(); }}
                            placeholder="1.5"
                            style={{ width: '140px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>
                </div>
            </div>

            {/* ─── Layout ─── */}
            <div class="theme-section">
                <h4 class="theme-section__title">Layout</h4>
                <div class="theme-section__fields">
                    <ThemeField
                        label="Site Gutter"
                        sublabel="Horizontal page padding"
                        tooltip="Horizontal padding applied to page content (posts, dynamic pages, donate, etc.). Header and carousel can opt in via their own settings. Use any CSS value: px, %, vw, em, rem."
                    >
                        <input
                            type="text"
                            value={gutterWidth()}
                            onInput={(e,) => { setGutterWidth(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 40px, 5%"
                            style={{ width: '200px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Border Radius"
                        sublabel="Default rounding"
                        tooltip="Default corner radius applied via the --site-radius CSS variable. Components can opt in to use this for consistent rounding."
                    >
                        <input
                            type="text"
                            value={borderRadius()}
                            onInput={(e,) => { setBorderRadius(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 8px, 0.5rem"
                            style={{ width: '200px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Max Content Width"
                        sublabel="Maximum text/content width"
                        tooltip="Maximum width of constrained content blocks. Use 'none' for no constraint, or a CSS value like '1200px' or '70rem'."
                    >
                        <input
                            type="text"
                            value={maxContentWidth()}
                            onInput={(e,) => { setMaxContentWidth(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 1200px, 70rem"
                            style={{ width: '200px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Block Default Padding"
                        sublabel="Default padding for all blocks"
                        tooltip="Default padding applied to all content blocks on pages and posts. Overridden by any custom block style padding. Use any CSS value like '1rem', '20px', or shorthand like '1rem 2rem'."
                    >
                        <input
                            type="text"
                            value={blockPadding()}
                            onInput={(e,) => { setBlockPadding(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 1rem, 20px"
                            style={{ width: '200px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>
                </div>
            </div>

            {/* ─── Site Colors Swatches ─── */}
            <div class="theme-section">
                <h4 class="theme-section__title">Color Swatches</h4>
                <p class="theme-section__description">
                    Manage the color swatches available throughout the admin color picker.
                </p>
                <SiteColorsPanel />
            </div>
        </div>
    );
}

// ─── Branding Media Selector ───

interface BrandingMediaRef {
    mediaId?: string;
    url?: string;
}

function BrandingMediaField(props: {
    label: string;
    value: BrandingMediaRef;
    onChange: (val: BrandingMediaRef,) => void;
},) {
    const [showSelect, setShowSelect,] = createSignal(false,);
    const [showUpload, setShowUpload,] = createSignal(false,);

    return (
        <div class="form-group">
            <label>{props.label}</label>
            <div style={{ display: 'flex', 'align-items': 'center', gap: '0.75rem', 'flex-wrap': 'wrap', }}>
                <Show when={props.value.url}>
                    <img
                        src={props.value.url}
                        alt={props.label}
                        style={{
                            'max-height': '40px',
                            'max-width': '120px',
                            'object-fit': 'contain',
                            border: '1px solid #ddd',
                            'border-radius': '4px',
                            padding: '2px',
                        }}
                    />
                </Show>
                <button
                    type="button"
                    class="btn btn--small btn--secondary"
                    onClick={() => setShowSelect(true,)}
                >
                    Select Media
                </button>
                <button
                    type="button"
                    class="btn btn--small btn--outline"
                    onClick={() => setShowUpload(true,)}
                >
                    Upload New
                </button>
                <Show when={props.value.url}>
                    <button
                        type="button"
                        class="btn btn--small btn--danger"
                        onClick={() => props.onChange({ mediaId: undefined, url: undefined, },)}
                        title={`Remove ${props.label}`}
                    >
                        &times;
                    </button>
                </Show>
            </div>

            <Show when={showSelect()}>
                <MediaSelectModal
                    types={['image',]}
                    onSelect={(media,) => {
                        props.onChange({ mediaId: media.id, url: media.url, },);
                        setShowSelect(false,);
                    }}
                    onClose={() => setShowSelect(false,)}
                />
            </Show>
            <Show when={showUpload()}>
                <MediaUploadModal
                    acceptTypes="image/*"
                    onUploaded={(media,) => {
                        props.onChange({ mediaId: media.id, url: media.url, },);
                        setShowUpload(false,);
                    }}
                    onClose={() => setShowUpload(false,)}
                />
            </Show>
        </div>
    );
}

// ─── Main Settings Page ───

const AdminSettings: Component = () => {
    const [searchParams, setSearchParams,] = useSearchParams();
    const [activeTab, setActiveTab,] = createSignal<TabId>(
        (searchParams.tab as TabId) || 'general',
    );

    // Switch to connections tab if returning from OAuth
    onMount(() => {
        if (searchParams.oauth_success || searchParams.oauth_error) {
            setActiveTab('connections',);
        }
    },);

    const handleTabChange = (tab: TabId,) => {
        setActiveTab(tab,);
        setSearchParams({ tab, },);
    };

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

    // Branding state
    const [logo, setLogo,] = createSignal<BrandingMediaRef>({},);
    const [favicon, setFavicon,] = createSignal<BrandingMediaRef>({},);

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

    // Load branding on mount
    onMount(async () => {
        try {
            const res = await fetchSiteBranding();
            if (res.success && res.data) {
                const data = res.data as any;
                if (data.logo) setLogo(data.logo,);
                if (data.favicon) setFavicon(data.favicon,);
            }
        } catch (e) {
            console.error('Failed to load branding:', e,);
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

        // Save branding separately
        await saveSiteBranding({
            logo: logo(),
            favicon: favicon(),
        },);

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

            <div class="settings-tabs">
                <For each={TABS}>
                    {(tab,) => (
                        <button
                            class={`settings-tabs__tab ${activeTab() === tab.id ? 'settings-tabs__tab--active' : ''}`}
                            onClick={() => handleTabChange(tab.id,)}
                        >
                            {tab.label}
                        </button>
                    )}
                </For>
            </div>

            <div class="settings-tab-content">
                {/* ─── General Tab ─── */}
                <Show when={activeTab() === 'general'}>
                    <Show when={success()}>
                        <div class="alert alert--success">Settings saved successfully.</div>
                    </Show>

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

                        <h3 class="settings-subheading">Branding</h3>

                        <BrandingMediaField
                            label="Logo"
                            value={logo()}
                            onChange={(val,) => setLogo(val,)}
                        />

                        <BrandingMediaField
                            label="Favicon"
                            value={favicon()}
                            onChange={(val,) => setFavicon(val,)}
                        />

                        <h3 class="settings-subheading">Integrations</h3>

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
                </Show>

                {/* ─── Appearance Tab ─── */}
                <Show when={activeTab() === 'appearance'}>
                    <AppearancePanel />
                </Show>

                {/* ─── Site Header Tab ─── */}
                <Show when={activeTab() === 'site-header'}>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Customize the site header with images, links, buttons, and spacers.
                    </p>
                    <SiteHeaderEditor />
                </Show>

                {/* ─── Home Page Tab ─── */}
                <Show when={activeTab() === 'homepage'}>
                    <HeroContentEditor />
                </Show>

                {/* ─── Connections Tab ─── */}
                <Show when={activeTab() === 'connections'}>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Connect your social media accounts to display posts on the homepage and embed in articles.
                    </p>
                    <ConnectionsPanel />
                </Show>
            </div>
        </div>
    );
};

export default AdminSettings;
