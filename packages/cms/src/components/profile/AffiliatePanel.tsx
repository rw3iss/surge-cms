/**
 * Profile → Partner Program → Affiliate sales (feature `affiliates`; members
 * with the affiliate role): share codes (`/shop?code=…`), choose how much of
 * each code's commission buyers get as a discount, and see sales (no buyer
 * details) and payouts. `embedded` (inside PartnerProgramPanel) hides the
 * Stripe connection + balance header — the Partner Program page shows those
 * once for every program.
 */
import type { AffiliateCode, AffiliateMeResponse, } from '@sitesurge/types';
import { formatCurrency, formatPercent, } from '@sitesurge/types';
import { useSearchParams, } from '@solidjs/router';
import { Component, createResource, createSignal, For, onMount, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import './AffiliatePanel.scss';

const money = (c: number, cur = 'usd',) => formatCurrency(c, cur.toUpperCase(),);
const day = (iso: string,) => new Date(iso,).toLocaleDateString(undefined, { dateStyle: 'medium', },);
const STATUS: Record<string, string> = { pending: 'Pending', available: 'Payable', paid: 'Paid', reversed: 'Refunded', };
const SCHEDULE: Record<string, string> = { off: 'paid out by our team', weekly: 'paid out weekly', biweekly: 'paid out every 2 weeks', monthly: 'paid out monthly', };

/** One code: share link + the buyer-discount split. */
const CodeRow: Component<{ code: AffiliateCode; onSaved: () => void; }> = (props,) => {
    const [split, setSplit,] = createSignal(props.code.buyerDiscountPercent,);
    const [busy, setBusy,] = createSignal(false,);
    const [msg, setMsg,] = createSignal('',);
    const [copied, setCopied,] = createSignal(false,);
    const keep = () => Math.max(0, props.code.commissionPercent - split(),);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(props.code.shareUrl,);
            setCopied(true,);
            setTimeout(() => setCopied(false,), 1500,);
        } catch { /* clipboard blocked: the link is shown anyway */ }
    };
    const save = async () => {
        setBusy(true,);
        setMsg('',);
        try {
            await cms.affiliates.setCodeSplit(props.code.id, split(),);
            setMsg('Saved.',);
            props.onSaved();
        } catch (e) {
            setMsg(e instanceof Error ? e.message : 'Could not save.',);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <div class="affiliate-panel__code" classList={{ 'affiliate-panel__code--off': !props.code.active, }}>
            <div class="affiliate-panel__code-head">
                <code class="affiliate-panel__code-name">{props.code.code}</code>
                <span class="profile__muted">
                    {props.code.uses}{props.code.maxUses != null ? ` / ${props.code.maxUses}` : ''} use{props.code.uses === 1 ? '' : 's'}
                    {props.code.active ? '' : ' · paused'}
                </span>
            </div>
            <div class="affiliate-panel__share">
                <input type="text" readonly value={props.code.shareUrl} aria-label="Share link" onFocus={(e,) => e.currentTarget.select()} />
                <button type="button" class="btn btn--outline" onClick={() => void copy()}>{copied() ? 'Copied' : 'Copy link'}</button>
            </div>
            <div class="affiliate-panel__split">
                <label for={`split-${props.code.id}`}>
                    Buyer discount: <strong>{formatPercent(split(),)}%</strong> · you keep <strong>{formatPercent(keep(),)}%</strong> of {formatPercent(props.code.commissionPercent,)}%
                </label>
                <input
                    id={`split-${props.code.id}`}
                    type="range"
                    min={0}
                    max={props.code.commissionPercent}
                    step="0.5"
                    value={split()}
                    onInput={(e,) => setSplit(Number(e.currentTarget.value,),)}
                />
                <div class="affiliate-panel__split-actions">
                    <button type="button" class="btn btn--primary" disabled={busy() || split() === props.code.buyerDiscountPercent} onClick={() => void save()}>
                        {busy() ? 'Saving…' : 'Save'}
                    </button>
                    <Show when={msg()}><span class="profile__muted">{msg()}</span></Show>
                </div>
            </div>
        </div>
    );
};

const AffiliatePanel: Component<{ embedded?: boolean; }> = (props,) => {
    const [params, setParams,] = useSearchParams();
    const [data, { refetch, mutate, },] = createResource<AffiliateMeResponse>(() => cms.affiliates.me(),);
    const [linking, setLinking,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    // Back from Stripe onboarding: re-read the account status once.
    onMount(() => {
        if (props.embedded) return; // the Partner Program page handles the Stripe return
        if (params.stripe === 'return' || params.stripe === 'refresh') {
            void cms.affiliates.stripeRefresh().then((stripe,) => {
                const d = data();
                if (d) mutate({ ...d, stripe, },);
                else void refetch();
            },).catch(() => {},);
            setParams({ stripe: undefined, },);
        }
    },);

    const go = async (kind: 'onboard' | 'dashboard',) => {
        setLinking(true,);
        setError('',);
        try {
            const { url, } = kind === 'onboard' ? await cms.affiliates.stripeOnboard() : await cms.affiliates.stripeDashboard();
            window.location.href = url;
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not open Stripe.',);
            setLinking(false,);
        }
    };

    return (
        <div class="affiliate-panel" classList={{ profile__card: !props.embedded, 'affiliate-panel--embedded': !!props.embedded, }}>
            <Show when={!data.loading || data()} fallback={<p class="profile__muted">Loading your affiliate account…</p>}>
                <Show when={data()} fallback={<p class="profile__muted">Your affiliate details could not be loaded.</p>}>
                    {(d,) => (
                        <>
                            <Show when={!props.embedded}>
                            <section class="affiliate-panel__section">
                                <h3>Getting paid</h3>
                                <Show
                                    when={d().stripe.payoutsEnabled}
                                    fallback={
                                        <>
                                            <p>
                                                {d().stripe.connected
                                                    ? 'Finish setting up your Stripe account so we can send your commissions.'
                                                    : 'Connect a Stripe account to receive your commissions. Stripe asks for your details and bank account — we never see them.'}
                                            </p>
                                            <button type="button" class="btn btn--primary" disabled={linking()} onClick={() => void go('onboard',)}>
                                                {linking() ? 'Opening Stripe…' : d().stripe.connected ? 'Continue Stripe setup' : 'Connect with Stripe'}
                                            </button>
                                        </>
                                    }
                                >
                                    <p>Your Stripe account is connected — commissions are {SCHEDULE[d().payoutSchedule] ?? 'paid out'} once they are {d().refundWindowDays} days old.</p>
                                    <button type="button" class="btn btn--outline" disabled={linking()} onClick={() => void go('dashboard',)}>
                                        {linking() ? 'Opening Stripe…' : 'Open my Stripe dashboard'}
                                    </button>
                                </Show>
                                <Show when={error()}><p class="affiliate-panel__error" role="alert">{error()}</p></Show>
                            </section>

                            <div class="affiliate-panel__balance">
                                <div><span>Payable</span><strong>{money(d().balance.availableCents, d().balance.currency,)}</strong></div>
                                <div><span>Pending</span><strong>{money(d().balance.pendingCents, d().balance.currency,)}</strong></div>
                                <div><span>Paid to you</span><strong>{money(d().balance.paidCents, d().balance.currency,)}</strong></div>
                            </div>
                            </Show>
                            <p class="profile__muted affiliate-panel__note">
                                Pending commissions become payable {d().refundWindowDays} days after the order is paid (a refund before then cancels it).
                            </p>
                            <Show when={props.embedded}>
                                <div class="affiliate-panel__balance affiliate-panel__balance--sub">
                                    <div><span>Affiliate payable</span><strong>{money(d().balance.availableCents, d().balance.currency,)}</strong></div>
                                    <div><span>Affiliate pending</span><strong>{money(d().balance.pendingCents, d().balance.currency,)}</strong></div>
                                    <div><span>Affiliate paid</span><strong>{money(d().balance.paidCents, d().balance.currency,)}</strong></div>
                                </div>
                            </Show>

                            <section class="affiliate-panel__section">
                                <h3>Your codes</h3>
                                <Show when={d().codes.length} fallback={<p class="profile__muted">You have no codes yet — our team will add them.</p>}>
                                    <p class="profile__muted">
                                        Share your link — the code is applied at checkout. Optionally give buyers part of your commission as a discount.
                                    </p>
                                    <For each={d().codes}>{(c,) => <CodeRow code={c} onSaved={() => void refetch()} />}</For>
                                </Show>
                            </section>

                            <section class="affiliate-panel__section">
                                <h3>Sales</h3>
                                <Show when={d().earnings.length} fallback={<p class="profile__muted">No sales yet.</p>}>
                                    <div class="affiliate-panel__table-wrap">
                                        <table class="affiliate-panel__table">
                                            <thead><tr><th>Date</th><th>Order</th><th>Code</th><th>Sale</th><th>Your share</th><th>Status</th></tr></thead>
                                            <tbody>
                                                <For each={d().earnings}>
                                                    {(e,) => (
                                                        <tr>
                                                            <td>{day(e.createdAt,)}</td>
                                                            <td>{e.orderNumber}</td>
                                                            <td>{e.code ?? '—'}</td>
                                                            <td>{e.kind === 'reversal' ? 'Refund' : money(e.merchSubtotalCents, e.currency,)}</td>
                                                            <td>{money(e.amountCents, e.currency,)}</td>
                                                            <td>{STATUS[e.status] ?? e.status}{e.status === 'pending' ? ` (from ${day(e.availableAt,)})` : ''}</td>
                                                        </tr>
                                                    )}
                                                </For>
                                            </tbody>
                                        </table>
                                    </div>
                                </Show>
                            </section>

                            <section class="affiliate-panel__section">
                                <h3>Payouts</h3>
                                <Show when={d().payouts.length} fallback={<p class="profile__muted">No payouts yet.</p>}>
                                    <div class="affiliate-panel__table-wrap">
                                        <table class="affiliate-panel__table">
                                            <thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
                                            <tbody>
                                                <For each={d().payouts}>
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
                        </>
                    )}
                </Show>
            </Show>
        </div>
    );
};

export default AffiliatePanel;
