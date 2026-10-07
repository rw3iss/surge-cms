/**
 * User details → Subscription: the user's tier (paid through Stripe, assigned
 * by hand, or the free tier), and — for non-Stripe users — a way to put them
 * on a tier by hand (a comp, a YouTube/Patreon supporter reconciled manually).
 * A Stripe subscriber is changed or cancelled in Stripe.
 */
import { A, } from '@solidjs/router';
import { createResource, createSignal, For, Show, type Component, } from 'solid-js';
import type { SubscriptionTier, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';

const SOURCE: Record<string, string> = { stripe: 'Paid (Stripe)', manual: 'Assigned by an admin', free: 'No paid subscription', };

const UserSubscriptionPanel: Component<{ userId: string; onChanged?: () => void; }> = (props,) => {
    const toast = useToast();
    const [info, { refetch, },] = createResource(() => props.userId, (id,) => cms.users.subscription(id,).catch(() => null),);
    const [tiers,] = createResource(() => cms.subscriptionTiers.list().catch(() => [] as SubscriptionTier[]),);
    const [choice, setChoice,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);

    const assign = async () => {
        setBusy(true,);
        try {
            await cms.users.assignSubscription(props.userId, choice() || null,);
            toast.success('Subscription updated.',);
            setChoice('',);
            await refetch();
            props.onChanged?.();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not change the subscription.',);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <div class="user-detail__panel">
            <h2 class="user-detail__panel-title">Subscription</h2>
            <Show when={info()} fallback={<p class="form-help-muted">Loading…</p>}>
                <div class="user-detail__info-grid">
                    <div class="user-detail__info-item">
                        <span class="user-detail__info-label">Tier</span>
                        <span class="user-detail__info-value"><strong>{info()!.tier?.name ?? '—'}</strong>{info()!.tier?.role ? ` · role ${info()!.tier!.role}` : ''}</span>
                    </div>
                    <div class="user-detail__info-item">
                        <span class="user-detail__info-label">Source</span>
                        <span class="user-detail__info-value">{SOURCE[info()!.source]}{info()!.status ? ` (${info()!.status})` : ''}</span>
                    </div>
                    <Show when={info()!.currentPeriodEnd}>
                        <div class="user-detail__info-item">
                            <span class="user-detail__info-label">{info()!.cancelAtPeriodEnd ? 'Ends' : 'Renews'}</span>
                            <span class="user-detail__info-value">{new Date(info()!.currentPeriodEnd!,).toLocaleDateString()}</span>
                        </div>
                    </Show>
                </div>
                <Show
                    when={info()!.source !== 'stripe'}
                    fallback={<p class="form-help-muted">This user pays through Stripe — change or cancel the subscription in Stripe; their tier and role follow automatically.</p>}
                >
                    <div class="u-flex-row u-gap-sm" style={{ 'margin-top': '0.75rem', 'align-items': 'center', }}>
                        <select value={choice()} onChange={(e,) => setChoice(e.currentTarget.value,)}>
                            <option value="">Put on a tier…</option>
                            <For each={(tiers() ?? []).filter((t,) => t.isActive,)}>{(t,) => <option value={t.id}>{t.name}</option>}</For>
                        </select>
                        <button type="button" class="ui-button ui-button--secondary ui-button--sm" disabled={!choice() || busy()} onClick={assign}>
                            {busy() ? 'Saving…' : 'Apply'}
                        </button>
                        <A href="/admin/users/settings?tab=subscriptions" class="form-help-muted">Manage tiers</A>
                    </div>
                </Show>
            </Show>
        </div>
    );
};

export default UserSubscriptionPanel;
