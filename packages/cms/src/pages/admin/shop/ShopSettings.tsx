import { Title, } from '@solidjs/meta';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import type { ShopAppearance, ShopSettings as ShopSettingsModel, } from '@sitesurge/types';
import { FormCheck, FormField, } from '../../../components/admin/forms';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import ShopGuard from './ShopGuard';
import { centsToDollars, dollarsToCents, } from './shopUtils';

type Tab = 'general' | 'payments' | 'shipping' | 'appearance';
const TABS: { key: Tab; label: string; }[] = [
    { key: 'general', label: 'General', },
    { key: 'payments', label: 'Payments', },
    { key: 'shipping', label: 'Shipping', },
    { key: 'appearance', label: 'Appearance', },
];

const ShopSettingsInner: Component = () => {
    const toast = useToast();
    const [tab, setTab,] = createSignal<Tab>('general',);
    const [saving, setSaving,] = createSignal(false,);

    const [settings, setSettings,] = createStore<ShopSettingsModel>({
        currency: 'USD',
        taxEnabled: false,
        businessName: '',
        businessAddress: '',
        storeEnabled: true,
        stripeTaxEnabled: false,
        shipping: {},
    },);
    const [appearance, setAppearance,] = createStore<ShopAppearance>({
        gridColumns: 3,
        showRatings: true,
        cardStyle: 'standard',
        currencyDisplay: 'symbol',
    },);
    // shipping money fields held as dollar strings for editing
    const [flat, setFlat,] = createSignal('',);
    const [freeThreshold, setFreeThreshold,] = createSignal('',);

    const [loaded,] = createResource(async () => {
        try {
            const res = await cms.shop.settings.getAdmin();
            setSettings(res.settings,);
            setAppearance(res.appearance,);
            setFlat(centsToDollars(res.settings.shipping?.flatCents,),);
            setFreeThreshold(centsToDollars(res.settings.shipping?.freeThresholdCents,),);
            return res;
        } catch {
            return null;
        }
    },);

    // Live Stripe connection status (cached ~60s server-side). Loads on mount
    // so the Payments tab is ready; "Recheck" forces a fresh server-side check.
    const [stripeStatus, { mutate: setStripeStatus, },] = createResource(
        async () => {
            try { return await cms.shop.settings.stripeStatus(); } catch { return null; }
        },
    );
    const [rechecking, setRechecking,] = createSignal(false,);
    const recheckStripe = async () => {
        setRechecking(true,);
        try {
            const fresh = await cms.shop.settings.stripeStatus(true,).catch(() => null,);
            setStripeStatus(fresh,);
        } finally {
            setRechecking(false,);
        }
    };

    const save = async () => {
        setSaving(true,);
        try {
            const shipping = {
                flatCents: flat() ? dollarsToCents(flat(),) : undefined,
                freeThresholdCents: freeThreshold() ? dollarsToCents(freeThreshold(),) : undefined,
                rates: settings.shipping?.rates,
            };
            await cms.shop.settings.update({
                settings: {
                    currency: settings.currency,
                    taxEnabled: settings.taxEnabled,
                    businessName: settings.businessName,
                    businessAddress: settings.businessAddress,
                    storeEnabled: settings.storeEnabled,
                    stripeTaxEnabled: settings.stripeTaxEnabled,
                    shipping,
                },
                appearance: { ...appearance, },
            },);
            toast.success('Shop settings saved.',);
        } catch {
            /* error bus */
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="shop-admin shop-settings">
            <Title>Shop Settings - Admin - RW</Title>
            <div class="admin-header">
                <h1>Shop Settings</h1>
                <button class="btn btn--primary" onClick={save} disabled={saving()}>
                    {saving() ? 'Saving...' : 'Save'}
                </button>
            </div>

            <Show when={loaded.state !== 'pending'} fallback={<div class="empty-state">Loading...</div>}>
                <div class="settings-tabs">
                    <For each={TABS}>
                        {(t,) => (
                            <button
                                class={`settings-tabs__tab ${tab() === t.key ? 'settings-tabs__tab--active' : ''}`}
                                onClick={() => setTab(t.key,)}
                            >
                                {t.label}
                            </button>
                        )}
                    </For>
                </div>

                <div class="settings-card">
                    <Show when={tab() === 'general'}>
                        <FormField label="Business name">
                            <input type="text" value={settings.businessName} onInput={(e,) => setSettings('businessName', e.currentTarget.value,)} />
                        </FormField>
                        <FormField label="Business address">
                            <textarea rows={2} value={settings.businessAddress || ''} onInput={(e,) => setSettings('businessAddress', e.currentTarget.value,)} />
                        </FormField>
                        <FormField label="Currency" inline hint="ISO 4217 code, e.g. USD">
                            <input type="text" value={settings.currency} onInput={(e,) => setSettings('currency', e.currentTarget.value.toUpperCase(),)} />
                        </FormField>
                        <FormCheck label="Store enabled" checked={settings.storeEnabled} onChange={(v,) => setSettings('storeEnabled', v,)} />
                        <FormCheck label="Apply tax" checked={settings.taxEnabled} onChange={(v,) => setSettings('taxEnabled', v,)} />
                    </Show>

                    <Show when={tab() === 'payments'}>
                        <Show
                            when={stripeStatus.state !== 'pending' ? stripeStatus() : null}
                            fallback={<p class="form-help-muted">Checking Stripe connection…</p>}
                            keyed
                        >
                            {(s,) => {
                                const accepting = s.connected && (s.mode === 'test' || s.chargesEnabled);
                                const level = accepting ? 'ok' : s.connected ? 'warn' : 'error';
                                return (
                                    <div class="shop-stripe">
                                        <div class={`shop-stripe__banner shop-stripe__banner--${level}`}>
                                            <span class="shop-stripe__dot" />
                                            <div class="shop-stripe__headline">
                                                <strong>
                                                    {accepting
                                                        ? 'Connected — accepting payments'
                                                        : s.connected
                                                            ? 'Connected — not yet accepting live charges'
                                                            : s.configured
                                                                ? 'Not connected'
                                                                : 'Stripe not configured'}
                                                </strong>
                                                <Show when={s.mode}>
                                                    <span class={`badge ${s.mode === 'live' ? 'badge--success' : 'badge--info'}`}>
                                                        {s.mode === 'live' ? 'Live mode' : 'Test mode'}
                                                    </span>
                                                </Show>
                                            </div>
                                        </div>

                                        <Show when={s.connected}>
                                            <dl class="shop-stripe__details">
                                                <div><dt>Account</dt><dd>{s.displayName || s.accountId}</dd></div>
                                                <Show when={s.country}><div><dt>Country</dt><dd>{s.country}</dd></div></Show>
                                                <Show when={s.defaultCurrency}><div><dt>Currency</dt><dd>{s.defaultCurrency}</dd></div></Show>
                                                <div><dt>Charges enabled</dt><dd>{s.chargesEnabled ? 'Yes' : 'No'}</dd></div>
                                                <div><dt>Payouts enabled</dt><dd>{s.payoutsEnabled ? 'Yes' : 'No'}</dd></div>
                                                <div><dt>Webhook secret</dt><dd>{s.webhookConfigured ? 'Configured' : 'Missing'}</dd></div>
                                                <div><dt>Publishable key</dt><dd>{s.publishableKeyConfigured ? 'Configured' : 'Missing'}</dd></div>
                                            </dl>
                                        </Show>

                                        <Show when={s.connected && s.mode === 'test'}>
                                            <p class="form-help-muted">
                                                Test mode — no real charges. Use card 4242 4242 4242 4242 (any future expiry / CVC) to place test orders.
                                            </p>
                                        </Show>
                                        <Show when={s.connected && s.mode === 'live' && !s.chargesEnabled}>
                                            <p class="shop-stripe__help">
                                                This account isn't fully activated for live charges yet. Finish onboarding in the{' '}
                                                <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">Stripe Dashboard</a>.
                                            </p>
                                        </Show>
                                        <Show when={s.connected && !s.webhookConfigured}>
                                            <p class="shop-stripe__help">
                                                No webhook signing secret set — paid orders won't auto-fulfill. Set <code>STRIPE_WEBHOOK_SECRET</code>{' '}
                                                (from <code>stripe listen</code> locally, or a Dashboard webhook endpoint in production).
                                            </p>
                                        </Show>
                                        <Show when={s.connected && !s.publishableKeyConfigured}>
                                            <p class="shop-stripe__help">
                                                No storefront publishable key — checkout can't load. Set <code>VITE_STRIPE_PUBLISHABLE_KEY</code> in the web app env.
                                            </p>
                                        </Show>
                                        <Show when={!s.connected}>
                                            <p class="shop-stripe__help">
                                                <Show when={s.error}><span>{s.error}</span><br /></Show>
                                                Set <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_PUBLISHABLE_KEY</code> in the API env, then restart the server.
                                                Get keys from the{' '}
                                                <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">Stripe Dashboard → Developers → API keys</a>.
                                            </p>
                                        </Show>

                                        <div class="shop-stripe__footer">
                                            <button class="btn btn--small btn--secondary" onClick={recheckStripe} disabled={rechecking()}>
                                                {rechecking() ? 'Checking…' : 'Recheck'}
                                            </button>
                                            <Show when={s.checkedAt}>
                                                <span class="form-help-muted">Last checked {new Date(s.checkedAt,).toLocaleTimeString()}</span>
                                            </Show>
                                        </div>
                                    </div>
                                );
                            }}
                        </Show>

                        <FormCheck
                            label="Use Stripe Tax"
                            checked={settings.stripeTaxEnabled || false}
                            onChange={(v,) => setSettings('stripeTaxEnabled', v,)}
                        />
                    </Show>

                    <Show when={tab() === 'shipping'}>
                        <FormField label="Flat shipping rate" hint="Applied per order. Leave blank for free shipping.">
                            <input type="text" inputmode="decimal" placeholder="0.00" value={flat()} onInput={(e,) => setFlat(e.currentTarget.value,)} />
                        </FormField>
                        <FormField label="Free shipping threshold" hint="Orders at/above this subtotal ship free.">
                            <input type="text" inputmode="decimal" placeholder="0.00" value={freeThreshold()} onInput={(e,) => setFreeThreshold(e.currentTarget.value,)} />
                        </FormField>
                    </Show>

                    <Show when={tab() === 'appearance'}>
                        <FormField label="Grid columns" inline>
                            <input
                                type="number"
                                min={1}
                                max={6}
                                value={appearance.gridColumns}
                                onInput={(e,) => setAppearance('gridColumns', parseInt(e.currentTarget.value, 10,) || 3,)}
                            />
                        </FormField>
                        <FormField label="Card style" inline>
                            <select value={appearance.cardStyle} onChange={(e,) => setAppearance('cardStyle', e.currentTarget.value,)}>
                                <option value="standard">Standard</option>
                                <option value="minimal">Minimal</option>
                                <option value="bordered">Bordered</option>
                            </select>
                        </FormField>
                        <FormField label="Currency display" inline>
                            <select value={appearance.currencyDisplay || 'symbol'} onChange={(e,) => setAppearance('currencyDisplay', e.currentTarget.value,)}>
                                <option value="symbol">Symbol ($)</option>
                                <option value="code">Code (USD)</option>
                            </select>
                        </FormField>
                        <FormCheck label="Show product ratings" checked={appearance.showRatings} onChange={(v,) => setAppearance('showRatings', v,)} />
                    </Show>
                </div>
            </Show>
        </div>
    );
};

const ShopSettings: Component = () => (
    <ShopGuard>
        <ShopSettingsInner />
    </ShopGuard>
);

export default ShopSettings;
