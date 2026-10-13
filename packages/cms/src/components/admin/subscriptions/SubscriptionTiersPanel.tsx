/**
 * Users Settings → Subscriptions: every subscription tier — what subscribers
 * get (a role + extra permissions) and what they buy (a Stripe price). `free`
 * is everyone without a paid subscription.
 */
import { A, } from '@solidjs/router';
import { createResource, createSignal, For, Show, type Component, } from 'solid-js';
import type { PermissionWithGrants, RoleDef, StripeSubscriptionPrice, SubscriptionTier, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ConfirmModal from '../common/ConfirmModal';
import TierModal from './TierModal';
import './Subscriptions.scss';

const money = (t: SubscriptionTier,) =>
    t.isFree ? 'Free' : t.stripePriceId
        ? `$${(t.priceCents / 100).toFixed(2,)}${t.intervalCount > 1 ? ` every ${t.intervalCount} ${t.interval}s` : ` / ${t.interval}`}`
            + (t.displayPrice
                ? ` (shown as $${(t.displayPrice.priceCents / 100).toFixed(2,)}${t.displayPrice.intervalCount > 1 ? ` every ${t.displayPrice.intervalCount} ${t.displayPrice.interval}s` : ` / ${t.displayPrice.interval}`})`
                : '')
        : '— (no Stripe price)';

/** "$250.00 / year", "$1,500.00 every 2 weeks". */
const stripePriceText = (p: StripeSubscriptionPrice,) =>
    `${p.unitAmount !== null ? `$${(p.unitAmount / 100).toFixed(2,)}` : 'custom'}${p.intervalCount > 1 ? ` every ${p.intervalCount} ${p.interval}s` : ` / ${p.interval}`}`;

const SubscriptionTiersPanel: Component = () => {
    const toast = useToast();
    const [tiers, { refetch, },] = createResource(() => cms.subscriptionTiers.list().catch(() => [] as SubscriptionTier[]),);
    const [roles,] = createResource(() => cms.roles.list().catch(() => [] as RoleDef[]),);
    const [perms,] = createResource(() => cms.permissions.list().catch(() => [] as PermissionWithGrants[]),);
    // The other prices on each level's Stripe product (members choose between them).
    const [stripePrices,] = createResource(() => cms.subscriptionTiers.stripePrices().then((r,) => r.prices,).catch(() => [] as StripeSubscriptionPrice[]),);
    const otherPrices = (t: SubscriptionTier,) =>
        t.stripeProductId && t.stripePriceId
            ? (stripePrices() ?? []).filter((p,) => p.productId === t.stripeProductId && p.priceId !== t.stripePriceId,)
            : [];
    const [editing, setEditing,] = createSignal<SubscriptionTier | 'new' | null>(null,);
    const [deleting, setDeleting,] = createSignal<SubscriptionTier | null>(null,);

    const roleLabel = (key: string | null,) => (key ? roles()?.find((r,) => r.key === key,)?.label ?? key : '—');

    const doDelete = async () => {
        const t = deleting();
        if (!t) return;
        try {
            await cms.subscriptionTiers.remove(t.id,);
            toast.success('Membership level deleted.',);
            await refetch();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not delete it.',);
        } finally {
            setDeleting(null,);
        }
    };

    return (
        <section class="admin-section admin-section--wide subscriptions-panel">
            <header class="admin-section__header">
                <h2>Memberships</h2>
                <div class="admin-section__actions">
                    <button type="button" class="ui-button ui-button--primary ui-button--sm" onClick={() => setEditing('new',)}>+ New membership level</button>
                </div>
            </header>
            <p class="form-help-muted">
                A membership level gives its members a <strong>role</strong> (and everything that role can do) plus any extra permissions,
                and is sold through a recurring Stripe price. <strong>Free</strong> is everyone with an account and no paid membership.
                Roles are managed in Settings → Permissions.
            </p>
            <div class="admin-table-container">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Membership</th><th>Role</th><th>Price</th><th>Extra permissions</th><th>Members</th><th>Status</th><th />
                        </tr>
                    </thead>
                    <tbody>
                        <For each={tiers() ?? []}>
                            {(t,) => (
                                <tr>
                                    <td>
                                        <strong>{t.name}</strong> <code class="subscriptions-panel__slug">{t.slug}</code>
                                        <Show when={t.description}><div class="form-help-muted">{t.description}</div></Show>
                                        <Show when={t.requiresApproval}>
                                            <div class="subscriptions-panel__approval">
                                                <span class="badge badge--warning">Requires approval</span>
                                                <Show when={t.pendingApplications > 0}>
                                                    {' '}<A href="/admin/users?approval=pending">{t.pendingApplications} pending</A>
                                                </Show>
                                            </div>
                                        </Show>
                                    </td>
                                    <td>{roleLabel(t.role,)}</td>
                                    <td>
                                        {money(t,)}
                                        <Show when={otherPrices(t,).length}>
                                            {' '}
                                            <span class="tier-panel__more-prices" title={`Also: ${otherPrices(t,).map(stripePriceText,).join(', ',)}`}>
                                                +{otherPrices(t,).length} more
                                            </span>
                                        </Show>
                                    </td>
                                    <td>{t.permissions.length || '—'}</td>
                                    <td>{t.subscriberCount}</td>
                                    <td><span class={`badge ${t.isActive ? 'badge--success' : 'badge--muted'}`}>{t.isActive ? 'Active' : 'Inactive'}</span></td>
                                    <td style={{ 'text-align': 'right', 'white-space': 'nowrap', }}>
                                        <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => setEditing(t,)}>Edit</button>
                                        <Show when={!t.isFree}>
                                            {' '}<button type="button" class="ui-button ui-button--danger ui-button--sm" onClick={() => setDeleting(t,)}>Delete</button>
                                        </Show>
                                    </td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
            </div>

            <Show when={editing() && roles() && perms()}>
                <TierModal
                    tier={editing() === 'new' ? null : (editing() as SubscriptionTier)}
                    roles={roles()!}
                    permissions={perms()!}
                    onClose={() => setEditing(null,)}
                    onSaved={() => { setEditing(null,); void refetch(); }}
                />
            </Show>
            <ConfirmModal
                open={deleting() !== null}
                title="Delete membership level"
                message={`Delete "${deleting()?.name ?? ''}"? Only a membership level that never had members can be deleted — otherwise deactivate it.`}
                confirmLabel="Delete"
                danger
                onConfirm={doDelete}
                onCancel={() => setDeleting(null,)}
            />
        </section>
    );
};

export default SubscriptionTiersPanel;
