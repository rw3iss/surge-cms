/**
 * Edit (or create) a subscription tier: name / slug / description, the role
 * its subscribers get, the recurring Stripe price it sells, and EXTRA
 * permissions on top of that role. Permissions the role already gives are
 * listed read-only, so the operator only adds what is genuinely new.
 */
import { A, } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type Component, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import type { PermissionWithGrants, RoleDef, StripeSubscriptionPrice, StripeSubscriptionPricesResponse, SubscriptionTier, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { roleAllows, roleChainOf, } from '../../../utils/permissionInheritance';
import { useToast, } from '../../common/toast';
import ModalShell from '../common/ModalShell';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';

export interface TierModalProps {
    tier: SubscriptionTier | null; // null = new
    roles: RoleDef[];
    permissions: PermissionWithGrants[];
    onClose: () => void;
    onSaved: () => void;
}

const slugify = (s: string,) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-',).replace(/^-|-$/g, '',).slice(0, 63,);

/** "$250.00 / year". */
function priceAmount(p: StripeSubscriptionPrice,): string {
    const amt = p.unitAmount !== null ? `$${(p.unitAmount / 100).toFixed(2,)}` : 'custom amount';
    return `${amt}${p.intervalCount > 1 ? ` every ${p.intervalCount} ${p.interval}s` : ` / ${p.interval}`}`;
}

const TierModal: Component<TierModalProps> = (props,) => {
    const toast = useToast();
    const t = props.tier;
    const [form, setForm,] = createStore({
        name: t?.name ?? '',
        slug: t?.slug ?? '',
        description: t?.description ?? '',
        role: t?.role ?? (t ? '' : 'subscriber'),
        isActive: t?.isActive ?? true,
        devOnly: t?.devOnly ?? false,
        stripePriceId: t?.stripePriceId ?? '',
        // Custom price display (what members see; Stripe still bills its own price).
        displayOn: Boolean(t?.displayPrice,),
        displayPrice: t?.displayPrice ? (t.displayPrice.priceCents / 100).toFixed(2,) : '',
        displayInterval: (t?.displayPrice?.interval ?? 'month') as 'day' | 'week' | 'month' | 'year',
        displayIntervalCount: String(t?.displayPrice?.intervalCount ?? 1,),
        // Members apply instead of joining; billing starts when an admin approves.
        requiresApproval: t?.requiresApproval ?? false,
        // No prices shown and no card taken until approval (approval = an offer).
        hidePrice: t?.hidePrice ?? false,
        applicationFormId: t?.applicationFormId ?? '',
    },);
    const hidePrice = () => form.requiresApproval && form.hidePrice;
    const [extra, setExtra,] = createSignal<string[]>(t?.permissions ?? [],);
    const [search, setSearch,] = createSignal('',);
    const [saving, setSaving,] = createSignal(false,);
    const [slugTouched, setSlugTouched,] = createSignal(Boolean(t,),);

    const [stripe, { refetch: refetchStripe, },] = createResource(() => cms.subscriptionTiers.stripePrices().catch((): StripeSubscriptionPricesResponse => ({ connected: false, prices: [], })),);
    // Forms an application can use (all statuses; a draft cannot be submitted).
    const [formsList,] = createResource(
        () => cms.forms.list({ limit: 200, },).then((r,) => r.data,).catch(() => [] as Array<{ id: string; title: string; status: string; }>),
    );

    // A price is often created in Stripe WHILE this modal is open (another
    // tab): reload the list when the window regains focus, and on demand.
    onMount(() => {
        const onFocus = () => { if (!stripe.loading) void refetchStripe(); };
        window.addEventListener('focus', onFocus,);
        onCleanup(() => window.removeEventListener('focus', onFocus,),);
    },);

    /** The other recurring prices on the selected price's Stripe product. */
    const otherPricesOf = (priceId: string,) => {
        const all = stripe()?.prices ?? [];
        const sel = all.find((p,) => p.priceId === priceId,);
        return sel ? all.filter((p,) => p.productId === sel.productId && p.priceId !== priceId,) : [];
    };

    /**
     * One entry per Stripe PRODUCT (a level is a product; its prices are the
     * billing choices members pick from). The entry's price is the one this
     * level already uses on that product, else the product's Stripe default,
     * else its first price.
     */
    const products = createMemo(() => {
        const byProduct = new Map<string, StripeSubscriptionPrice[]>();
        for (const p of stripe()?.prices ?? []) {
            const list = byProduct.get(p.productId,) ?? [];
            list.push(p,);
            byProduct.set(p.productId, list,);
        }
        return [...byProduct.entries(),].map(([productId, prices,],) => ({ productId, name: prices[0].productName, prices, }));
    },);
    const defaultPriceFor = (productId: string,): StripeSubscriptionPrice | undefined => {
        const prices = products().find((x,) => x.productId === productId,)?.prices ?? [];
        return prices.find((p,) => p.priceId === form.stripePriceId,) ?? prices.find((p,) => p.isProductDefault,) ?? prices[0];
    };
    const selectedProductId = () => (stripe()?.prices ?? []).find((p,) => p.priceId === form.stripePriceId,)?.productId ?? '';
    const productLabel = (x: { productId: string; name: string; prices: StripeSubscriptionPrice[]; },) => {
        const d = defaultPriceFor(x.productId,);
        const more = x.prices.length - 1;
        return `${x.name}${d ? ` — ${priceAmount(d,)}` : ''}${more > 0 ? ` (+${more} price${more === 1 ? '' : 's'})` : ''}`;
    };

    /** Roles a subscription may give: everything but staff and anonymous. */
    const roleOptions = () => props.roles.filter((r,) => !isStaffRole(r.key,) && r.key !== 'anonymous',);
    const chain = createMemo(() => roleChainOf(form.role || null, props.roles,),);
    const inherited = createMemo(() => new Set(props.permissions.filter((p,) => roleAllows(p, chain(),),).map((p,) => p.key,),),);
    const byKey = createMemo(() => new Map(props.permissions.map((p,) => [p.key, p,]),),);

    /** Search results: not inherited, not already added. */
    const results = createMemo(() => {
        const q = search().trim().toLowerCase();
        if (!q) return [];
        return props.permissions
            .filter((p,) => !inherited().has(p.key,) && !extra().includes(p.key,))
            .filter((p,) => p.key.toLowerCase().includes(q,) || p.label.toLowerCase().includes(q,) || p.feature.toLowerCase().includes(q,))
            .slice(0, 12,);
    },);

    const save = async () => {
        if (!form.name.trim()) return toast.error('A name is required.',);
        setSaving(true,);
        try {
            const body = {
                name: form.name.trim(),
                slug: form.slug || slugify(form.name,),
                description: form.description || null,
                role: form.role || null,
                isActive: form.isActive,
                devOnly: form.devOnly,
                ...(t?.isFree ? {} : {
                    stripePriceId: form.stripePriceId || null,
                    // Hidden price: leave the stored custom display untouched.
                    ...(hidePrice() ? {} : {
                        displayPrice: form.displayOn && form.displayPrice.trim() !== ''
                            ? {
                                priceCents: Math.round(Math.max(0, Number(form.displayPrice,) || 0,) * 100,),
                                interval: form.displayInterval,
                                intervalCount: Math.max(1, Math.round(Number(form.displayIntervalCount,) || 1,),),
                            }
                            : null,
                    }),
                    requiresApproval: form.requiresApproval,
                    hidePrice: hidePrice(),
                    applicationFormId: form.requiresApproval ? form.applicationFormId || null : null,
                }),
                permissions: extra(),
            };
            if (t) await cms.subscriptionTiers.update(t.id, body,);
            else await cms.subscriptionTiers.create(body,);
            toast.success('Membership level saved.',);
            props.onSaved();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not save the membership level.',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <ModalShell open onClose={() => !saving() && props.onClose()} size="lg" showClose ariaLabel="Membership level" dismissOnBackdrop={false}>
            <div class="tier-modal">
                <h2>{t ? `Edit membership level: ${t.name}` : 'New membership level'}</h2>
                <div class="tier-modal__grid">
                    <FormField label="Name">
                        <input
                            type="text"
                            value={form.name}
                            onBlur={(e,) => {
                                setForm('name', e.currentTarget.value,);
                                if (!slugTouched()) setForm('slug', slugify(e.currentTarget.value,),);
                            }}
                        />
                    </FormField>
                    <FormField label="Slug" hint="Stable id used in code and URLs.">
                        <input
                            type="text"
                            value={form.slug}
                            disabled={t?.isFree}
                            onBlur={(e,) => {
                                setSlugTouched(true,);
                                setForm('slug', slugify(e.currentTarget.value,),);
                            }}
                        />
                    </FormField>
                </div>
                <FormField
                    label="Description"
                    hint="Markdown supported — **bold**, *italic*, [links](https://…), and lists (lines starting with “- ”). Shown on the plan cards (/subscribe, profile → Membership). Empty = the Stripe product's description."
                >
                    <textarea
                        class="tier-modal__description"
                        rows={4}
                        value={form.description}
                        onBlur={(e,) => setForm('description', e.currentTarget.value,)}
                    />
                </FormField>

                <div class="admin-form-row">
                    <FormField label="Role" tooltip="The role members of this tier are given. Its permissions are included below; staff are never moved off their role.">
                        <select value={form.role} onChange={(e,) => setForm('role', e.currentTarget.value,)}>
                            <option value="">— none (keep their role) —</option>
                            <For each={roleOptions()}>{(r,) => <option value={r.key}>{r.label} ({r.key})</option>}</For>
                        </select>
                    </FormField>
                    <FormField label="Active">
                        <Toggle checked={form.isActive} onChange={(v,) => setForm('isActive', v,)} ariaLabel="Active" />
                    </FormField>
                    <FormField label="Dev Only" hint="When on, only signed-in admins see this level on /subscribe, sign-up and the profile.">
                        <Toggle checked={form.devOnly} onChange={(v,) => setForm('devOnly', v,)} ariaLabel="Dev Only" />
                    </FormField>
                </div>

                <Show when={!t?.isFree}>
                    <Toggle
                        checked={form.requiresApproval}
                        onChange={(v,) => setForm('requiresApproval', v,)}
                        label="Require approval"
                        hint="Members apply instead of joining. Their card is saved and charged only when an admin approves. Review applications in Users."
                    />
                    <Show when={form.requiresApproval}>
                        <Toggle
                            checked={form.hidePrice}
                            onChange={(v,) => setForm('hidePrice', v,)}
                            label="Hide price"
                            hint="No prices are shown and no card is taken until you approve. Approval sends them a link to choose their billing and pay."
                        />
                        <FormField
                            label="Application form"
                            hint="Shown when a member applies. The form's own settings (email notification, add as contact) apply to each application."
                        >
                            <select value={form.applicationFormId} onChange={(e,) => setForm('applicationFormId', e.currentTarget.value,)}>
                                <option value="">Built-in form (Name, Email, Phone, Occupation)</option>
                                <For each={formsList() ?? []}>
                                    {(f,) => (
                                        <option value={f.id}>
                                            {f.title}{f.status !== 'published' ? ' (draft — publish it to use)' : ''}
                                        </option>
                                    )}
                                </For>
                            </select>
                        </FormField>
                    </Show>

                    <FormField label="Stripe membership product">
                        <Show when={!stripe.loading || stripe()} fallback={<p class="form-help-muted">Loading Stripe prices…</p>}>
                            <div class="tier-modal__price-row">
                            <select onChange={(e,) => setForm('stripePriceId', e.currentTarget.value ? (defaultPriceFor(e.currentTarget.value,)?.priceId ?? '') : '',)}>
                                <option value="" selected={!form.stripePriceId}>-</option>
                                <For each={products()}>
                                    {(x,) => <option value={x.productId} selected={x.productId === selectedProductId()}>{productLabel(x,)}</option>}
                                </For>
                                {/* Keep a saved price selectable even if it is no longer listed. */}
                                <Show when={form.stripePriceId && !selectedProductId()}>
                                    <option value="" selected>{form.stripePriceId} (not found in Stripe)</option>
                                </Show>
                            </select>
                            <button
                                type="button"
                                class="ui-button ui-button--secondary ui-button--sm"
                                disabled={stripe.loading}
                                title="Reload the prices from Stripe"
                                onClick={() => void refetchStripe()}
                            >
                                {stripe.loading ? 'Loading…' : 'Refresh'}
                            </button>
                            </div>
                            <Show when={!stripe()?.connected}>
                                <p class="tier-modal__note">
                                    Membership products are defined in Stripe, and Stripe must be connected in the{' '}
                                    <A href="/admin/settings?tab=payments">Payments</A> tab.
                                </p>
                            </Show>
                            <Show when={stripe()?.error}>
                                <p class="tier-modal__note">Stripe: {stripe()!.error}</p>
                            </Show>
                        </Show>
                    </FormField>
                    <Show when={otherPricesOf(form.stripePriceId,).length}>
                        <FormField
                            label="Default price"
                            hint="Shown first and pre-selected. Members choose between all of this product's prices on the plans page, sign-up and their profile."
                        >
                            <select onChange={(e,) => setForm('stripePriceId', e.currentTarget.value,)}>
                                <For each={products().find((x,) => x.productId === selectedProductId(),)?.prices ?? []}>
                                    {(p,) => (
                                        <option value={p.priceId} selected={p.priceId === form.stripePriceId}>
                                            {priceAmount(p,)}{p.nickname ? ` — ${p.nickname}` : ''}{p.isProductDefault ? ' (Stripe default)' : ''}
                                        </option>
                                    )}
                                </For>
                            </select>
                        </FormField>
                    </Show>

                    <Show when={!hidePrice()}>
                        <Toggle
                            checked={form.displayOn}
                            onChange={(v,) => setForm('displayOn', v,)}
                            label="Custom price display"
                            hint="Show members a different price and frequency on /subscribe, sign-up and their profile. Stripe still bills the product's own amount and interval; the cards add a small “Billed …” line with the real charge."
                        />
                        <Show when={form.displayOn}>
                            <div class="tier-modal__grid tier-modal__display">
                                <FormField label="Display price" hint="In the price's currency, e.g. 3000.00">
                                    <input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={form.displayPrice}
                                        onBlur={(e,) => setForm('displayPrice', e.currentTarget.value,)}
                                    />
                                </FormField>
                                <FormField label="Display frequency">
                                    <div class="tier-modal__freq">
                                        <span>every</span>
                                        <input
                                            type="number"
                                            min={1}
                                            max={52}
                                            value={form.displayIntervalCount}
                                            onBlur={(e,) => setForm('displayIntervalCount', e.currentTarget.value,)}
                                        />
                                        <select
                                            value={form.displayInterval}
                                            onChange={(e,) => setForm('displayInterval', e.currentTarget.value as 'day' | 'week' | 'month' | 'year',)}
                                        >
                                            <option value="day">day(s)</option>
                                            <option value="week">week(s)</option>
                                            <option value="month">month(s)</option>
                                            <option value="year">year(s)</option>
                                        </select>
                                    </div>
                                </FormField>
                            </div>
                        </Show>
                    </Show>
                </Show>

                <FormField
                    label="Permissions"
                    hint="Everything the role gives is included. Add extra permissions this membership level unlocks."
                >
                    <div class="tier-modal__perms">
                        <div class="tier-modal__chips">
                            <For each={extra()} fallback={<span class="form-help-muted">No extra permissions.</span>}>
                                {(k,) => (
                                    <span class="tier-modal__chip" title={byKey().get(k,)?.description ?? ''}>
                                        {byKey().get(k,)?.label ?? k} <code>{k}</code>
                                        <button type="button" aria-label={`Remove ${k}`} onClick={() => setExtra(extra().filter((x,) => x !== k,),)}>×</button>
                                    </span>
                                )}
                            </For>
                        </div>
                        {/* Search-as-you-type box: filters the list only, commits nothing. */}
                        <input type="search" placeholder="Search permissions to add…" value={search()} onInput={(e,) => setSearch(e.currentTarget.value,)} />
                        <Show when={results().length}>
                            <ul class="tier-modal__results">
                                <For each={results()}>
                                    {(p,) => (
                                        <li>
                                            <button type="button" onClick={() => { setExtra([...extra(), p.key,],); setSearch('',); }}>
                                                <strong>{p.label}</strong> <code>{p.key}</code>
                                                <span>{p.feature}</span>
                                            </button>
                                        </li>
                                    )}
                                </For>
                            </ul>
                        </Show>
                        <details class="tier-modal__inherited">
                            <summary>Included from the role{form.role ? ` (${chain().join(' → ',)})` : ''}: {inherited().size}</summary>
                            <ul>
                                <For each={props.permissions.filter((p,) => inherited().has(p.key,),)}>
                                    {(p,) => <li>{p.label} <code>{p.key}</code></li>}
                                </For>
                            </ul>
                        </details>
                    </div>
                </FormField>

                <div class="tier-modal__footer">
                    <button type="button" class="ui-button ui-button--secondary" onClick={props.onClose} disabled={saving()}>Cancel</button>
                    <button type="button" class="ui-button ui-button--primary" onClick={save} disabled={saving()}>
                        {saving() ? 'Saving…' : 'Save membership level'}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};

export default TierModal;
