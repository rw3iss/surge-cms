import { Title, } from '@solidjs/meta';
import { useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, lazy, onMount, Show, } from 'solid-js';
import MediaSelectModal from '../../components/admin/media/MediaSelectModal';
import MediaUploadModal from '../../components/admin/media/MediaUploadModal';
import ColorPicker from '../../components/admin/appearance/ColorPicker';
import ColorWheel from '../../components/admin/appearance/ColorWheel';
import FontManagerPanel from '../../components/admin/appearance/FontManagerPanel';
import FontSelect from '../../components/admin/common/FontSelect';
import JobManagementPanel from '../../components/admin/panels/JobManagementPanel';
import SitemapPanel from '../../components/admin/panels/SitemapPanel';
import Tooltip from '../../components/admin/common/Tooltip';
import { cms, } from '../../services/cmsClient';
import { FeatureCascadeError, } from '@sitesurge/client';
import { fetchSwatchUsages, generateUniqueSwatchId, isValidSwatchId, loadSwatches, saveSwatches, swatches as swatchesSignal, } from '../../services/siteColors';
import type { SiteSwatch, } from '@sitesurge/types';
import { reloadAdminAppearance, } from '../../stores/adminAppearance';
import { reloadSiteSettings, } from '../../stores/siteSettings';
import FeatureToggleRow from '../../components/admin/features/FeatureToggleRow';
import Toggle from '../../components/admin/common/Toggle';
import { FEATURES, } from '../../config/features';

// HeroContentEditor is now used via the 'carousel' block type, not in Settings.
const SiteHeaderEditor = lazy(() => import('../../components/admin/editors/SiteHeaderEditor'));
const SiteFooterEditor = lazy(() => import('../../components/admin/editors/SiteFooterEditor'));
const ApiKeysPanel = lazy(() => import('../../components/admin/settings/ApiKeysPanel'));

// ─── Tabs ───

const TABS = [
    { id: 'general', label: 'General', },
    { id: 'appearance', label: 'Appearance', },
    { id: 'site-header', label: 'Site Header', },
    { id: 'site-footer', label: 'Site Footer', },
    { id: 'connections', label: 'Connections', },
    { id: 'api-keys', label: 'API Keys', },
    { id: 'admin', label: 'Admin', },
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

// ─── Feature toggle row ───
//
// Reused inside the General tab's Features section. Each row:
// label + description on the left, switch on the right. Description
// lives directly in-line rather than behind a tooltip — it's short
// enough that hiding it would add friction without saving space.

// (Legacy inline FeatureToggleRow removed — Features panel now renders
// via the dependency-aware FeatureToggleRow imported from
// `components/admin/features/`.)

function ConnectionsPanel() {
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
}

// ─── Site Colors Panel ───

function isValidHex(hex: string,): boolean {
    return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex,);
}

/**
 * Editor for the site swatch palette.
 *
 * Each swatch has:
 *   - hex: the concrete color
 *   - id: stable identifier referenced by `swatch:{id}` color values
 *         elsewhere in the app. Auto-generated by default; the user
 *         can override with a custom slug.
 *   - name: optional human-friendly label
 *
 * Edits are batched in a local `working` signal — nothing persists
 * until the user hits Accept on a row, at which point the whole list
 * is sent to PUT /settings/site-colors. Delete shows a usage-count
 * confirmation so the operator knows how many places will fall back.
 */
function SiteColorsPanel() {
    // Local working copy of the palette. We mutate this in-memory and
    // call `persist()` on every meaningful change (add / accept / delete)
    // so the canonical signal in services/siteColors stays in sync and
    // every other consumer (ColorPicker, public Layout) reactively
    // updates without reloading.
    const [working, setWorking,] = createSignal<SiteSwatch[]>([],);
    const [editingIndex, setEditingIndex,] = createSignal<number | null>(null,);
    const [draftHex, setDraftHex,] = createSignal('#ffffff',);
    const [draftId, setDraftId,] = createSignal('',);
    const [draftName, setDraftName,] = createSignal('',);
    const [showWheel, setShowWheel,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    // Delete-confirm state — when set, the modal is open.
    const [deleteTarget, setDeleteTarget,] = createSignal<SiteSwatch | null>(null,);
    const [deleteUsages, setDeleteUsages,] = createSignal<{ total: number; breakdown: Array<{ source: string; count: number; }>; } | null>(null,);
    const [deleteLoading, setDeleteLoading,] = createSignal(false,);

    onMount(async () => {
        const list = await loadSwatches();
        setWorking([...list,],);
    },);

    const persist = async (next: SiteSwatch[],) => {
        const ok = await saveSwatches(next,);
        if (!ok) {
            setError('Failed to save site colors',);
            return false;
        }
        setError('',);
        return true;
    };

    const startEditing = (index: number,) => {
        const s = working()[index];
        if (!s) return;
        setEditingIndex(index,);
        setDraftHex(s.hex,);
        setDraftId(s.id,);
        setDraftName(s.name || '',);
        setShowWheel(false,);
    };

    const cancelEditing = () => {
        setEditingIndex(null,);
        setShowWheel(false,);
        setError('',);
    };

    const handleAddSwatch = async () => {
        const next: SiteSwatch[] = [
            ...working(),
            { id: generateUniqueSwatchId(working(),), hex: '#ffffff', },
        ];
        if (await persist(next,)) {
            setWorking(next,);
            startEditing(next.length - 1,);
            setShowWheel(true,);
        }
    };

    const handleAcceptEdit = async () => {
        const idx = editingIndex();
        if (idx === null) return;
        const hex = draftHex().trim();
        if (!isValidHex(hex,)) { setError('Hex must look like #abc or #abcdef',); return; }

        // Validate ID — required, format, and uniqueness within the
        // list (allowing the row's own existing ID to stay).
        const id = draftId().trim();
        if (!isValidSwatchId(id,)) {
            setError('ID must be 1–32 characters: letters, digits, dash, or underscore.',);
            return;
        }
        const dup = working().some((s, i,) => i !== idx && s.id === id);
        if (dup) { setError(`Another swatch already uses the ID '${id}'.`,); return; }

        const next = working().map((s, i,) => i === idx ? {
            id,
            hex,
            ...(draftName().trim() ? { name: draftName().trim(), } : {}),
        } : s,);

        if (await persist(next,)) {
            setWorking(next,);
            setEditingIndex(null,);
            setShowWheel(false,);
        }
    };

    const requestDelete = async () => {
        const idx = editingIndex();
        if (idx === null) return;
        const target = working()[idx];
        if (!target) return;
        setDeleteTarget(target,);
        setDeleteLoading(true,);
        setDeleteUsages(null,);
        // Fire the usage count in the background so the modal can show
        // immediately with a "checking..." state and update when done.
        try {
            const report = await fetchSwatchUsages(target.id,);
            setDeleteUsages(report,);
        } finally {
            setDeleteLoading(false,);
        }
    };

    const confirmDelete = async () => {
        const target = deleteTarget();
        if (!target) return;
        const next = working().filter(s => s.id !== target.id);
        if (await persist(next,)) {
            setWorking(next,);
            setEditingIndex(null,);
            setShowWheel(false,);
            setDeleteTarget(null,);
            setDeleteUsages(null,);
        }
    };

    const cancelDelete = () => {
        setDeleteTarget(null,);
        setDeleteUsages(null,);
        setDeleteLoading(false,);
    };

    const handleHexInput = (value: string,) => {
        let v = value.trim();
        if (v && !v.startsWith('#',)) v = '#' + v;
        setDraftHex(v,);
    };

    // Use the shared signal as a fallback render source. We display the
    // local `working` list (which is also pushed to the signal on save),
    // but new tabs / components stay in sync via swatchesSignal.
    void swatchesSignal;

    return (
        <div class="site-colors-panel">
            <Show when={error()}>
                <div class="alert alert--error" style={{ 'margin-bottom': '0.75rem', }}>{error()}</div>
            </Show>

            <div class="site-colors-grid">
                <For each={working()}>
                    {(swatch, index,) => (
                        <button
                            type="button"
                            class={`site-colors-grid__swatch ${
                                editingIndex() === index() ? 'site-colors-grid__swatch--active' : ''
                            }`}
                            style={{ background: swatch.hex, }}
                            onClick={() => startEditing(index(),)}
                            title={swatch.name ? `${swatch.name} (${swatch.id} · ${swatch.hex})` : `${swatch.id} · ${swatch.hex}`}
                        >
                            <span class="site-colors-grid__swatch-id">{swatch.id}</span>
                        </button>
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
                            style={{ background: isValidHex(draftHex(),) ? draftHex() : '#fff', }}
                            onClick={() => setShowWheel(!showWheel(),)}
                            title={showWheel() ? 'Close color wheel' : 'Open color wheel'}
                        />
                        <input
                            type="text"
                            class="site-colors-editor__hex"
                            value={draftHex()}
                            onInput={(e,) => handleHexInput(e.currentTarget.value,)}
                            placeholder="#ffffff"
                            maxLength={7}
                        />
                    </div>

                    <div class="site-colors-editor__field-row">
                        <label class="site-colors-editor__field">
                            <span class="site-colors-editor__label">ID</span>
                            <input
                                type="text"
                                class="site-colors-editor__input site-colors-editor__input--mono"
                                value={draftId()}
                                onInput={(e,) => setDraftId(e.currentTarget.value,)}
                                placeholder="brand-red"
                                maxLength={32}
                            />
                            <span class="site-colors-editor__hint">
                                Stable identifier referenced as <code>swatch:{draftId() || 'id'}</code>
                            </span>
                        </label>
                        <label class="site-colors-editor__field">
                            <span class="site-colors-editor__label">Name (optional)</span>
                            <input
                                type="text"
                                class="site-colors-editor__input"
                                value={draftName()}
                                onInput={(e,) => setDraftName(e.currentTarget.value,)}
                                placeholder="Brand Red"
                                maxLength={64}
                            />
                            <span class="site-colors-editor__hint">Display label shown in pickers.</span>
                        </label>
                    </div>

                    <Show when={showWheel()}>
                        <div class="site-colors-editor__wheel-wrap">
                            <ColorWheel
                                value={draftHex()}
                                onChange={(c,) => setDraftHex(c.hex,)}
                                size={260}
                            />
                        </div>
                    </Show>

                    <div class="site-colors-editor__actions">
                        <button class="btn btn--primary btn--small" onClick={handleAcceptEdit}>
                            Accept
                        </button>
                        <button class="btn btn--secondary btn--small" onClick={cancelEditing}>
                            Cancel
                        </button>
                        <button
                            class="btn btn--ghost btn--small btn--danger-text"
                            style={{ 'margin-left': 'auto', }}
                            onClick={requestDelete}
                        >
                            Delete Swatch
                        </button>
                    </div>
                </div>
            </Show>

            <Show when={deleteTarget()}>
                {(() => {
                    const target = deleteTarget()!;
                    return (
                        <div
                            class="confirm-modal-overlay"
                            onClick={(e,) => { if (e.target === e.currentTarget) cancelDelete(); }}
                        >
                            <div class="confirm-modal">
                                <h3 class="confirm-modal__title">Delete swatch '{target.id}'?</h3>
                                <div class="confirm-modal__message">
                                    <Show when={deleteLoading()}>
                                        Checking how many places reference this swatch…
                                    </Show>
                                    <Show when={!deleteLoading() && deleteUsages()}>
                                        <Show
                                            when={(deleteUsages()?.total ?? 0) > 0}
                                            fallback={<>This swatch isn't referenced anywhere — safe to delete.</>}
                                        >
                                            <strong>{deleteUsages()!.total}</strong>{' '}
                                            {deleteUsages()!.total === 1 ? 'place references' : 'places reference'} this swatch.
                                            Those colors will fall back to their built-in defaults.
                                        </Show>
                                    </Show>
                                    <Show when={!deleteLoading() && (deleteUsages()?.breakdown?.length ?? 0) > 0}>
                                        <ul class="site-colors-usage-list">
                                            <For each={deleteUsages()!.breakdown}>
                                                {(b,) => (
                                                    <li>
                                                        <span class="site-colors-usage-list__source">{b.source}</span>
                                                        <span class="site-colors-usage-list__count">{b.count}</span>
                                                    </li>
                                                )}
                                            </For>
                                        </ul>
                                    </Show>
                                </div>
                                <div class="confirm-modal__actions">
                                    <button class="btn btn--secondary" onClick={cancelDelete}>
                                        Cancel
                                    </button>
                                    <button class="btn btn--danger" onClick={confirmDelete} disabled={deleteLoading()}>
                                        Delete swatch
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })()}
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
    const [primaryColor, setPrimaryColor,] = createSignal('#3498cf',);
    const [linkColor, setLinkColor,] = createSignal('#3498cf',);
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
    const [pagePadding, setPagePadding,] = createSignal('',);
    const [postPadding, setPostPadding,] = createSignal('',);
    const [borderRadius, setBorderRadius,] = createSignal('',);
    const [maxContentWidth, setMaxContentWidth,] = createSignal('',);
    const [blockPadding, setBlockPadding,] = createSignal('',);

    const [isDirty, setIsDirty,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [success, setSuccess,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    onMount(async () => {
        try {
            const d = await cms.settings.getAppearance() as any;
            if (d) {
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
                if (d.pagePadding) setPagePadding(d.pagePadding,);
                if (d.postPadding) setPostPadding(d.postPadding,);
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
            await cms.settings.appearance({
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
                pagePadding: pagePadding() || undefined,
                postPadding: postPadding() || undefined,
                borderRadius: borderRadius() || undefined,
                maxContentWidth: maxContentWidth() || undefined,
                blockPadding: blockPadding() || undefined,
            } as any,);

            // Appearance save also touches site_settings.site_appearance,
            // which the public settings endpoint includes. Refresh
            // the public settings store so the live Header / Footer
            // / SiteLogo pick up new colors / fonts immediately.
            await reloadSiteSettings();
            setIsDirty(false,);
            setSuccess(true,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save appearance settings',);
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

            {/* ─── Colors + Color Swatches (two columns) ─── */}
            <div class="theme-columns">
            <div class="theme-section">
                <h4 class="theme-section__title">Colors</h4>
                <div class="theme-section__fields">
                    <ThemeField
                        label="Background"
                        sublabel="Page background color"
                        tooltip="The base background color for all pages on the site. Applied to the body element and inherited everywhere."
                    >
                        <ColorPicker value={backgroundColor()} onChange={(hex,) => { setBackgroundColor(hex,); markDirty(); }} clearable onClear={() => { setBackgroundColor('',); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Text Color"
                        sublabel="Default text color"
                        tooltip="The default color for paragraph text and unstyled elements. Override individual blocks via their style settings."
                    >
                        <ColorPicker value={textColor()} onChange={(hex,) => { setTextColor(hex,); markDirty(); }} clearable onClear={() => { setTextColor('',); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Heading Color"
                        sublabel="H1–H6 color"
                        tooltip="Color applied to all heading elements (H1 through H6) on the site. Defaults to the text color if not set."
                    >
                        <ColorPicker value={headingColor()} onChange={(hex,) => { setHeadingColor(hex,); markDirty(); }} clearable onClear={() => { setHeadingColor('',); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Primary / Brand"
                        sublabel="Brand accent color"
                        tooltip="The main brand/accent color used for primary buttons, focus rings, and progress indicators."
                    >
                        <ColorPicker value={primaryColor()} onChange={(hex,) => { setPrimaryColor(hex,); markDirty(); }} clearable onClear={() => { setPrimaryColor('',); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Link Color"
                        sublabel="Hyperlink color"
                        tooltip="The color used for clickable text links on the public site. Defaults to the primary color if not set."
                    >
                        <ColorPicker value={linkColor()} onChange={(hex,) => { setLinkColor(hex,); markDirty(); }} clearable onClear={() => { setLinkColor('',); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Item Border Color"
                        sublabel="Cards, form fields, list items"
                        tooltip="Color applied to borders around card-style items throughout the site: blog post cards, form answer choices, textareas, and other bordered elements."
                    >
                        <ColorPicker value={borderColor()} onChange={(hex,) => { setBorderColor(hex,); markDirty(); }} clearable onClear={() => { setBorderColor('',); markDirty(); }} />
                    </ThemeField>
                </div>
            </div>

            {/* ─── Color Swatches (right column) ─── */}
            <div class="theme-section">
                <h4 class="theme-section__title">Color Swatches</h4>
                <p class="theme-section__description">
                    Manage the color swatches available throughout the admin color picker.
                </p>
                <SiteColorsPanel />
            </div>
            </div>

            {/* ─── Typography + Layout (two columns) ─── */}
            <div class="theme-columns">
            <div class="theme-section">
                <h4 class="theme-section__title">Typography</h4>
                <div class="theme-section__fields">
                    <ThemeField
                        label="Body Font Family"
                        sublabel="Site-wide default font"
                        tooltip="Default font for paragraph and body text across the whole site. Pick an uploaded font (managed below); anything that sets its own font overrides this."
                    >
                        <div style={{ width: '320px', }}>
                            <FontSelect
                                value={fontFamily()}
                                onChange={(v,) => { setFontFamily(v,); markDirty(); }}
                                noneLabel="Default (theme font)"
                            />
                        </div>
                    </ThemeField>

                    <ThemeField
                        label="Heading Font Family"
                        sublabel="Font for H1–H6"
                        tooltip="Font used specifically for headings across the site. Falls back to the body font when unset."
                    >
                        <div style={{ width: '320px', }}>
                            <FontSelect
                                value={headingFontFamily()}
                                onChange={(v,) => { setHeadingFontFamily(v,); markDirty(); }}
                                noneLabel="Default (body font)"
                            />
                        </div>
                    </ThemeField>

                    <ThemeField
                        label="Base Font Size"
                        sublabel="Root rem unit (px)"
                        tooltip="The base font size in pixels. All rem-based sizing throughout the site scales from this value. Default: 16px."
                    >
                        <div class="u-flex-row">
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
                        label="Page Padding"
                        sublabel="Top/bottom padding for pages that enable it"
                        tooltip="Vertical padding applied to the top and bottom of any page whose 'Apply Page Padding' toggle is on (default on). Kept separate from the Site Gutter so a page can take left/right gutter without vertical padding, or vice-versa. Default 0. Use any CSS padding value: '80px', '4rem 0', etc. Handy for pushing content below a floating header."
                    >
                        <input
                            type="text"
                            value={pagePadding()}
                            onInput={(e,) => { setPagePadding(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 80px, 4rem 0"
                            style={{ width: '200px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Post Padding"
                        sublabel="Padding for posts that enable it"
                        tooltip="Padding applied to any post whose 'Apply Post Padding' toggle is on (default on). Primarily top/bottom — the Site Gutter still handles left/right when its toggle is on. Default 0. Use any CSS padding value."
                    >
                        <input
                            type="text"
                            value={postPadding()}
                            onInput={(e,) => { setPostPadding(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 80px, 4rem 0"
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
            </div>

            {/* ─── Font manager ─── */}
            <FontManagerPanel />
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
            <div class="u-flex-row u-flex-wrap">
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

// ─── Admin Appearance Panel ───
//
// Color tokens scoped to the admin chrome — sidebar bg/text, page
// bg/text, and panel background. Backed by `site_settings.admin_appearance`
// (see backend GET/PUT /settings/admin-appearance). Each field is
// optional; unset values fall back to the static admin theme via
// `var(--admin-x, fallback)` in AdminLayout.scss.

function AdminAppearancePanel() {
    const [sidebarBg, setSidebarBg,] = createSignal('',);
    const [sidebarText, setSidebarText,] = createSignal('',);
    const [pageBg, setPageBg,] = createSignal('',);
    const [pageText, setPageText,] = createSignal('',);
    const [panelBg, setPanelBg,] = createSignal('',);
    const [panelText, setPanelText,] = createSignal('',);
    const [panelBorder, setPanelBorder,] = createSignal('',);
    const [inputBg, setInputBg,] = createSignal('',);
    const [inputText, setInputText,] = createSignal('',);

    const [isDirty, setIsDirty,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [success, setSuccess,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const markDirty = () => { setIsDirty(true,); setSuccess(false,); };

    onMount(async () => {
        try {
            const d = await cms.settings.getAdminAppearance() as any;
            if (d) {
                setSidebarBg(d.sidebarBg || '',);
                setSidebarText(d.sidebarText || '',);
                setPageBg(d.pageBg || '',);
                setPageText(d.pageText || '',);
                setPanelBg(d.panelBg || '',);
                setPanelText(d.panelText || '',);
                setPanelBorder(d.panelBorder || '',);
                setInputBg(d.inputBg || '',);
                setInputText(d.inputText || '',);
            }
        } catch (e) {
            console.error('Failed to load admin appearance:', e,);
        }
    },);

    const handleSave = async () => {
        setSaving(true,);
        setError('',);
        setSuccess(false,);
        try {
            await cms.settings.adminAppearance({
                sidebarBg: sidebarBg() || undefined,
                sidebarText: sidebarText() || undefined,
                pageBg: pageBg() || undefined,
                pageText: pageText() || undefined,
                panelBg: panelBg() || undefined,
                panelText: panelText() || undefined,
                panelBorder: panelBorder() || undefined,
                inputBg: inputBg() || undefined,
                inputText: inputText() || undefined,
            } as any,);
            // Refresh the in-memory store so the chrome updates
            // without a hard reload — same pattern as the public
            // appearance / site-settings stores.
            await reloadAdminAppearance();
            setIsDirty(false,);
            setSuccess(true,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save admin appearance',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="appearance-panel">
            <div class="appearance-panel__action-bar">
                <button class="btn btn--primary" onClick={handleSave} disabled={!isDirty() || saving()}>
                    {saving() ? 'Saving...' : 'Save Admin Appearance'}
                </button>
                <Show when={success()}>
                    <span class="appearance-panel__saved">Saved.</span>
                </Show>
            </div>

            <Show when={error()}>
                <div class="alert alert--error" style={{ 'margin-bottom': '1rem', }}>{error()}</div>
            </Show>

            <div class="settings-grid settings-grid--equal">
                {/* Left column: Sidebar on top, Inputs below — both
                    nav-chrome controls live in one stack so the
                    Page-area card on the right can occupy a single
                    tall column without breaking responsive fallback.
                    `--equal` makes the two columns 50/50 instead of the
                    default 3:2 used by other settings tabs. */}
                <div class="settings-grid__col">
                    <section class="settings-card">
                        <h3 class="settings-card__title">Sidebar</h3>
                        <p class="settings-card__lede">
                            Colors applied to the left admin sidebar — background, links, icons, and the
                            site name displayed at the top.
                        </p>

                        <ThemeField
                            label="Sidebar background"
                            sublabel="Background of the left sidebar"
                        >
                            <ColorPicker
                                value={sidebarBg()}
                                onChange={(hex,) => { setSidebarBg(hex,); markDirty(); }}
                                clearable
                                onClear={() => { setSidebarBg('',); markDirty(); }}
                            />
                        </ThemeField>

                        <ThemeField
                            label="Sidebar text & icons"
                            sublabel="Color for sidebar nav text and icons"
                        >
                            <ColorPicker
                                value={sidebarText()}
                                onChange={(hex,) => { setSidebarText(hex,); markDirty(); }}
                                clearable
                                onClear={() => { setSidebarText('',); markDirty(); }}
                            />
                        </ThemeField>
                    </section>

                    <section class="settings-card">
                        <h3 class="settings-card__title">Inputs</h3>
                        <p class="settings-card__lede">
                            Background and text color used by all admin inputs, selects, and textareas.
                        </p>

                        <ThemeField
                            label="Input background"
                            sublabel="Background of inputs / selects / textareas"
                        >
                            <ColorPicker
                                value={inputBg()}
                                onChange={(hex,) => { setInputBg(hex,); markDirty(); }}
                                clearable
                                onClear={() => { setInputBg('',); markDirty(); }}
                            />
                        </ThemeField>

                        <ThemeField
                            label="Input text"
                            sublabel="Text color inside inputs / selects / textareas"
                        >
                            <ColorPicker
                                value={inputText()}
                                onChange={(hex,) => { setInputText(hex,); markDirty(); }}
                                clearable
                                onClear={() => { setInputText('',); markDirty(); }}
                            />
                        </ThemeField>
                    </section>
                </div>

                <section class="settings-card">
                    <h3 class="settings-card__title">Page area</h3>
                    <p class="settings-card__lede">
                        The right-hand content area where each admin page renders.
                    </p>

                    <ThemeField
                        label="Page background"
                        sublabel="Background of the admin content area"
                    >
                        <ColorPicker
                            value={pageBg()}
                            onChange={(hex,) => { setPageBg(hex,); markDirty(); }}
                            clearable
                            onClear={() => { setPageBg('',); markDirty(); }}
                        />
                    </ThemeField>

                    <ThemeField
                        label="Page text"
                        sublabel="Default text color for admin pages"
                    >
                        <ColorPicker
                            value={pageText()}
                            onChange={(hex,) => { setPageText(hex,); markDirty(); }}
                            clearable
                            onClear={() => { setPageText('',); markDirty(); }}
                        />
                    </ThemeField>

                    <ThemeField
                        label="Panel background"
                        sublabel="Card / section panel background color"
                    >
                        <ColorPicker
                            value={panelBg()}
                            onChange={(hex,) => { setPanelBg(hex,); markDirty(); }}
                            clearable
                            onClear={() => { setPanelBg('',); markDirty(); }}
                        />
                    </ThemeField>

                    <ThemeField
                        label="Panel text"
                        sublabel="Text color inside panels (cards, dashboard sections, tables)"
                    >
                        <ColorPicker
                            value={panelText()}
                            onChange={(hex,) => { setPanelText(hex,); markDirty(); }}
                            clearable
                            onClear={() => { setPanelText('',); markDirty(); }}
                        />
                    </ThemeField>

                    <ThemeField
                        label="Panel border"
                        sublabel="Border color around panels (cards, sections, tables)"
                    >
                        <ColorPicker
                            value={panelBorder()}
                            onChange={(hex,) => { setPanelBorder(hex,); markDirty(); }}
                            clearable
                            onClear={() => { setPanelBorder('',); markDirty(); }}
                        />
                    </ThemeField>
                </section>
            </div>
        </div>
    );
}

// ─── Main Settings Page ───

const AdminSettings: Component = () => {
    const [searchParams, setSearchParams,] = useSearchParams<{ tab: string, oauth_success: string, oauth_error: string, }>();
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
        try {
            return await cms.settings.getAll();
        } catch {
            return {};
        }
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

    // Feature toggles. Each is a boolean signal; the save handler
    // bundles them into the `features` field of PUT /settings, which
    // the backend flattens into individual `<feature>_enabled` rows.
    // Module flags default to true (the row is created by the seeder
    // and the boolean check defaults to true if absent on upgrades).
    const [postsEnabled, setPostsEnabled,] = createSignal(true,);
    const [campaignsEnabled, setCampaignsEnabled,] = createSignal(true,);
    const [formsEnabled, setFormsEnabled,] = createSignal(true,);
    const [messagesEnabled, setMessagesEnabled,] = createSignal(true,);
    // 'users' defaults to false (admin-only install). Admins remain
    // able to sign in regardless — this flag only opens public
    // registration UI and the Users admin sidebar link.
    const [usersEnabled, setUsersEnabled,] = createSignal(false,);

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
        // Feature flags — the admin GET /settings returns each as
        // `{ value: boolean, ... }`. `getValue` already unwraps that.
        setPostsEnabled(getValue(s, 'posts_enabled', true,) !== false,);
        setCampaignsEnabled(getValue(s, 'campaigns_enabled', true,) !== false,);
        setFormsEnabled(getValue(s, 'forms_enabled', true,) !== false,);
        setMessagesEnabled(getValue(s, 'messages_enabled', true,) !== false,);
        // Default false on absence (opt-in feature).
        setUsersEnabled(getValue(s, 'users_enabled', false,) === true,);
    },);

    // Load branding on mount
    onMount(async () => {
        try {
            const data = await cms.settings.getSiteBranding() as any;
            if (data) {
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

        // Feature toggles are now handled inline by FeatureToggleRow's
        // onChange (which calls PUT /settings with a single-feature
        // payload + the dependency planner). The General-tab submit
        // only persists non-feature fields.
        const data: Record<string, any> = {
            siteName: siteName(),
            siteDescription: siteDescription(),
            contactEmail: contactEmail() || undefined,
        };
        if (analyticsId()) {
            data.analytics = { googleAnalyticsId: analyticsId(), };
        }

        try {
            await cms.settings.update(data as any,);

            // Save branding separately
            await cms.settings.siteBranding({
                logo: logo(),
                favicon: favicon(),
            } as any,);

            // Force the public site-settings cache to refetch so the live
            // Header, AdminLayout sidebar, and footer pick up the new
            // logo / name / tagline / description without a page reload.
            await reloadSiteSettings();

            setSuccess(true,);
            refetch();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to save settings.',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div>
            <Title>Settings - Admin - RW</Title>
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

                    <form onSubmit={handleSubmit} class="settings-general">
                        {/* Two-column layout: site identity on the left,
                            branding on the right. Stacks on narrow widths. */}
                        <div class="settings-grid">
                            <section class="settings-card">
                                <h3 class="settings-card__title">Site identity</h3>
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
                            </section>

                            <section class="settings-card">
                                <h3 class="settings-card__title">Branding</h3>
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
                            </section>
                        </div>

                        {/*
                          Second row mirrors the first .settings-grid so column
                          widths line up: Features (3fr) on the left matches
                          Site identity above, Integrations (2fr) on the right
                          matches Branding above.
                        */}
                        <div class="settings-grid">
                            <section class="settings-card settings-features" id="features">
                                <h3 class="settings-card__title">Features</h3>
                                <p class="settings-card__lede">
                                    Enable or disable site modules. Disabling a module hides its admin sidebar
                                    link and stops surfacing related public links. Existing data is preserved.
                                </p>
                                <For each={FEATURES.filter((f,) => f.key !== 'patreon',)}>
                                    {(f,) => (
                                        <FeatureToggleRow
                                            featureKey={f.key}
                                            onChange={async (next, opts,) => {
                                                const payload: Record<string, unknown> = {
                                                    features: { [f.key]: next, },
                                                };
                                                if (opts?.enableDependencies) payload.enableDependencies = true;
                                                if (opts?.disableDependents) payload.disableDependents = true;
                                                let result;
                                                try {
                                                    result = await cms.settings.update(payload as any,);
                                                } catch (e) {
                                                    if (e instanceof FeatureCascadeError) {
                                                        // The dependency planner rejected the toggle.
                                                        // The client-side store usually pre-empts this
                                                        // by opening FeatureDependencyModal first; if a
                                                        // stale store let it through, surface the cascade.
                                                        const r = e.result;
                                                        const chain = r.kind === 'missing_prerequisites'
                                                            ? r.missing : r.dependents;
                                                        alert(`Could not toggle ${f.label}: ${chain.join(', ',)}`,);
                                                    } else {
                                                        alert(e instanceof Error ? e.message : `Could not toggle ${f.label}.`,);
                                                    }
                                                    return;
                                                }
                                                await reloadSiteSettings();
                                                refetch();
                                                // Surface the install (migrations ran) so the
                                                // operator knows the feature's tables are ready.
                                                if (next) {
                                                    const installed = (result?.features ?? []).some(
                                                        (s,) => s.enabled && s.appliedMigrations.length > 0,
                                                    );
                                                    if (installed) alert(`${f.label} installed.`,);
                                                }
                                            }}
                                            onRemove={async () => {
                                                try {
                                                    await cms.settings.uninstallFeature(f.key,);
                                                } catch (e) {
                                                    alert(e instanceof Error ? e.message : `Could not remove ${f.label}.`,);
                                                    return;
                                                }
                                                await reloadSiteSettings();
                                                refetch();
                                            }}
                                        />
                                    )}
                                </For>
                            </section>

                            <section class="settings-card">
                                <h3 class="settings-card__title">Integrations</h3>
                                <p class="settings-card__lede">
                                    Third-party services that plug into the site.
                                </p>
                                <div class="form-group">
                                    <label>Google Analytics ID</label>
                                    <input
                                        type="text"
                                        value={analyticsId()}
                                        onInput={(e,) => setAnalyticsId(e.currentTarget.value,)}
                                    />
                                    <span class="form-help">Measurement ID (e.g. G-XXXXXXX)</span>
                                </div>
                            </section>
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

                {/* ─── Site Footer Tab ─── */}
                <Show when={activeTab() === 'site-footer'}>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Build the site footer in rows, columns, and items. The footer is hidden on the public
                        site until you enable it here.
                    </p>
                    <SiteFooterEditor />
                </Show>

                {/* ─── Connections Tab ─── */}
                <Show when={activeTab() === 'connections'}>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Connect your social media accounts to display posts on the homepage and embed in articles.
                    </p>
                    <ConnectionsPanel />
                </Show>

                {/* ─── API Keys Tab ─── */}
                <Show when={activeTab() === 'api-keys'}>
                    <ApiKeysPanel />
                </Show>

                {/* ─── Admin Tab ─── */}
                <Show when={activeTab() === 'admin'}>
                    <h2 class="settings-subheading">Admin Appearance</h2>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Customize the colors used by the admin chrome — sidebar, page area, and panel
                        backgrounds. Leave any field empty to inherit the default theme.
                    </p>
                    <AdminAppearancePanel />

                    <h2 class="settings-subheading" style={{ 'margin-top': '2rem', }}>Admin Operations</h2>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        One-shot maintenance tasks. Each runs immediately when triggered;
                        nothing here is scheduled.
                    </p>
                    <SitemapPanel />

                    <h2 class="settings-subheading" style={{ 'margin-top': '2rem', }}>Job Management</h2>
                    <p class="form-help" style={{ 'margin-bottom': '1rem', }}>
                        Background jobs registered with the server's cron runner.
                    </p>
                    <JobManagementPanel />
                </Show>
            </div>
        </div>
    );
};

export default AdminSettings;
