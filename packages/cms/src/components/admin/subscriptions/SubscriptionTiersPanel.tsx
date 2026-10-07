/**
 * Users Settings → Subscriptions: every subscription tier — what subscribers
 * get (a role + extra permissions) and what they buy (a Stripe price). `free`
 * is everyone without a paid subscription.
 */
import { createResource, createSignal, For, Show, type Component, } from 'solid-js';
import type { PermissionWithGrants, RoleDef, SubscriptionTier, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ConfirmModal from '../common/ConfirmModal';
import TierModal from './TierModal';
import './Subscriptions.scss';

const money = (t: SubscriptionTier,) =>
    t.isFree ? 'Free' : t.stripePriceId ? `$${(t.priceCents / 100).toFixed(2,)} / ${t.interval}` : '— (no Stripe price)';

const SubscriptionTiersPanel: Component = () => {
    const toast = useToast();
    const [tiers, { refetch, },] = createResource(() => cms.subscriptionTiers.list().catch(() => [] as SubscriptionTier[]),);
    const [roles,] = createResource(() => cms.roles.list().catch(() => [] as RoleDef[]),);
    const [perms,] = createResource(() => cms.permissions.list().catch(() => [] as PermissionWithGrants[]),);
    const [editing, setEditing,] = createSignal<SubscriptionTier | 'new' | null>(null,);
    const [deleting, setDeleting,] = createSignal<SubscriptionTier | null>(null,);

    const roleLabel = (key: string | null,) => (key ? roles()?.find((r,) => r.key === key,)?.label ?? key : '—');

    const doDelete = async () => {
        const t = deleting();
        if (!t) return;
        try {
            await cms.subscriptionTiers.remove(t.id,);
            toast.success('Subscription deleted.',);
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
                <h2>Subscriptions</h2>
                <div class="admin-section__actions">
                    <button type="button" class="ui-button ui-button--primary ui-button--sm" onClick={() => setEditing('new',)}>+ New subscription</button>
                </div>
            </header>
            <p class="form-help-muted">
                A subscription gives its subscribers a <strong>role</strong> (and everything that role can do) plus any extra permissions,
                and is sold through a recurring Stripe price. <strong>Free</strong> is everyone with an account and no paid subscription.
                Roles are managed in Settings → Permissions.
            </p>
            <div class="admin-table-container">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Subscription</th><th>Role</th><th>Price</th><th>Extra permissions</th><th>Subscribers</th><th>Status</th><th />
                        </tr>
                    </thead>
                    <tbody>
                        <For each={tiers() ?? []}>
                            {(t,) => (
                                <tr>
                                    <td>
                                        <strong>{t.name}</strong> <code class="subscriptions-panel__slug">{t.slug}</code>
                                        <Show when={t.description}><div class="form-help-muted">{t.description}</div></Show>
                                    </td>
                                    <td>{roleLabel(t.role,)}</td>
                                    <td>{money(t,)}</td>
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
                title="Delete subscription"
                message={`Delete "${deleting()?.name ?? ''}"? Only a subscription that never had subscribers can be deleted — otherwise deactivate it.`}
                confirmLabel="Delete"
                danger
                onConfirm={doDelete}
                onCancel={() => setDeleting(null,)}
            />
        </section>
    );
};

export default SubscriptionTiersPanel;
