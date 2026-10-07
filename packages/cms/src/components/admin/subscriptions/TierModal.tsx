/**
 * Edit (or create) a subscription tier: name / slug / description, the role
 * its subscribers get, the recurring Stripe price it sells, and EXTRA
 * permissions on top of that role. Permissions the role already gives are
 * listed read-only, so the operator only adds what is genuinely new.
 */
import { A, } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, Show, type Component, } from 'solid-js';
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

function priceLabel(p: StripeSubscriptionPrice,): string {
    const amt = p.unitAmount != null ? `${(p.unitAmount / 100).toFixed(2,)} ${p.currency.toUpperCase()}` : 'custom amount';
    const every = p.intervalCount > 1 ? `${p.intervalCount} ${p.interval}s` : p.interval;
    return `${p.productName}${p.nickname ? ` — ${p.nickname}` : ''} · ${amt} / ${every}`;
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
        stripePriceId: t?.stripePriceId ?? '',
    },);
    const [extra, setExtra,] = createSignal<string[]>(t?.permissions ?? [],);
    const [search, setSearch,] = createSignal('',);
    const [saving, setSaving,] = createSignal(false,);
    const [slugTouched, setSlugTouched,] = createSignal(Boolean(t,),);

    const [stripe,] = createResource(() => cms.subscriptionTiers.stripePrices().catch((): StripeSubscriptionPricesResponse => ({ connected: false, prices: [], })),);

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
                ...(t?.isFree ? {} : { stripePriceId: form.stripePriceId || null, }),
                permissions: extra(),
            };
            if (t) await cms.subscriptionTiers.update(t.id, body,);
            else await cms.subscriptionTiers.create(body,);
            toast.success('Subscription saved.',);
            props.onSaved();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not save the subscription.',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <ModalShell open onClose={() => !saving() && props.onClose()} size="lg" showClose ariaLabel="Subscription" dismissOnBackdrop={false}>
            <div class="tier-modal">
                <h2>{t ? `Edit subscription: ${t.name}` : 'New subscription'}</h2>
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
                <FormField label="Description">
                    <textarea rows={2} value={form.description} onBlur={(e,) => setForm('description', e.currentTarget.value,)} />
                </FormField>

                <div class="tier-modal__grid">
                    <FormField label="Role" tooltip="The role subscribers of this tier are given. Its permissions are included below; staff are never moved off their role.">
                        <select value={form.role} onChange={(e,) => setForm('role', e.currentTarget.value,)}>
                            <option value="">— none (keep their role) —</option>
                            <For each={roleOptions()}>{(r,) => <option value={r.key}>{r.label} ({r.key})</option>}</For>
                        </select>
                    </FormField>
                    <FormField label="Active">
                        <Toggle checked={form.isActive} onChange={(v,) => setForm('isActive', v,)} ariaLabel="Active" />
                    </FormField>
                </div>

                <Show when={!t?.isFree}>
                    <FormField label="Stripe subscription product">
                        <Show when={!stripe.loading} fallback={<p class="form-help-muted">Loading Stripe prices…</p>}>
                            <select value={form.stripePriceId} onChange={(e,) => setForm('stripePriceId', e.currentTarget.value,)}>
                                <option value="">-</option>
                                <For each={stripe()?.prices ?? []}>{(p,) => <option value={p.priceId}>{priceLabel(p,)}</option>}</For>
                                {/* Keep a saved price selectable even if it is no longer listed. */}
                                <Show when={form.stripePriceId && !(stripe()?.prices ?? []).some((p,) => p.priceId === form.stripePriceId,)}>
                                    <option value={form.stripePriceId}>{form.stripePriceId} (not found in Stripe)</option>
                                </Show>
                            </select>
                            <Show when={!stripe()?.connected}>
                                <p class="tier-modal__note">
                                    Subscription products are defined in Stripe, and Stripe must be connected in the{' '}
                                    <A href="/admin/settings?tab=payments">Payments</A> tab.
                                </p>
                            </Show>
                            <Show when={stripe()?.error}>
                                <p class="tier-modal__note">Stripe: {stripe()!.error}</p>
                            </Show>
                        </Show>
                    </FormField>
                </Show>

                <FormField
                    label="Permissions"
                    hint="Everything the role gives is included. Add extra permissions this subscription unlocks."
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
                        {saving() ? 'Saving…' : 'Save subscription'}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};

export default TierModal;
