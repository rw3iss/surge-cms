/**
 * Shop → Settings → Affiliate program: turns the `affiliates` feature on/off
 * (installs its tables) and edits its settings — the affiliate role, default
 * commission, refund window and the automatic payout schedule.
 */
import { A, } from '@solidjs/router';
import type { AffiliatePayoutSchedule, AffiliateSettings, RoleDef, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import Toggle from '../../../components/admin/common/Toggle';
import { CommitInput, FormField, } from '../../../components/admin/forms';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import { isFeatureEnabled, reloadSiteSettings, } from '../../../stores/siteSettings';

const SCHEDULES: { value: AffiliatePayoutSchedule; label: string; }[] = [
    { value: 'off', label: 'Off — manual payouts only', },
    { value: 'weekly', label: 'Weekly', },
    { value: 'biweekly', label: 'Every 2 weeks', },
    { value: 'monthly', label: 'Monthly (1st of the month)', },
];

const AffiliateProgramSettings: Component = () => {
    const toast = useToast();
    const on = () => isFeatureEnabled('affiliates',);
    const [switching, setSwitching,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [draft, setDraft,] = createStore<AffiliateSettings>({ role: 'affiliate', refundWindowDays: 30, payoutSchedule: 'off', defaultCommissionPercent: 10, },);
    const [loaded,] = createResource(on, async (enabled,) => {
        if (!enabled) return null;
        const s = await cms.affiliates.settings();
        setDraft(s,);
        return s;
    },);
    const [roles,] = createResource(() => cms.roles.list().catch(() => [] as RoleDef[]),);
    const memberRoles = () => (roles() ?? []).filter((r,) => r.key !== 'anonymous' && !isStaffRole(r.key,),);

    const setEnabled = async (next: boolean,) => {
        setSwitching(true,);
        try {
            await cms.settings.update({ features: { affiliates: next, }, } as never,);
            await reloadSiteSettings();
            toast.success(next ? 'Affiliate program turned on.' : 'Affiliate program turned off (its data is kept).',);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not change the affiliate program.',);
        } finally {
            setSwitching(false,);
        }
    };

    const save = async () => {
        setSaving(true,);
        try {
            const s = await cms.affiliates.updateSettings({
                role: draft.role,
                refundWindowDays: draft.refundWindowDays,
                payoutSchedule: draft.payoutSchedule,
                defaultCommissionPercent: draft.defaultCommissionPercent,
            },);
            setDraft(s,);
            toast.success('Affiliate settings saved.',);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not save the affiliate settings.',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <section class="admin-section settings-card">
            <header class="admin-section__header">
                <h2>Affiliate program</h2>
                <p class="form-help-muted">
                    Members with the affiliate role get codes for the shop and earn a commission on every paid order that uses
                    them. They connect a Stripe Express account on their profile and are paid out with Stripe transfers.
                </p>
            </header>
            <Toggle
                checked={on()}
                disabled={switching()}
                onChange={(v,) => void setEnabled(v,)}
                label="Enable affiliate program"
                hint="Adds the Affiliate program tab to members' profiles, Shop → Affiliates in the admin, and commissions on affiliate codes."
            />
            <Show when={on()}>
                <Show when={loaded.state !== 'pending'} fallback={<p class="form-help-muted">Loading…</p>}>
                    <div class="admin-form-row">
                        <FormField label="Affiliate role" hint="Users with this role (main or additional) are affiliates.">
                            <select value={draft.role} onChange={(e,) => setDraft('role', e.currentTarget.value,)}>
                                <For each={memberRoles()}>{(r,) => <option value={r.key} selected={r.key === draft.role}>{r.label}</option>}</For>
                            </select>
                        </FormField>
                        <FormField label="Default commission %" tooltip="The share of the merchandise subtotal a NEW affiliate code earns (0–100). Each code can differ.">
                            <CommitInput type="number" min={0} max={100} step="0.5" value={draft.defaultCommissionPercent} onCommit={(v,) => setDraft('defaultCommissionPercent', Math.min(100, Math.max(0, Number(v,) || 0,),),)} />
                        </FormField>
                    </div>
                    <div class="admin-form-row">
                        <FormField
                            label="Refund window (days)"
                            tooltip="A commission becomes payable this many days after the order is paid. A refund before then cancels it; after a payout it is taken off the next one."
                        >
                            <CommitInput type="number" min={0} max={365} value={draft.refundWindowDays} onCommit={(v,) => setDraft('refundWindowDays', Math.min(365, Math.max(0, Math.round(Number(v,) || 0,),),),)} />
                        </FormField>
                        <FormField label="Automatic payouts" hint="Payable commissions are transferred on this schedule. A manual Pay out is always available on Shop → Affiliates.">
                            <select value={draft.payoutSchedule} onChange={(e,) => setDraft('payoutSchedule', e.currentTarget.value as AffiliatePayoutSchedule,)}>
                                <For each={SCHEDULES}>{(s,) => <option value={s.value} selected={s.value === draft.payoutSchedule}>{s.label}</option>}</For>
                            </select>
                        </FormField>
                    </div>
                    <Show when={draft.lastAutoPayoutAt}>
                        <p class="form-help-muted">Last automatic payout run: {new Date(draft.lastAutoPayoutAt!,).toLocaleString()}</p>
                    </Show>
                    <p class="form-help-muted">
                        Stripe setup: enable <strong>Connect</strong> on the shop's Stripe account, and add the{' '}
                        <code>account.updated</code> event ("events on connected accounts") to the webhook endpoint. Payouts come out of
                        the shop's Stripe balance. <A href="/admin/shop/affiliates">Manage affiliates →</A>
                    </p>
                    <div>
                        <button type="button" class="ui-button ui-button--primary" onClick={() => void save()} disabled={saving()}>
                            {saving() ? 'Saving…' : 'Save affiliate settings'}
                        </button>
                    </div>
                </Show>
            </Show>
        </section>
    );
};

export default AffiliateProgramSettings;
