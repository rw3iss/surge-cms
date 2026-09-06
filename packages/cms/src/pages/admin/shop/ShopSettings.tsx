import { Title, } from '@solidjs/meta';
import { Component, createSignal, For, Show, } from 'solid-js';
import LoadingState from '../../../components/admin/common/LoadingState';
import { createSafeResource, } from '../../../hooks/createSafeResource';
import { createStore, } from 'solid-js/store';
import type { ShopAppearance, ShopSettings as ShopSettingsModel, } from '@sitesurge/types';
import { FormField, } from '../../../components/admin/forms';
import Toggle from '../../../components/admin/common/Toggle';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import ShopGuard from './ShopGuard';
import ShopifyManagedBanner from './ShopifyManagedBanner';
import ProvidersPanel from './ProvidersPanel';
import StripeKeysEditor from '../../../components/admin/StripeKeysEditor';
import { centsToDollars, dollarsToCents, } from './shopUtils';

type Tab = 'general' | 'payments' | 'shipping' | 'appearance' | 'providers';
const TABS: { key: Tab; label: string; }[] = [
    { key: 'general', label: 'General', },
    { key: 'payments', label: 'Payments', },
    { key: 'shipping', label: 'Shipping', },
    { key: 'appearance', label: 'Appearance', },
    { key: 'providers', label: 'Providers', },
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
    const [useAdditionalRate, setUseAdditionalRate,] = createSignal(false,);
    const [additionalRate, setAdditionalRate,] = createSignal('',);

    const [loaded,] = createSafeResource(async () => {
        const res = await cms.shop.settings.getAdmin();
        setSettings(res.settings,);
        setAppearance(res.appearance,);
        setFlat(centsToDollars(res.settings.shipping?.flatCents,),);
        setFreeThreshold(centsToDollars(res.settings.shipping?.freeThresholdCents,),);
        setUseAdditionalRate(res.settings.shipping?.useAdditionalItemRate ?? false,);
        setAdditionalRate(centsToDollars(res.settings.shipping?.additionalItemCents,),);
        return res;
    }, null,);

    const save = async () => {
        setSaving(true,);
        try {
            const shipping = {
                flatCents: flat() ? dollarsToCents(flat(),) : undefined,
                freeThresholdCents: freeThreshold() ? dollarsToCents(freeThreshold(),) : undefined,
                useAdditionalItemRate: useAdditionalRate(),
                additionalItemCents: (useAdditionalRate() && additionalRate())
                    ? dollarsToCents(additionalRate(),)
                    : undefined,
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
                <button class="ui-button ui-button--primary" onClick={save} disabled={saving()}>
                    {saving() ? 'Saving...' : 'Save'}
                </button>
            </div>
            <ShopifyManagedBanner note="Storefront, checkout, and payment settings are controlled in Shopify while the plugin is enabled. These internal settings are inactive." />

            <Show when={loaded.state !== 'pending'} fallback={<LoadingState />}>
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
                        <div class="form-group">
                            <Toggle label="Store enabled" checked={settings.storeEnabled} onChange={(v,) => setSettings('storeEnabled', v,)} />
                        </div>
                        <div class="form-group">
                            <Toggle label="Apply tax" checked={settings.taxEnabled} onChange={(v,) => setSettings('taxEnabled', v,)} />
                        </div>
                    </Show>

                    <Show when={tab() === 'payments'}>
                        <StripeKeysEditor
                            context="shop"
                            showUseDefault
                            title="Shop payments"
                            description="By default the shop uses the site-wide Stripe keys (Settings → Payments). Turn off 'Use site default' to charge shop orders through a different Stripe account."
                        />

                        <div class="form-group">
                            <Toggle
                                label="Use Stripe Tax"
                                checked={settings.stripeTaxEnabled || false}
                                onChange={(v,) => setSettings('stripeTaxEnabled', v,)}
                            />
                        </div>
                    </Show>

                    <Show when={tab() === 'shipping'}>
                        <FormField label="Flat shipping rate" hint="Applied to the first item (or per order when the additional-item rate is off). Leave blank for free shipping.">
                            <input type="text" inputmode="decimal" placeholder="0.00" value={flat()} onInput={(e,) => setFlat(e.currentTarget.value,)} />
                        </FormField>
                        <div class="form-group">
                            <Toggle
                                checked={useAdditionalRate()}
                                onChange={setUseAdditionalRate}
                                label="Use different rate for each additional item"
                            />
                            <span class="form-help">
                                Charge the flat rate above for the first item, and a separate rate for
                                every additional item in the cart.
                            </span>
                        </div>
                        <Show when={useAdditionalRate()}>
                            <FormField label="Additional item rate" hint="Applied to each item after the first.">
                                <input type="text" inputmode="decimal" placeholder="0.00" value={additionalRate()} onInput={(e,) => setAdditionalRate(e.currentTarget.value,)} />
                            </FormField>
                        </Show>
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
                        <div class="form-group">
                            <Toggle label="Show product ratings" checked={appearance.showRatings} onChange={(v,) => setAppearance('showRatings', v,)} />
                        </div>
                    </Show>

                    {/* Multi-supplier presentation. Payment is a single charge
                        either way — these only change what the buyer is shown,
                        because print suppliers bill us, not the customer. */}
                    <Show when={tab() === 'appearance'}>
                        <h3 class="settings-card__subtitle">Multiple suppliers</h3>
                        <FormField
                            label="Cart display"
                            hint="When a cart holds items from more than one fulfiller. Combined shows one list and one shipping line; Separate shows a section per supplier, each with its own shipping — honest that parcels arrive separately."
                        >
                            <select
                                value={settings.cartDisplay || 'combined'}
                                onChange={(e,) => setSettings('cartDisplay', e.currentTarget.value as never,)}
                            >
                                <option value="combined">Combined — one cart</option>
                                <option value="grouped">Separate — a section per supplier</option>
                            </select>
                        </FormField>

                        <Show
                            when={(settings.cartDisplay || 'combined') === 'grouped'}
                            fallback={
                                <p class="form-help-muted">
                                    Buyer emails and receipts follow the cart, so they stay combined.
                                </p>
                            }
                        >
                            <FormField
                                label="Buyer emails and receipts"
                                hint="Only offered while the cart is shown separately — a grouped email after a combined cart tells the buyer something the checkout never did."
                            >
                                <select
                                    value={settings.orderEmailDisplay || 'combined'}
                                    onChange={(e,) => setSettings('orderEmailDisplay', e.currentTarget.value as never,)}
                                >
                                    <option value="combined">Combined</option>
                                    <option value="grouped">Separate per supplier</option>
                                </select>
                            </FormField>
                        </Show>

                        <FormField
                            label="Admin order notifications"
                            hint="Kept separate by default: you need the fulfilment breakdown even when the buyer sees one list."
                        >
                            <select
                                value={settings.adminNotificationDisplay || 'grouped'}
                                onChange={(e,) => setSettings('adminNotificationDisplay', e.currentTarget.value as never,)}
                            >
                                <option value="grouped">Separate per supplier</option>
                                <option value="combined">Combined</option>
                            </select>
                        </FormField>
                    </Show>
                </div>
            </Show>

            <Show when={tab() === 'providers'}>
                <ProvidersPanel />
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
