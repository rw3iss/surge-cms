import { A, useSearchParams, } from '@solidjs/router';
import AffiliateProgramSettings from './AffiliateProgramSettings';
import { Component, createSignal, For, Show, } from 'solid-js';
import LoadingState from '../../../components/admin/common/LoadingState';
import { createSafeResource, } from '../../../hooks/createSafeResource';
import { createStore, unwrap, } from 'solid-js/store';
import type { ShopAppearance, ShopSettings as ShopSettingsModel, } from '@sitesurge/types';
import { FormField, } from '../../../components/admin/forms';
import Toggle from '../../../components/admin/common/Toggle';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import ShopGuard from './ShopGuard';
import ShopifyManagedBanner from './ShopifyManagedBanner';
import ProvidersPanel from './ProvidersPanel';
import EmailTemplatesPanel, { type PurposeConfig, } from '../../../components/admin/mail/EmailTemplatesPanel';
import type { MailingList, } from '@sitesurge/types';
import { isFeatureEnabled, } from '../../../stores/siteSettings';
import StripeKeysEditor from '../../../components/admin/StripeKeysEditor';
import { centsToDollars, dollarsToCents, } from './shopUtils';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import OrderTrackingSettings from './OrderTrackingSettings';

type Tab = 'general' | 'payments' | 'shipping' | 'appearance' | 'emails' | 'providers' | 'affiliates';
const TABS: { key: Tab; label: string; }[] = [
    { key: 'general', label: 'General', },
    { key: 'payments', label: 'Payments', },
    { key: 'shipping', label: 'Shipping', },
    { key: 'appearance', label: 'Appearance', },
    { key: 'emails', label: 'Emails', },
    { key: 'providers', label: 'Providers', },
    { key: 'affiliates', label: 'Affiliate program', },
];

/**
 * Tabs that render their own cards and so must NOT sit inside the shared
 * `.settings-card` wrapper. Providers draws one card per provider; wrapping
 * it in another left an empty bordered box above the list, because every
 * `Show` inside the shared card is false on that tab.
 */
const SELF_CARDED_TABS: Tab[] = ['providers', 'emails', 'affiliates',];
const usesSharedCard = (t: Tab,): boolean => !SELF_CARDED_TABS.includes(t,);

const ShopSettingsInner: Component = () => {
    const toast = useToast();
    // `?tab=affiliates` (links from Shop → Affiliates) opens that tab.
    const [params,] = useSearchParams();
    const [tab, setTab,] = createSignal<Tab>(TABS.some((t,) => t.key === params.tab,) ? params.tab as Tab : 'general',);
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
        showInventory: false,
        cardStyle: 'standard',
        currencyDisplay: 'symbol',
    },);
    // shipping money fields held as dollar strings for editing
    const [flat, setFlat,] = createSignal('',);
    const [freeThreshold, setFreeThreshold,] = createSignal('',);
    const [useAdditionalRate, setUseAdditionalRate,] = createSignal(false,);
    const [additionalRate, setAdditionalRate,] = createSignal('',);

    // Shop emails live in the site-wide `mail_purposes` row, not shop_settings:
    // the registry is shared across features, and one row keeps a purpose's
    // config in exactly one place.
    const [mailPurposes, setMailPurposes,] = createSignal<Record<string, PurposeConfig>>({},);
    const [lists, setLists,] = createSignal<MailingList[]>([],);

    const listsOn = () => isFeatureEnabled('mailing_lists',);
    const contactsOn = () => isFeatureEnabled('contacts',);
    /** The announcement and the storefront tout are both inert without a list. */
    const hasMerchList = () => Boolean(settings.newMerchandiseListId,);

    const [loaded,] = createSafeResource(async () => {
        const res = await cms.shop.settings.getAdmin();
        try {
            setMailPurposes((await cms.settings.getMailPurposes()) as Record<string, PurposeConfig> ?? {},);
        } catch { /* non-fatal: the Emails tab just starts from defaults */ }
        if (listsOn()) {
            try { setLists(await cms.mailingLists.list() as MailingList[],); } catch { /* non-fatal */ }
        }
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
            // Send EVERY setting the form holds (the server's schema whitelists
            // keys), rather than hand-listing them: the hand-written list kept
            // dropping new settings until someone noticed they never stuck.
            // Only the fields that need a transform are built explicitly.
            const { shipping: _shipping, tracking: _tracking, ...rest } = unwrap(settings,);
            const base = Object.fromEntries(
                Object.entries(rest,).filter(([, v,],) => v !== null && v !== undefined),
            );
            await cms.shop.settings.update({
                settings: {
                    ...base,
                    newMerchandiseListId: settings.newMerchandiseListId || null,
                    shipping,
                    ...(settings.tracking
                        ? {
                            tracking: {
                                useSupplierLinks: settings.tracking.useSupplierLinks,
                                // Unset = built-in defaults; half-typed rows are dropped.
                                carriers: settings.tracking.carriers
                                    ?.filter((c,) => c.carrier.trim() && /^https?:\/\/./i.test(c.urlTemplate.trim(),))
                                    .map((c,) => ({ carrier: c.carrier.trim(), urlTemplate: c.urlTemplate.trim(), })),
                            },
                        }
                        : {}),
                } as never,
                appearance: { ...appearance, },
            },);
            // Written alongside the shop settings so one Save covers every tab —
            // the tab strip is a view, not a form boundary.
            await cms.settings.setMailPurposes(mailPurposes() as Record<string, unknown>,);
            toast.success('Shop settings saved.',);
        } catch {
            /* error bus */
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="shop-admin shop-settings">
            <AdminTitle>Shop Settings</AdminTitle>
            <div class="admin-header">
                <A href="/admin/shop" class="admin-header__back">← Shop</A>
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

                <Show when={usesSharedCard(tab(),)}>
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

                            <OrderTrackingSettings settings={settings} setSettings={setSettings} />
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
                            <div class="form-group">
                                <Toggle
                                    label="Show inventory count"
                                    hint="Show the units in stock on /shop product cards and beside the price on product pages."
                                    checked={!!appearance.showInventory}
                                    onChange={(v,) => setAppearance('showInventory', v,)}
                                />
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
            </Show>

            <Show when={tab() === 'emails'}>
                <section class="settings-card">
                    <h3 class="settings-card__title">Shop emails</h3>
                    <p class="settings-card__lede">
                        Order confirmations, shipping notices, the staff order alert and the
                        new-merchandise announcement. Each can be switched off and given its own
                        content; leave the content empty to send the built-in default.
                    </p>
                    <FormField
                        label="New merchandise mailing list"
                        hint="The list that receives the new-merchandise announcement, and that the storefront signup subscribes people to."
                    >
                        <Show
                            when={listsOn()}
                            fallback={<p class="form-help-muted">Enable the <strong>Mailing Lists</strong> feature to use this.</p>}
                        >
                            <select
                                value={settings.newMerchandiseListId ?? ''}
                                onChange={(e,) => setSettings('newMerchandiseListId', e.currentTarget.value || null,)}
                            >
                                <option value="">— select a list —</option>
                                <For each={lists()}>
                                    {(l,) => <option value={l.id}>{l.name}</option>}
                                </For>
                            </select>
                        </Show>
                    </FormField>
                    <Show when={listsOn() && !hasMerchList()}>
                        <p class="form-help-muted shop-settings__warning">
                            ⚠ No mailing list assigned. The new-merchandise announcement won't send
                            and the storefront signup stays hidden until you create a list under
                            <strong> Mailing Lists</strong> and select it here.
                        </p>
                    </Show>

                    <FormField label="Show new merchandise signup on the shop page" inline>
                        <Toggle
                            checked={Boolean(settings.showMerchandiseSignup,) && hasMerchList()}
                            onChange={(v,) => setSettings('showMerchandiseSignup', v,)}
                            disabled={!hasMerchList()}
                            ariaLabel="Show new merchandise signup"
                        />
                    </FormField>
                    <p class="form-help-muted">
                        Adds a short blurb and a "Get Notifications for New Merchandise" button beside
                        the Shop heading. Signed-in visitors subscribe in one click; everyone else gets
                        a small form.
                    </p>

                    <Show when={settings.showMerchandiseSignup && hasMerchList()}>
                        <FormField label="Automatically add signups as Contacts" inline>
                            <Toggle
                                checked={Boolean(settings.merchandiseSignupAddContact,) && contactsOn()}
                                onChange={(v,) => setSettings('merchandiseSignupAddContact', v,)}
                                disabled={!contactsOn()}
                                ariaLabel="Add merchandise signups as contacts"
                            />
                        </FormField>
                        <p class="form-help-muted">
                            <Show
                                when={contactsOn()}
                                fallback={<>Enable the <strong>Contacts</strong> feature to use this.</>}
                            >
                                Creates a contact for anyone who signs up through the storefront, matched
                                on email so an existing contact is updated rather than duplicated. Leave
                                off to subscribe them to the list only.
                            </Show>
                        </p>
                    </Show>

                    <EmailTemplatesPanel
                        feature="shop"
                        value={mailPurposes()}
                        onChange={setMailPurposes}
                    />
                </section>
            </Show>

            <Show when={tab() === 'providers'}>
                <ProvidersPanel />
            </Show>

            <Show when={tab() === 'affiliates'}>
                <AffiliateProgramSettings />
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
