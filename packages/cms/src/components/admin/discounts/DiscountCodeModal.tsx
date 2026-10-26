/**
 * Create / edit a discount code — shared by Shop → Discount codes (site-wide
 * codes) and Shop → Affiliates (an affiliate's codes: commission + the buyer
 * discount that comes out of it). Service: services/shop/discounts.ts.
 */
import type { RoleDef, ShopDiscountCode, ShopDiscountCodeBody, SubscriptionTier, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import { cms, } from '../../../services/cmsClient';
import { isFeatureEnabled, } from '../../../stores/siteSettings';
import { useToast, } from '../../common/toast';
import ModalShell from '../common/ModalShell';
import Toggle from '../common/Toggle';
import { CommitInput, FormField, } from '../forms';
import './discounts.scss';

export interface DiscountCodeModalProps {
    open: boolean;
    /** The code being edited; omitted = a new code. */
    code?: ShopDiscountCode | null;
    /** A new code for this affiliate (Shop → Affiliates). */
    affiliateUserId?: string | null;
    /** Default commission for a new affiliate code (program setting). */
    defaultCommission?: number;
    onClose: () => void;
    onSaved: (code: ShopDiscountCode,) => void;
}

/** `2026-11-01T09:30` (datetime-local, local time) ↔ ISO. */
const toLocal = (iso: string | null | undefined,) => {
    if (!iso) return '';
    const d = new Date(iso,);
    const pad = (n: number,) => String(n,).padStart(2, '0',);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1,)}-${pad(d.getDate(),)}T${pad(d.getHours(),)}:${pad(d.getMinutes(),)}`;
};
const fromLocal = (v: string,) => (v ? new Date(v,).toISOString() : null);
const intOrNull = (v: string,) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v,),),) || null);
const dollarsToCents = (v: string,) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v,) * 100,),));

const DiscountCodeModal: Component<DiscountCodeModalProps> = (props,) => {
    const toast = useToast();
    const affiliate = () => Boolean(props.code?.affiliateUserId ?? props.affiliateUserId,);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const c = props.code;
    const [draft, setDraft,] = createStore({
        code: c?.code ?? '',
        kind: (c?.kind ?? 'percent') as 'percent' | 'fixed',
        percent: c?.percent ?? (affiliate() ? 0 : 10),
        amountDollars: c ? (c.amountCents / 100).toFixed(2,) : '',
        active: c?.active ?? true,
        maxUses: c?.maxUses != null ? String(c.maxUses,) : '',
        maxUsesPerUser: c?.maxUsesPerUser != null ? String(c.maxUsesPerUser,) : '',
        minSubtotal: c?.minSubtotalCents != null ? (c.minSubtotalCents / 100).toFixed(2,) : '',
        startsAt: toLocal(c?.startsAt,),
        endsAt: toLocal(c?.endsAt,),
        allowedTierIds: [...(c?.allowedTierIds ?? []),] as string[],
        allowedRoles: [...(c?.allowedRoles ?? []),] as string[],
        appliesToTickets: c?.appliesToTickets ?? false,
        commissionPercent: c?.commissionPercent ?? props.defaultCommission ?? 10,
        note: c?.note ?? '',
    },);

    const [tiers,] = createResource(() => cms.subscriptionTiers.list().catch(() => [] as SubscriptionTier[]),);
    const [roles,] = createResource(() => cms.roles.list().catch(() => [] as RoleDef[]),);
    const memberRoles = () => (roles() ?? []).filter((r,) => r.key !== 'anonymous' && !isStaffRole(r.key,),);

    const toggleIn = (key: 'allowedTierIds' | 'allowedRoles', id: string, on: boolean,) => {
        const cur = draft[key];
        setDraft(key, on ? [...new Set([...cur, id,],),] : cur.filter((x,) => x !== id,),);
    };

    const save = async () => {
        setError('',);
        if (!draft.code.trim()) return setError('Enter a code.',);
        const body: ShopDiscountCodeBody = {
            code: draft.code.trim(),
            kind: affiliate() ? 'percent' : draft.kind,
            percent: Number(draft.percent,) || 0,
            amountCents: draft.kind === 'fixed' && !affiliate() ? (dollarsToCents(draft.amountDollars,) ?? 0) : 0,
            active: draft.active,
            maxUses: intOrNull(draft.maxUses,),
            maxUsesPerUser: intOrNull(draft.maxUsesPerUser,),
            minSubtotalCents: dollarsToCents(draft.minSubtotal,),
            startsAt: fromLocal(draft.startsAt,),
            endsAt: fromLocal(draft.endsAt,),
            allowedTierIds: draft.allowedTierIds,
            allowedRoles: draft.allowedRoles,
            appliesToTickets: draft.appliesToTickets,
            note: draft.note.trim() || null,
            ...(affiliate() ? { commissionPercent: Number(draft.commissionPercent,) || 0, } : {}),
        };
        setSaving(true,);
        try {
            const saved = props.code
                ? await cms.shop.discounts.update(props.code.id, body,)
                : props.affiliateUserId
                ? await cms.affiliates.adminCreateCode(props.affiliateUserId, body,)
                : await cms.shop.discounts.create(body,);
            toast.success(props.code ? 'Code saved.' : 'Code created.',);
            props.onSaved(saved,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the code.',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <ModalShell open={props.open} onClose={props.onClose} size="md" showClose dismissOnBackdrop={false} ariaLabel="Discount code">
            <div class="discount-modal">
                <h2 class="discount-modal__title">{props.code ? `Edit ${props.code.code}` : affiliate() ? 'New affiliate code' : 'New discount code'}</h2>

                <div class="admin-form-row">
                    <FormField label="Code" hint="Letters, digits, - or _. Buyers type it at checkout (any case).">
                        <CommitInput value={draft.code} onCommit={(v,) => setDraft('code', v.trim(),)} placeholder="SUMMER10" />
                    </FormField>
                    <Show when={!affiliate()}>
                        <FormField label="Type">
                            <select value={draft.kind} onChange={(e,) => setDraft('kind', e.currentTarget.value as 'percent' | 'fixed',)}>
                                <option value="percent">Percent off</option>
                                <option value="fixed">Amount off</option>
                            </select>
                        </FormField>
                    </Show>
                </div>

                <Show when={affiliate()}>
                    <div class="admin-form-row">
                        <FormField
                            label="Commission %"
                            tooltip="The affiliate's share of the merchandise subtotal of every paid order that uses this code (0–100). Any buyer discount comes out of it."
                            hint="Default 10%."
                        >
                            <CommitInput type="number" min={0} max={100} step="0.5" value={draft.commissionPercent} onCommit={(v,) => setDraft('commissionPercent', Math.min(100, Math.max(0, Number(v,) || 0,),),)} />
                        </FormField>
                        <FormField
                            label="Buyer discount %"
                            tooltip="Given to the buyer and taken out of the commission (0 = the affiliate keeps all of it). The affiliate can change this on their page."
                        >
                            <CommitInput type="number" min={0} max={100} step="0.5" value={draft.percent} onCommit={(v,) => setDraft('percent', Math.max(0, Number(v,) || 0,),)} />
                        </FormField>
                    </div>
                </Show>
                <Show when={!affiliate()}>
                    <Show
                        when={draft.kind === 'fixed'}
                        fallback={
                            <FormField label="Percent off" hint="Of the merchandise subtotal (and tickets, if allowed below).">
                                <CommitInput type="number" min={0} max={100} step="0.5" value={draft.percent} onCommit={(v,) => setDraft('percent', Math.min(100, Math.max(0, Number(v,) || 0,),),)} />
                            </FormField>
                        }
                    >
                        <FormField label="Amount off ($)" hint="Never more than the order's eligible subtotal.">
                            <CommitInput type="number" min={0} step="0.01" value={draft.amountDollars} onCommit={(v,) => setDraft('amountDollars', v,)} />
                        </FormField>
                    </Show>
                </Show>

                <div class="admin-form-row">
                    <FormField label="Maximum uses" tooltip="Total paid orders that may use this code. Empty = unlimited. A refunded order gives its use back.">
                        <CommitInput type="number" min={1} value={draft.maxUses} placeholder="Unlimited" onCommit={(v,) => setDraft('maxUses', v,)} />
                    </FormField>
                    <FormField label="Uses per buyer" tooltip="Per account or email address. Empty = unlimited.">
                        <CommitInput type="number" min={1} value={draft.maxUsesPerUser} placeholder="Unlimited" onCommit={(v,) => setDraft('maxUsesPerUser', v,)} />
                    </FormField>
                    <FormField label="Minimum order ($)" hint="Of the eligible items.">
                        <CommitInput type="number" min={0} step="0.01" value={draft.minSubtotal} placeholder="None" onCommit={(v,) => setDraft('minSubtotal', v,)} />
                    </FormField>
                </div>

                <div class="admin-form-row">
                    <FormField label="Starts" hint="Empty = now.">
                        <CommitInput type="datetime-local" value={draft.startsAt} onCommit={(v,) => setDraft('startsAt', v,)} />
                    </FormField>
                    <FormField label="Ends" hint="Empty = never.">
                        <CommitInput type="datetime-local" value={draft.endsAt} onCommit={(v,) => setDraft('endsAt', v,)} />
                    </FormField>
                </div>

                <Toggle checked={draft.active} onChange={(v,) => setDraft('active', v,)} label="Active" hint="Turn off to pause the code without deleting it." />
                <Show when={isFeatureEnabled('events',)}>
                    <Toggle
                        checked={draft.appliesToTickets}
                        onChange={(v,) => setDraft('appliesToTickets', v,)}
                        label="Also applies to event tickets"
                        hint="Codes always apply to shop merchandise; turn this on to discount tickets bought through the cart too."
                    />
                </Show>

                <FormField label="Only for membership levels" hint="None chosen = anyone. A buyer on ANY chosen level (or with any chosen role below) may use it.">
                    <div class="discount-modal__options">
                        <For each={tiers() ?? []}>
                            {(t,) => <Toggle checked={draft.allowedTierIds.includes(t.id,)} onChange={(v,) => toggleIn('allowedTierIds', t.id, v,)} label={t.name} />}
                        </For>
                    </div>
                </FormField>
                <FormField label="Only for roles" hint="None chosen = anyone. Main or additional roles count.">
                    <div class="discount-modal__options">
                        <For each={memberRoles()}>
                            {(r,) => <Toggle checked={draft.allowedRoles.includes(r.key,)} onChange={(v,) => toggleIn('allowedRoles', r.key, v,)} label={r.label} />}
                        </For>
                    </div>
                </FormField>

                <FormField label="Note" hint="Admin-only.">
                    <CommitInput multiline rows={2} value={draft.note} onCommit={(v,) => setDraft('note', v,)} />
                </FormField>

                <Show when={error()}><p class="discount-modal__error" role="alert">{error()}</p></Show>
                <div class="discount-modal__actions">
                    <button type="button" class="ui-button ui-button--secondary" onClick={props.onClose} disabled={saving()}>Cancel</button>
                    <button type="button" class="ui-button ui-button--primary" onClick={() => void save()} disabled={saving()}>
                        {saving() ? 'Saving…' : props.code ? 'Save code' : 'Create code'}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};

export default DiscountCodeModal;
