/**
 * Shop → Settings → Providers.
 *
 * Lists every fulfilment provider, opens one for configuration, and shows the
 * webhook URLs to paste into that provider's dashboard.
 *
 * Two things are surfaced deliberately rather than hidden:
 *  - which webhook endpoints the provider does NOT sign, since those are
 *    protected only by the secrecy of their URL;
 *  - that a provider with no catalogue (Apliiq) cannot be "synced", so nobody
 *    hunts for a Sync button that will never work.
 */
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../../components/common/toast';
import { FormField, } from '../../../components/admin/forms';
import './ProvidersPanel.scss';

import type { ShopProviderSummary, ShopProviderWebhook, } from '@sitesurge/client';

type ProviderSummary = ShopProviderSummary;
type WebhookRow = ShopProviderWebhook;

const api = cms.shopProviders;

const ProvidersPanel: Component = () => {
    const toast = useToast();
    const [providers, { refetch, },] = createResource(async () => {
        try { return await api.list(); } catch { return [] as ProviderSummary[]; }
    },);
    const [openKey, setOpenKey,] = createSignal<string | null>(null,);

    const toggle = async (p: ProviderSummary,) => {
        try {
            await api.save(p.key, { enabled: !p.enabled, },);
            await refetch();
        } catch (e: any) {
            toast.error(e?.message || 'Could not change the provider.',);
        }
    };

    return (
        <div class="providers-panel">
            <p class="settings-card__lede">
                Fulfilment providers print and ship items on your behalf. A cart may contain items
                from several — each is quoted and ordered separately, but the customer pays once.
            </p>

            <For each={providers() ?? []}>
                {(p,) => (
                    <section class="settings-card provider-row">
                        {/* Header is title-vs-buttons only; the description
                            drops to its own full-width row below so a long
                            blurb can't squeeze the actions. */}
                        <div class="provider-row__head">
                            <h3 class="settings-card__title">
                                {p.label}
                                <Show when={p.enabled && !p.configured}>
                                    <span class="badge badge--warning">needs credentials</span>
                                </Show>
                                <Show when={p.enabled && p.configured}>
                                    <span class="badge badge--success">active</span>
                                </Show>
                            </h3>
                            <div class="provider-row__actions">
                                <button
                                    type="button"
                                    class="ui-button ui-button--secondary ui-button--sm"
                                    onClick={() => setOpenKey(openKey() === p.key ? null : p.key,)}
                                >
                                    {openKey() === p.key ? 'Close' : 'Configure'}
                                </button>
                                <button
                                    type="button"
                                    class={`ui-button ui-button--sm ${p.enabled ? 'ui-button--danger' : 'ui-button--primary'}`}
                                    onClick={() => toggle(p,)}
                                >
                                    {p.enabled ? 'Disable' : 'Enable'}
                                </button>
                            </div>
                        </div>
                        <Show when={p.description}>
                            <p class="settings-card__lede provider-row__desc">{p.description}</p>
                        </Show>

                        <Show when={openKey() === p.key}>
                            <ProviderDetail provider={p} onSaved={refetch} />
                        </Show>
                    </section>
                )}
            </For>

            {/* Shopify is not a fulfilment provider — it replaces the whole
                storefront and checkout, so it cannot share a cart with these
                and stays in Plugins. Saying so here saves the hunt. */}
            <p class="form-help-muted providers-panel__note">
                Looking for Shopify? It replaces the entire storefront and checkout rather than
                fulfilling individual items, so it is managed under <strong>Plugins</strong>.
            </p>
        </div>
    );
};

const ProviderDetail: Component<{ provider: ProviderSummary; onSaved: () => void; }> = (props,) => {
    const toast = useToast();
    const [form, setForm,] = createSignal<Record<string, unknown>>({ ...props.provider.config, },);
    const [busy, setBusy,] = createSignal(false,);
    const [webhooks, { refetch: refetchHooks, },] = createResource(
        () => props.provider.key,
        async (key,) => {
            try { return await api.webhooks(key,); } catch { return [] as WebhookRow[]; }
        },
    );

    const set = (k: string, v: unknown,) => setForm((f,) => ({ ...f, [k]: v, }),);

    const save = async () => {
        setBusy(true,);
        try {
            await api.save(props.provider.key, { config: form(), },);
            toast.success('Saved.',);
            props.onSaved();
            await refetchHooks();
        } catch (e: any) {
            toast.error(e?.message || 'Could not save.',);
        } finally { setBusy(false,); }
    };

    const test = async () => {
        setBusy(true,);
        try {
            const r = await api.test(props.provider.key,);
            r.ok ? toast.success(r.message,) : toast.error(r.message,);
        } catch (e: any) {
            toast.error(e?.message || 'Test failed.',);
        } finally { setBusy(false,); }
    };

    const sync = async () => {
        setBusy(true,);
        try {
            const r = await api.sync(props.provider.key,);
            r.ok
                ? toast.success(`Synced: ${r.upserted ?? 0} updated, ${r.archived ?? 0} archived.`,)
                : toast.info(r.message ?? 'Nothing to sync.',);
        } catch (e: any) {
            toast.error(e?.message || 'Sync failed.',);
        } finally { setBusy(false,); }
    };

    const copy = (url: string,) => {
        navigator.clipboard?.writeText(url,);
        toast.success('URL copied.',);
    };

    return (
        <div class="provider-detail">
            <For each={props.provider.configSchema}>
                {(f,) => (
                    <FormField label={f.label} hint={f.help} required={f.required}>
                        <Show
                            when={f.type !== 'boolean'}
                            fallback={
                                <input
                                    type="checkbox"
                                    checked={form()[f.key] !== false}
                                    onChange={(e,) => set(f.key, e.currentTarget.checked,)}
                                />
                            }
                        >
                            <input
                                type={f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                                value={String(form()[f.key] ?? f.default ?? '',)}
                                autocomplete="off"
                                onInput={(e,) => set(
                                    f.key,
                                    f.type === 'number' ? Number(e.currentTarget.value,) : e.currentTarget.value,
                                )}
                            />
                        </Show>
                    </FormField>
                )}
            </For>

            <div class="provider-detail__actions">
                <button type="button" class="ui-button ui-button--primary ui-button--sm" disabled={busy()} onClick={save}>Save</button>
                <button type="button" class="ui-button ui-button--secondary ui-button--sm" disabled={busy()} onClick={test}>Test connection</button>
                <Show
                    when={props.provider.supportsSync}
                    fallback={
                        <span class="form-help-muted">
                            {props.provider.label} pushes products to your store rather than
                            publishing a catalogue, so there is nothing to sync.
                        </span>
                    }
                >
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" disabled={busy()} onClick={sync}>Sync now</button>
                </Show>
            </div>

            <Show when={!props.provider.supportsShippingQuote}>
                <p class="form-help-muted">
                    {props.provider.label} publishes no shipping-rate API, so its items use your
                    configured flat rate.
                </p>
            </Show>

            <Show when={(webhooks() ?? []).length > 0}>
                <h4 class="settings-card__subtitle">Webhook URLs</h4>
                <p class="form-help-muted">
                    Paste these into {props.provider.label}'s settings. They are generated here —
                    nothing needs to be copied the other way.
                </p>
                <div class="admin-table-container">
                    <table class="admin-table provider-webhooks">
                        <thead>
                            <tr><th>Event</th><th>URL</th><th>Signed</th><th>Last seen</th><th>Calls</th><th /></tr>
                        </thead>
                        <tbody>
                            <For each={webhooks()}>
                                {(w,) => (
                                    <tr>
                                        <td>{w.label}<br /><small class="form-help-muted">{w.method}</small></td>
                                        <td><code class="provider-webhooks__url">{w.url}</code></td>
                                        <td>
                                            <Show
                                                when={w.signed}
                                                fallback={
                                                    <span
                                                        class="badge badge--warning"
                                                        title="This provider does not sign this webhook, so the secret URL is its only protection. Anything it creates stays a draft."
                                                    >URL only</span>
                                                }
                                            >
                                                <span class="badge badge--success">HMAC</span>
                                            </Show>
                                        </td>
                                        <td>{w.lastSeenAt ? new Date(w.lastSeenAt,).toLocaleString() : <span class="form-help-muted">never</span>}</td>
                                        <td>{w.callCount}</td>
                                        <td class="provider-webhooks__row-actions">
                                            <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={() => copy(w.url,)}>Copy</button>
                                            <button
                                                type="button" class="ui-button ui-button--ghost ui-button--sm"
                                                onClick={async () => {
                                                    if (!confirm('Issue a new URL? The current one stops working immediately and must be re-pasted into the provider.',)) return;
                                                    await api.regenerateWebhook(props.provider.key, w.id,);
                                                    await refetchHooks();
                                                    toast.success('New URL issued — re-paste it into the provider.',);
                                                }}
                                            >Regenerate</button>
                                        </td>
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </table>
                </div>
            </Show>
        </div>
    );
};

export default ProvidersPanel;
