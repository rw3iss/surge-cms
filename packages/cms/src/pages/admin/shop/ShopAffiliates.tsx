/**
 * Shop → Affiliates (feature `affiliates`, permission `affiliates:manage`):
 * program numbers, every affiliate (users with the affiliate role, Shop →
 * Settings → Affiliate program) with their Stripe status, codes, sales and
 * balance; per member: codes (commission %, max uses, uses), commissions,
 * payouts and "Pay out".
 */
import { A, } from '@solidjs/router';
import type { AffiliateMember, AffiliateMemberDetail, ShopDiscountCode, } from '@sitesurge/types';
import { formatPercent, } from '@sitesurge/types';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import ConfirmModal from '../../../components/admin/common/ConfirmModal';
import LoadingState from '../../../components/admin/common/LoadingState';
import ModalShell from '../../../components/admin/common/ModalShell';
import DiscountCodeModal from '../../../components/admin/discounts/DiscountCodeModal';
import DiscountCodeTable from '../../../components/admin/discounts/DiscountCodeTable';
import '../../../components/admin/discounts/discounts.scss';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import { isFeatureEnabled, } from '../../../stores/siteSettings';
import { formatDay as day, formatMoney as money, payoutStatusForAdmin, SCHEDULE_LABEL, stripeState, } from '../../../components/admin/contributions/money';
import ShopGuard from './ShopGuard';

/** Same Stripe badge as Posts → Contributions → Payouts. */
function stripeBadge(s: AffiliateMember['stripe'],) {
    const st = stripeState(s,);
    return <span class={`badge badge--${st.tone}`}>{st.label}</span>;
}

const STATUS_LABEL: Record<string, string> = { pending: 'In refund window', available: 'Payable', paid: 'Paid', reversed: 'Reversed', };

/** One affiliate: codes, commissions, payouts, Pay out. */
const MemberModal: Component<{ userId: string; defaultCommission: number; onClose: () => void; onChanged: () => void; }> = (props,) => {
    const toast = useToast();
    const [m, { refetch, },] = createResource(() => props.userId, (id,) => cms.affiliates.adminMember(id,),);
    // Read only once resolved (`.latest`): a refetch after a change must not
    // suspend the admin page behind this modal.
    const member = () => (m.state === 'ready' || m.state === 'refreshing' ? m.latest : undefined);
    const [editing, setEditing,] = createSignal<ShopDiscountCode | null | undefined>(undefined,);
    const [confirmPay, setConfirmPay,] = createSignal(false,);
    const [paying, setPaying,] = createSignal(false,);
    const changed = () => { void refetch(); props.onChanged(); };

    const payOut = async () => {
        if (paying()) return;
        setPaying(true,);
        try {
            const r = await cms.affiliates.adminPayout(props.userId,);
            if (r.paid) toast.success(r.message,);
            else toast.error(r.message,);
            changed();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'The payout failed.',);
        } finally {
            setPaying(false,);
            setConfirmPay(false,);
        }
    };

    return (
        <ModalShell open onClose={props.onClose} size="lg" showClose ariaLabel="Affiliate">
            <Show
                when={member()}
                fallback={
                    <div class="affiliate-admin__member">
                        <Show when={m.state === 'errored'} fallback={<LoadingState />}>
                            <p class="alert alert--error" role="alert">This affiliate could not be loaded{m.error instanceof Error ? `: ${m.error.message}` : '.'}</p>
                        </Show>
                    </div>
                }
            >
                {(d: () => AffiliateMemberDetail,) => (
                    <div class="affiliate-admin__member">
                        <div class="affiliate-admin__member-head">
                            <div>
                                <h2>{d().displayName}</h2>
                                <p class="form-help-muted">{d().email} · {stripeBadge(d().stripe,)} · <A href={`/admin/users/${d().userId}`}>User details</A></p>
                            </div>
                            <button
                                type="button"
                                class="ui-button ui-button--primary"
                                disabled={paying() || d().balance.availableCents <= 0 || !d().stripe.payoutsEnabled}
                                title={!d().stripe.payoutsEnabled ? 'They have not finished connecting Stripe yet' : undefined}
                                onClick={() => setConfirmPay(true,)}
                            >
                                Pay out {money(d().balance.availableCents, d().balance.currency,)}
                            </button>
                        </div>

                        <div class="affiliate-admin__stats">
                            <div class="affiliate-admin__stat"><span>Orders</span><strong>{d().orders}</strong></div>
                            <div class="affiliate-admin__stat"><span>Sales</span><strong>{money(d().salesCents, d().balance.currency,)}</strong></div>
                            <div class="affiliate-admin__stat"><span>Payable now</span><strong>{money(d().balance.availableCents, d().balance.currency,)}</strong></div>
                            <div class="affiliate-admin__stat"><span>In refund window</span><strong>{money(d().balance.pendingCents, d().balance.currency,)}</strong></div>
                            <div class="affiliate-admin__stat"><span>Paid</span><strong>{money(d().balance.paidCents, d().balance.currency,)}</strong></div>
                        </div>

                        <section class="admin-section">
                            <header class="admin-section__header">
                                <h2>Codes</h2>
                                <p class="form-help-muted">Each paid order using a code earns its commission (of the merchandise subtotal), minus any buyer discount.</p>
                            </header>
                            <DiscountCodeTable codes={d().codes} onEdit={(c,) => setEditing(c,)} onChanged={changed} emptyText="No codes yet." />
                            <div><button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => setEditing(null,)}>+ New code</button></div>
                        </section>

                        <section class="admin-section">
                            <header class="admin-section__header"><h2>Commissions</h2></header>
                            <Show when={d().earnings.length} fallback={<p class="form-help-muted">No sales yet.</p>}>
                                <div class="admin-table-container">
                                    <table class="admin-table">
                                        <thead><tr><th>Date</th><th>Order</th><th>Code</th><th>Merchandise</th><th>Share</th><th>Amount</th><th>Status</th></tr></thead>
                                        <tbody>
                                            <For each={d().earnings}>
                                                {(e,) => (
                                                    <tr>
                                                        <td>{day(e.createdAt,)}</td>
                                                        <td><A href={`/admin/shop/orders?search=${encodeURIComponent(e.orderNumber,)}`}>{e.orderNumber}</A></td>
                                                        <td>{e.code ?? '—'}</td>
                                                        <td>{e.kind === 'reversal' ? '—' : money(e.merchSubtotalCents, e.currency,)}</td>
                                                        <td>{e.kind === 'reversal' ? 'Refund' : `${formatPercent(e.sharePercent,)}%`}</td>
                                                        <td>{money(e.amountCents, e.currency,)}</td>
                                                        <td>{STATUS_LABEL[e.status] ?? e.status}</td>
                                                    </tr>
                                                )}
                                            </For>
                                        </tbody>
                                    </table>
                                </div>
                            </Show>
                        </section>

                        <section class="admin-section">
                            <header class="admin-section__header"><h2>Payouts</h2></header>
                            <Show when={d().payouts.length} fallback={<p class="form-help-muted">No payouts yet.</p>}>
                                <div class="admin-table-container">
                                    <table class="admin-table">
                                        <thead><tr><th>Date</th><th>Amount</th><th>How</th><th>Status</th></tr></thead>
                                        <tbody>
                                            <For each={d().payouts}>
                                                {(p,) => (
                                                    <tr>
                                                        <td>{day(p.createdAt,)}</td>
                                                        <td>{money(p.amountCents, p.currency,)}</td>
                                                        <td>{p.trigger === 'auto' ? 'Automatic' : 'Manual'}</td>
                                                        <td>{payoutStatusForAdmin(p.status,)}{p.error ? <span class="form-help-muted"> — {p.error}</span> : ''}</td>
                                                    </tr>
                                                )}
                                            </For>
                                        </tbody>
                                    </table>
                                </div>
                            </Show>
                        </section>

                        <Show when={editing() !== undefined}>
                            <DiscountCodeModal
                                open
                                code={editing()}
                                affiliateUserId={d().userId}
                                defaultCommission={props.defaultCommission}
                                onClose={() => setEditing(undefined,)}
                                onSaved={() => { setEditing(undefined,); changed(); }}
                            />
                        </Show>
                        <ConfirmModal
                            open={confirmPay()}
                            title={`Pay ${d().displayName}?`}
                            message={`Transfers ${money(d().balance.availableCents, d().balance.currency,)} (commissions past the refund window) to their Stripe account now.`}
                            confirmLabel="Pay out"
                            busyLabel="Paying…"
                            loading={paying()}
                            onConfirm={() => void payOut()}
                            onCancel={() => { if (!paying()) setConfirmPay(false,); }}
                        />
                    </div>
                )}
            </Show>
        </ModalShell>
    );
};

const ShopAffiliatesInner: Component = () => {
    const [loadError, setLoadError,] = createSignal('',);
    const [members, { refetch, },] = createResource(() =>
        cms.affiliates.adminMembers().then((r,) => { setLoadError('',); return r; },).catch((e,) => {
            setLoadError(e instanceof Error ? e.message : 'The affiliates could not be loaded.',);
            return [] as AffiliateMember[];
        },)
    );
    // Stats + settings only decorate the page: a failure leaves their defaults.
    const [stats, { refetch: refetchStats, },] = createResource(() => cms.affiliates.adminStats().catch(() => null,),);
    const [settings,] = createResource(() => cms.affiliates.settings().catch(() => null,),);
    const [open, setOpen,] = createSignal<string | null>(null,);

    return (
        <div class="shop-admin affiliate-admin">
            <AdminTitle>Affiliates</AdminTitle>
            <div class="admin-header">
                <A href="/admin/shop" class="admin-header__back">← Shop</A>
                <h1>Affiliates</h1>
                <div class="admin-header__actions">
                    <A href="/admin/shop/settings?tab=affiliates" class="ui-button ui-button--secondary">Program settings</A>
                </div>
            </div>

            <Show when={stats.latest}>
                {(s,) => (
                    <div class="affiliate-admin__stats">
                        <div class="affiliate-admin__stat"><span>Affiliates</span><strong>{s().members}</strong></div>
                        <div class="affiliate-admin__stat"><span>Sales · 30 days</span><strong>{money(s().salesCents30d, s().currency,)}</strong></div>
                        <div class="affiliate-admin__stat"><span>Commission · 30 days</span><strong>{money(s().commissionCents30d, s().currency,)}</strong></div>
                        <div class="affiliate-admin__stat"><span>Owed</span><strong>{money(s().owedCents, s().currency,)}</strong></div>
                        <div class="affiliate-admin__stat"><span>Payable now</span><strong>{money(s().availableCents, s().currency,)}</strong></div>
                    </div>
                )}
            </Show>

            <section class="admin-section">
                <header class="admin-section__header">
                    <h2>Members</h2>
                    <p class="form-help-muted">
                        Users with the <code>{settings.latest?.role ?? 'affiliate'}</code> role. Give them codes, see their sales and pay them out.
                        Automatic payouts: <strong>{SCHEDULE_LABEL[settings.latest?.payoutSchedule ?? 'off'] ?? settings.latest?.payoutSchedule}</strong>; commissions become payable {settings.latest?.refundWindowDays ?? 30} days after payment.
                    </p>
                </header>
                <Show when={!members.loading || members.latest} fallback={<LoadingState />}>
                    <Show when={!loadError()} fallback={<p class="alert alert--error" role="alert">{loadError()}</p>}>
                    <Show when={(members.latest ?? []).length} fallback={<p class="form-help-muted">No affiliates yet. Give a user the affiliate role (or approve their Affiliate program application).</p>}>
                        <div class="admin-table-container">
                            <table class="admin-table">
                                <thead><tr><th>Affiliate</th><th>Stripe</th><th>Codes</th><th>Orders</th><th>Sales</th><th>Payable</th><th>In refund window</th><th /></tr></thead>
                                <tbody>
                                    <For each={members.latest}>
                                        {(m,) => (
                                            <tr>
                                                <td><strong>{m.displayName}</strong><div class="form-help-muted">{m.email}</div></td>
                                                <td>{stripeBadge(m.stripe,)}</td>
                                                <td>{m.codes.map((c,) => c.code,).join(', ',) || '—'}</td>
                                                <td>{m.orders}</td>
                                                <td>{money(m.salesCents, m.balance.currency,)}</td>
                                                <td>{money(m.balance.availableCents, m.balance.currency,)}</td>
                                                <td>{money(m.balance.pendingCents, m.balance.currency,)}</td>
                                                <td><button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => setOpen(m.userId,)}>Manage</button></td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                        </div>
                    </Show>
                    </Show>
                </Show>
            </section>

            <Show when={open()}>
                <MemberModal
                    userId={open()!}
                    defaultCommission={settings.latest?.defaultCommissionPercent ?? 10}
                    onClose={() => setOpen(null,)}
                    onChanged={() => { void refetch(); void refetchStats(); }}
                />
            </Show>
        </div>
    );
};

const ShopAffiliates: Component = () => (
    <ShopGuard>
        <Show
            when={isFeatureEnabled('affiliates',)}
            fallback={
                <div class="shop-admin">
                    <p class="form-help-muted">
                        The affiliate program is off. Turn it on in <A href="/admin/shop/settings?tab=affiliates">Shop → Settings → Affiliate program</A>.
                    </p>
                </div>
            }
        >
            <ShopAffiliatesInner />
        </Show>
    </ShopGuard>
);

export default ShopAffiliates;
