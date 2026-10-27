/**
 * Profile → Partner Program (affiliates + contributors). ONE Stripe Connect
 * Express account per partner (top), the totals across programs, then a tab
 * per program the member is in:
 *   - Affiliate sales → the affiliate page (`AffiliatePanel embedded`);
 *   - Contributions  → their contributed posts, payouts and the payout rule.
 * `?program=affiliate|contributions` picks the tab (the contribution-published
 * email links `?tab=partners&program=contributions`); `?stripe=return|refresh`
 * (back from Stripe onboarding) re-reads the account once.
 */
import type { Contribution, ContributionEarningStatus, ContributionState, PartnerMeResponse, } from '@sitesurge/types';
import { formatCurrency, } from '@sitesurge/types';
import { A, useSearchParams, } from '@solidjs/router';
import { Component, createResource, createSignal, For, lazy, onMount, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { Tabs, } from '../ui/Tabs';
import './AffiliatePanel.scss';
import './PartnerProgramPanel.scss';

const AffiliatePanel = lazy(() => import('./AffiliatePanel'));

type Program = 'affiliate' | 'contributions';

const money = (c: number, cur = 'usd',) => formatCurrency(c, cur.toUpperCase(),);
const day = (iso: string | null,) => (iso ? new Date(iso,).toLocaleDateString(undefined, { dateStyle: 'medium', },) : '—');

const STATE_LABEL: Record<ContributionState, string> = {
    pending_review: 'Waiting for review',
    returned: 'Returned',
    approved: 'Approved',
    paid: 'Paid',
    revoked: 'Payout revoked',
};
const EARNING_LABEL: Record<ContributionEarningStatus, string> = {
    pending: 'Pending',
    available: 'Payable',
    paid: 'Paid',
    revoked: 'Revoked',
};

/** Contributions tab: counts, the payout rule, the posts, the payouts. */
const ContributionsTab: Component<{ c: NonNullable<PartnerMeResponse['contributions']>; currency: string; }> = (props,) => {
    const count = (s: ContributionState,) => props.c.items.filter((i,) => i.state === s,).length;
    const earning = (i: Contribution,) => {
        const e = i.earning;
        if (!e) return '—';
        const when = e.status === 'pending' ? ` (from ${day(e.availableAt,)})` : '';
        return `${money(e.amountCents, e.currency,)} · ${EARNING_LABEL[e.status]}${when}`;
    };
    return (
        <div class="partner-contributions">
            <div class="partner-contributions__head">
                <p class="profile__muted">
                    You earn <strong>{money(props.c.defaultPayoutCents, props.currency,)}</strong> per approved post
                    {props.c.holdDays > 0 ? `; payable ${props.c.holdDays} day${props.c.holdDays === 1 ? '' : 's'} after approval` : '; payable once approved'}.
                </p>
                <A href="/admin/posts/new" class="btn btn--primary">Write a new post</A>
            </div>

            <div class="partner-contributions__counts">
                <For each={['pending_review', 'returned', 'approved', 'paid',] as ContributionState[]}>
                    {(s,) => (
                        <div class={`partner-contributions__count partner-contributions__count--${s}`}>
                            <strong>{count(s,)}</strong>
                            <span>{STATE_LABEL[s]}</span>
                        </div>
                    )}
                </For>
            </div>

            <div class="affiliate-panel__balance affiliate-panel__balance--sub">
                <div><span>Contributions payable</span><strong>{money(props.c.balance.availableCents, props.c.balance.currency,)}</strong></div>
                <div><span>Contributions pending</span><strong>{money(props.c.balance.pendingCents, props.c.balance.currency,)}</strong></div>
                <div><span>Contributions paid</span><strong>{money(props.c.balance.paidCents, props.c.balance.currency,)}</strong></div>
            </div>

            <section class="affiliate-panel__section">
                <h3>Your contributions</h3>
                <Show when={props.c.items.length} fallback={<p class="profile__muted">You have not submitted a post yet.</p>}>
                    <div class="affiliate-panel__table-wrap">
                        <table class="affiliate-panel__table">
                            <thead><tr><th>Post</th><th>Status</th><th>Submitted</th><th>Payout</th></tr></thead>
                            <tbody>
                                <For each={props.c.items}>
                                    {(i,) => (
                                        <tr>
                                            <td>
                                                <A href={`/admin/posts/${i.postId}`}>{i.title || 'Untitled'}</A>
                                                <Show when={i.state === 'returned' && i.reviewNote}>
                                                    <div class="partner-contributions__note">Returned: {i.reviewNote}</div>
                                                </Show>
                                            </td>
                                            <td><span class={`partner-contributions__state partner-contributions__state--${i.state}`}>{STATE_LABEL[i.state]}</span></td>
                                            <td>{day(i.submittedAt,)}</td>
                                            <td>{earning(i,)}</td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                </Show>
            </section>

            <section class="affiliate-panel__section">
                <h3>Contribution payouts</h3>
                <Show when={props.c.payouts.length} fallback={<p class="profile__muted">No payouts yet.</p>}>
                    <div class="affiliate-panel__table-wrap">
                        <table class="affiliate-panel__table">
                            <thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
                            <tbody>
                                <For each={props.c.payouts}>
                                    {(p,) => (
                                        <tr>
                                            <td>{day(p.createdAt,)}</td>
                                            <td>{money(p.amountCents, p.currency,)}</td>
                                            <td>{p.status === 'paid' ? 'Sent' : p.status === 'failed' ? 'Failed — our team will retry' : 'Processing'}</td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                </Show>
            </section>
        </div>
    );
};

const PartnerProgramPanel: Component = () => {
    const [params, setParams,] = useSearchParams<{ program?: string; stripe?: string; }>();
    const [data, { refetch, mutate, },] = createResource<PartnerMeResponse>(() => cms.partners.me(),);
    const [linking, setLinking,] = createSignal(false,);
    const [refreshing, setRefreshing,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const refreshStripe = async () => {
        setRefreshing(true,);
        setError('',);
        try {
            const stripe = await cms.partners.stripeRefresh();
            const d = data();
            if (d) mutate({ ...d, stripe, },);
            else void refetch();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not refresh your Stripe status.',);
        } finally {
            setRefreshing(false,);
        }
    };

    // Back from Stripe onboarding: re-read the account status once.
    onMount(() => {
        if (params.stripe === 'return' || params.stripe === 'refresh') {
            void refreshStripe();
            setParams({ stripe: undefined, },);
        }
    },);

    const go = async (kind: 'onboard' | 'dashboard',) => {
        setLinking(true,);
        setError('',);
        try {
            const { url, } = kind === 'onboard' ? await cms.partners.stripeOnboard() : await cms.partners.stripeDashboard();
            window.location.href = url;
        } catch (e) {
            // e.g. 503 "Payouts are not set up yet…" (Stripe Connect not ready on the shop account).
            setError(e instanceof Error ? e.message : 'Could not open Stripe.',);
            setLinking(false,);
        }
    };

    const programs = (): { value: Program; label: string; }[] => {
        const p = data()?.programs;
        return [
            ...(p?.affiliate ? [{ value: 'affiliate' as Program, label: 'Affiliate sales', },] : []),
            ...(p?.contributor && data()?.contributions ? [{ value: 'contributions' as Program, label: 'Contributions', },] : []),
        ];
    };
    const program = (): Program | null => {
        const list = programs();
        const want = params.program === 'contributions' ? 'contributions' : params.program === 'affiliate' ? 'affiliate' : null;
        return list.find((x,) => x.value === want,)?.value ?? list[0]?.value ?? null;
    };

    return (
        <div class="profile__card partner-panel">
            <Show when={!data.loading || data()} fallback={<p class="profile__muted">Loading your partner account…</p>}>
                <Show
                    when={data()}
                    fallback={
                        <p class="profile__muted">
                            Your partner details could not be loaded{data.error instanceof Error && data.error.message ? `: ${data.error.message}` : '.'}
                        </p>
                    }
                >
                    {(d,) => (
                        <>
                            <section class="affiliate-panel__section partner-panel__stripe">
                                <h3>Getting paid</h3>
                                <ul class="partner-panel__steps">
                                    <li classList={{ 'is-done': d().stripe.connected, }}>Stripe account created</li>
                                    <li classList={{ 'is-done': d().stripe.detailsSubmitted, }}>Details submitted</li>
                                    <li classList={{ 'is-done': d().stripe.payoutsEnabled, }}>Payouts enabled</li>
                                </ul>
                                <Show
                                    when={d().stripe.payoutsEnabled}
                                    fallback={
                                        <p>
                                            {d().stripe.connected
                                                ? 'Finish setting up your Stripe account so we can send your earnings.'
                                                : 'Connect a Stripe account to receive your earnings. Stripe asks for your details and bank account — we never see them.'}
                                        </p>
                                    }
                                >
                                    <p>Your Stripe account is connected — your earnings are sent to it.</p>
                                </Show>
                                <div class="partner-panel__actions">
                                    <Show
                                        when={d().stripe.payoutsEnabled}
                                        fallback={
                                            <button type="button" class="btn btn--primary" disabled={linking()} onClick={() => void go('onboard',)}>
                                                {linking() ? 'Opening Stripe…' : d().stripe.connected ? 'Continue Stripe setup' : 'Connect with Stripe'}
                                            </button>
                                        }
                                    >
                                        <button type="button" class="btn btn--outline" disabled={linking()} onClick={() => void go('dashboard',)}>
                                            {linking() ? 'Opening Stripe…' : 'Open Stripe dashboard'}
                                        </button>
                                    </Show>
                                    <Show when={d().stripe.connected}>
                                        <button type="button" class="btn btn--outline" disabled={refreshing()} onClick={() => void refreshStripe()}>
                                            {refreshing() ? 'Refreshing…' : 'Refresh'}
                                        </button>
                                    </Show>
                                </div>
                                <Show when={error()}><p class="affiliate-panel__error" role="alert">{error()}</p></Show>
                            </section>

                            <div class="affiliate-panel__balance">
                                <div><span>Payable</span><strong>{money(d().totals.availableCents, d().totals.currency,)}</strong></div>
                                <div><span>Pending</span><strong>{money(d().totals.pendingCents, d().totals.currency,)}</strong></div>
                                <div><span>Paid to you</span><strong>{money(d().totals.paidCents, d().totals.currency,)}</strong></div>
                            </div>
                            <p class="profile__muted affiliate-panel__note">
                                Pending earnings are in their holding period; payable ones are sent on the next payout.
                            </p>

                            <Show when={programs().length}>
                                <div class="partner-panel__programs">
                                    <Tabs<Program>
                                        items={programs()}
                                        value={program() ?? undefined}
                                        onChange={(v,) => setParams({ program: v, },)}
                                    />
                                    <Show when={program() === 'affiliate'}>
                                        <AffiliatePanel embedded />
                                    </Show>
                                    <Show when={program() === 'contributions' && d().contributions}>
                                        <ContributionsTab c={d().contributions!} currency={d().totals.currency} />
                                    </Show>
                                </div>
                            </Show>
                        </>
                    )}
                </Show>
            </Show>
        </div>
    );
};

export default PartnerProgramPanel;
