/**
 * Posts → Settings → Contributions: pay contributors for approved posts.
 * Default payout, currency, holding period, automatic payout schedule and the
 * Stripe Connect setup (the connected-accounts webhook signing secret is the
 * SAME shared partner secret the affiliate settings show).
 */
import { A, } from '@solidjs/router';
import type { AffiliatePayoutSchedule, ContributorSettings, } from '@sitesurge/types';
import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import Toggle from '../common/Toggle';
import { CommitInput, FormField, } from '../forms';
import { useToast, } from '../../common/toast';
import { cms, } from '../../../services/cmsClient';
import { centsToDollarsInput, parseDollars, } from './money';
import './contributions.scss';

const SCHEDULES: { value: AffiliatePayoutSchedule; label: string; }[] = [
    { value: 'off', label: 'Off — manual payouts only', },
    { value: 'weekly', label: 'Weekly', },
    { value: 'biweekly', label: 'Every 2 weeks', },
    { value: 'monthly', label: 'Monthly (1st of the month)', },
];

const ContributorSettingsPanel: Component = () => {
    const toast = useToast();
    const [loaded, setLoaded,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [draft, setDraft,] = createStore<ContributorSettings>({
        enabled: false, defaultPayoutCents: 4000, currency: 'usd', holdDays: 0, payoutSchedule: 'off', lastAutoPayoutAt: null, connectWebhookSecret: '',
    },);

    onMount(async () => {
        try {
            setDraft(await cms.contributions.settings(),);
        } catch (e) {
            toast.error(`Could not load the contributor settings: ${(e as Error).message}`,);
        } finally {
            setLoaded(true,);
        }
    },);

    const save = async () => {
        setSaving(true,);
        try {
            const s = await cms.contributions.updateSettings({
                enabled: draft.enabled,
                defaultPayoutCents: draft.defaultPayoutCents,
                currency: draft.currency,
                holdDays: draft.holdDays,
                payoutSchedule: draft.payoutSchedule,
                connectWebhookSecret: draft.connectWebhookSecret ?? '',
            },);
            setDraft(s,);
            toast.success('Contributor settings saved.',);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not save the contributor settings.',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <section class="admin-section contributor-settings">
            <header class="admin-section__header">
                <h2>Contributor payouts</h2>
                <p class="form-help-muted">
                    Pay contributors for their posts. When an admin approves and publishes a contributor's post, the payout is credited
                    to the contributor's Partner Program balance and paid out to their connected Stripe account.
                </p>
            </header>
            <Show when={loaded()} fallback={<p class="form-help-muted">Loading…</p>}>
                <Toggle
                    checked={draft.enabled}
                    onChange={(v,) => setDraft('enabled', v,)}
                    label="Pay contributors for approved posts"
                    hint="Off: approving a post only publishes it (no payout is credited)."
                />
                <Show when={draft.enabled}>
                    <div class="admin-form-row">
                        <FormField label="Default payout" hint="Credited for each approved contribution — can be changed per post when approving.">
                            <CommitInput
                                value={centsToDollarsInput(draft.defaultPayoutCents,)}
                                validate={(v,) => (parseDollars(v,) === null ? 'Enter an amount, e.g. 40 or 40.00.' : null)}
                                onCommit={(v,) => { const c = parseDollars(v,); if (c !== null) setDraft('defaultPayoutCents', c,); }}
                                placeholder="40.00"
                            />
                        </FormField>
                        <FormField label="Currency" hint="3 letters, e.g. usd.">
                            <CommitInput
                                value={draft.currency}
                                validate={(v,) => (/^[a-z]{3}$/i.test(v,) ? null : 'A 3-letter code, e.g. usd.')}
                                onCommit={(v,) => setDraft('currency', v.toLowerCase(),)}
                            />
                        </FormField>
                        <FormField label="Holding period (days)" tooltip="Days after approval before an earning can be paid out. During this time it can still be changed or revoked.">
                            <CommitInput
                                type="number"
                                min={0}
                                max={365}
                                value={draft.holdDays}
                                onCommit={(v,) => setDraft('holdDays', Math.min(365, Math.max(0, Math.round(Number(v,) || 0,),),),)}
                            />
                        </FormField>
                    </div>
                    <FormField label="Automatic payouts" hint="Payable earnings are transferred on this schedule. A manual Pay out is always available on Posts → Contributions.">
                        <select value={draft.payoutSchedule} onChange={(e,) => setDraft('payoutSchedule', e.currentTarget.value as AffiliatePayoutSchedule,)}>
                            <For each={SCHEDULES}>{(s,) => <option value={s.value} selected={s.value === draft.payoutSchedule}>{s.label}</option>}</For>
                        </select>
                    </FormField>
                    <Show when={draft.lastAutoPayoutAt}>
                        <p class="form-help-muted">Last automatic payout run: {new Date(draft.lastAutoPayoutAt!,).toLocaleString()}</p>
                    </Show>

                    <div class="contributor-settings__stripe">
                        <h3>Stripe setup</h3>
                        <ol class="form-help-muted">
                            <li>In the shop's Stripe account, open <strong>Connect</strong> (dashboard.stripe.com/connect) and finish its setup, including the platform profile.</li>
                            <li>
                                In <strong>Developers → Webhooks</strong>, add an endpoint with URL <code>{`${location.origin}/api/v1/payments/webhook`}</code>,
                                listening to <strong>Events on connected accounts</strong>, with the event <code>account.updated</code>.
                            </li>
                            <li>Copy that endpoint's <strong>signing secret</strong> (whsec_…) below. It is shared with the affiliate program.</li>
                        </ol>
                        <FormField
                            label="Connect webhook signing secret"
                            hint="Of the connected-accounts endpoint (not the shop's own endpoint). Keeps each partner's payout status current."
                        >
                            <CommitInput value={draft.connectWebhookSecret ?? ''} placeholder="whsec_…" onCommit={(v,) => setDraft('connectWebhookSecret', v.trim(),)} />
                        </FormField>
                        <p class="form-help-muted">Payouts come out of the shop's Stripe balance. <A href="/admin/posts?view=contributions">See contributions →</A></p>
                    </div>
                </Show>
                <div>
                    <button type="button" class="ui-button ui-button--primary" onClick={() => void save()} disabled={saving()}>
                        {saving() ? 'Saving…' : 'Save contributor settings'}
                    </button>
                </div>
            </Show>
        </section>
    );
};

export default ContributorSettingsPanel;
