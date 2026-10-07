/**
 * Profile → Membership: the member's current subscription tier (free included)
 * and their role; change it (upgrade / downgrade) or cancel back to free.
 *
 *   overview → choose (tier touts, current one selected)
 *            → confirm (current → new "flow", what is charged now, card form
 *              when a card is needed) → done (back to overview)
 *
 * The server decides how a change applies (and asks Stripe for the exact
 * amount): paid→paid switches NOW with proration; free→paid starts a new
 * subscription paid with the card entered here; →free cancels at the end of
 * the period already paid for, and can be resumed until then.
 */
import { loadStripe, type Stripe, type StripeCardElement, } from '@stripe/stripe-js';
import { createResource, createSignal, For, onCleanup, Show, type Component, } from 'solid-js';
import type { MembershipPreviewResponse, MembershipResponse, MembershipTierOption, } from '@sitesurge/types';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import './MembershipPanel.scss';

type View = 'overview' | 'choose' | 'confirm';

function money(cents: number, currency = 'usd',): string {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), },).format(cents / 100,);
}
function per(t: { isFree: boolean; interval: string; intervalCount: number; },): string {
    if (t.isFree) return '';
    if (t.intervalCount > 1) return ` every ${t.intervalCount} ${t.interval}s`;
    return ` / ${t.interval}`;
}
const freq = (t: MembershipTierOption,) =>
    t.isFree ? 'Free' : t.intervalCount > 1 ? `Every ${t.intervalCount} ${t.interval}s` : ({ day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly', } as Record<string, string>)[t.interval] ?? t.interval;
const longDate = (iso: string | null,) => (iso ? new Date(iso,).toLocaleDateString(undefined, { dateStyle: 'long', },) : '');

const MembershipPanel: Component = () => {
    const auth = useAuth();
    const [data, { refetch, },] = createResource<MembershipResponse | null>(() => cms.payments.membership().catch(() => null),);
    const [view, setView,] = createSignal<View>('overview',);
    const [selected, setSelected,] = createSignal<string | null>(null,);
    const [preview, setPreview,] = createSignal<MembershipPreviewResponse | null>(null,);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [notice, setNotice,] = createSignal('',);

    let stripe: Stripe | null = null;
    let card: StripeCardElement | null = null;
    onCleanup(() => card?.destroy(),);

    const current = () => data()?.current;
    const tiers = () => data()?.tiers ?? [];
    const currentTier = () => tiers().find((t,) => t.isCurrent,) ?? tiers().find((t,) => t.isFree,) ?? null;
    const chosen = () => tiers().find((t,) => t.id === selected(),) ?? null;

    const direction = () => {
        const to = chosen();
        const from = currentTier();
        if (!to || !from || to.id === from.id) return 'same';
        return to.priceCents > from.priceCents ? 'upgrade' : 'downgrade';
    };
    const actionLabel = () => {
        const to = chosen();
        if (!to || direction() === 'same') return current()?.cancelAtPeriodEnd ? 'Keep my subscription' : 'No change';
        return `${direction() === 'upgrade' ? 'Upgrade' : 'Downgrade'} to ${to.name} tier`;
    };

    const openChooser = () => {
        setError('',);
        setNotice('',);
        setSelected(currentTier()?.id ?? null,);
        setView('choose',);
    };

    /** Mount the card field (only when the change needs a card). */
    const mountCard = async (el: HTMLDivElement,) => {
        try {
            let key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
            const res = await cms.payments.publishableKey('default',).catch(() => null);
            if (res?.publishableKey) key = res.publishableKey;
            if (!key) return setError('Payments are not configured.',);
            stripe = await loadStripe(key,);
            if (!stripe) return setError('Could not load the payment form.',);
            card?.destroy();
            card = stripe.elements().create('card', { style: { base: { fontSize: '16px', }, }, },);
            card.mount(el,);
        } catch {
            setError('Could not load the payment form.',);
        }
    };

    const toConfirm = async () => {
        const to = chosen();
        if (!to) return;
        setError('',);
        setBusy(true,);
        try {
            setPreview(await cms.payments.previewMembership(to.id,),);
            setView('confirm',);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not prepare that change.',);
        } finally {
            setBusy(false,);
        }
    };

    const finish = async (message: string,) => {
        setNotice(message,);
        setView('overview',);
        setPreview(null,);
        await refetch();
        void auth.refreshUser?.(); // the role may have changed
    };

    const confirm = async () => {
        const to = chosen();
        if (!to) return;
        setError('',);
        setBusy(true,);
        try {
            const res = await cms.payments.changeMembership(to.id,);
            if (res.result === 'payment_required' && res.clientSecret && res.subscriptionId) {
                if (!stripe || !card) throw new Error('Enter your card details.',);
                const pay = await stripe.confirmCardPayment(res.clientSecret, { payment_method: { card, }, },);
                if (pay.error) throw new Error(pay.error.message || 'Your card was declined.',);
                const done = await cms.payments.confirmMembership(res.subscriptionId,);
                if (done.result !== 'changed') throw new Error('The payment is still processing — check back in a minute.',);
                await finish(`You're now on the ${to.name} tier.`,);
            } else if (res.result === 'cancel_scheduled') {
                await finish(`Your subscription will end on ${longDate(res.current.currentPeriodEnd,)}; after that you're on the free plan.`,);
            } else {
                await finish(to.isFree ? "You're on the free plan." : `You're now on the ${to.name} tier.`,);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'The change could not be completed.',);
        } finally {
            setBusy(false,);
        }
    };

    const resume = async () => {
        setBusy(true,);
        setError('',);
        try {
            await cms.payments.resumeMembership();
            await finish('Your subscription will continue.',);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not resume.',);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <div class="profile__card membership">
            <Show when={!data.loading} fallback={<p class="profile__muted">Loading your membership…</p>}>
                <Show when={data()} fallback={<p class="profile__muted">Membership details are unavailable right now.</p>}>
                    <Show when={notice()}><div class="membership__notice">{notice()}</div></Show>

                    {/* ── Overview ── */}
                    <Show when={view() === 'overview'}>
                        <span class="profile__label">Your subscription</span>
                        <div class="membership__current">
                            <div>
                                <div class="membership__tier-name">{current()!.tier?.name ?? 'Free'}</div>
                                <Show when={current()!.tier?.description}>
                                    <p class="membership__desc">{current()!.tier!.description}</p>
                                </Show>
                            </div>
                            <div class="membership__price">
                                {current()!.interval ? `${money(current()!.priceCents, current()!.currency,)} / ${current()!.interval}` : 'Free'}
                            </div>
                        </div>
                        <dl class="membership__facts">
                            <div><dt>Account role</dt><dd>{current()!.role}</dd></div>
                            <Show when={current()!.status}><div><dt>Status</dt><dd>{current()!.status}</dd></div></Show>
                            <Show when={current()!.currentPeriodEnd}>
                                <div><dt>{current()!.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'}</dt><dd>{longDate(current()!.currentPeriodEnd,)}</dd></div>
                            </Show>
                            <Show when={current()!.card}>
                                <div><dt>Card</dt><dd>{current()!.card!.brand} ending in {current()!.card!.last4}</dd></div>
                            </Show>
                            <Show when={current()!.source === 'manual'}><div><dt>Source</dt><dd>Assigned by the site team</dd></div></Show>
                        </dl>
                        <Show when={current()!.cancelAtPeriodEnd}>
                            <p class="membership__warning">
                                Your subscription is cancelled and ends on {longDate(current()!.currentPeriodEnd,)}.{' '}
                                <button type="button" class="membership__link" disabled={busy()} onClick={resume}>Keep my subscription</button>
                            </p>
                        </Show>
                        <div class="membership__actions">
                            <button type="button" class="btn btn--outline-neutral" onClick={openChooser} disabled={tiers().length < 2}>Change subscription</button>
                            <Show when={!current()!.tier?.isFree && !current()!.cancelAtPeriodEnd}>
                                <button
                                    type="button"
                                    class="btn btn--outline"
                                    onClick={() => {
                                        setSelected(tiers().find((t,) => t.isFree,)?.id ?? null,);
                                        void toConfirm();
                                    }}
                                >
                                    Cancel subscription
                                </button>
                            </Show>
                        </div>
                    </Show>

                    {/* ── Choose ── */}
                    <Show when={view() === 'choose'}>
                        <span class="profile__label">Choose your subscription</span>
                        <div class="membership__tiers" role="radiogroup">
                            <For each={tiers()}>
                                {(t,) => (
                                    <button
                                        type="button"
                                        role="radio"
                                        aria-checked={selected() === t.id}
                                        class="membership__tout"
                                        classList={{ 'is-selected': selected() === t.id, 'is-current': t.isCurrent, }}
                                        onClick={() => setSelected(t.id,)}
                                    >
                                        <span class="membership__tout-head">
                                            <strong>{t.name}</strong>
                                            <Show when={t.isCurrent}><span class="membership__badge">Current</span></Show>
                                        </span>
                                        <span class="membership__tout-price">
                                            {t.isFree ? 'Free' : money(t.priceCents, t.currency,)}<small>{per(t,)}</small>
                                        </span>
                                        <span class="membership__tout-freq">{freq(t,)}</span>
                                        <Show when={t.description}><span class="membership__tout-desc">{t.description}</span></Show>
                                    </button>
                                )}
                            </For>
                        </div>
                        <div class="membership__actions">
                            <button type="button" class="btn btn--outline" onClick={() => setView('overview',)}>Cancel</button>
                            <button type="button" class="btn" disabled={busy() || direction() === 'same'} onClick={toConfirm}>
                                {busy() ? 'Loading…' : actionLabel()}
                            </button>
                        </div>
                    </Show>

                    {/* ── Confirm ── */}
                    <Show when={view() === 'confirm' && preview()}>
                        <span class="profile__label">Confirm the change</span>
                        <div class="membership__flow">
                            <div class="membership__flow-box">
                                <small>Current plan</small>
                                <strong>{preview()!.from?.name ?? 'Free'}</strong>
                                <span>{preview()!.from && !preview()!.from!.isFree ? `${money(preview()!.from!.priceCents, preview()!.from!.currency,)}${per(preview()!.from!,)}` : 'Free'}</span>
                            </div>
                            <div class="membership__flow-arrow" aria-hidden="true">→</div>
                            <div class="membership__flow-box membership__flow-box--to">
                                <small>New plan</small>
                                <strong>{preview()!.to.name}</strong>
                                <span>{preview()!.to.isFree ? 'Free' : `${money(preview()!.to.priceCents, preview()!.to.currency,)}${per(preview()!.to,)}`}</span>
                            </div>
                        </div>
                        <dl class="membership__facts">
                            <div>
                                <dt>Price difference</dt>
                                <dd>
                                    {(() => {
                                        const d = preview()!.to.priceCents - (preview()!.from?.priceCents ?? 0);
                                        return `${d >= 0 ? '+' : '−'}${money(Math.abs(d,), preview()!.currency,)}${per(preview()!.to.isFree && preview()!.from ? preview()!.from! : preview()!.to,)}`;
                                    })()}
                                </dd>
                            </div>
                            <Show when={preview()!.direction !== 'cancel'}>
                                <div><dt>Charged now</dt><dd>{money(preview()!.amountDueNow, preview()!.currency,)}</dd></div>
                            </Show>
                            <Show when={preview()!.creditAfter > 0}>
                                <div><dt>Credit for your next bill</dt><dd>{money(preview()!.creditAfter, preview()!.currency,)}</dd></div>
                            </Show>
                            <Show when={preview()!.nextDate && !preview()!.to.isFree}>
                                <div><dt>Then</dt><dd>{money(preview()!.nextAmount, preview()!.currency,)}{per(preview()!.to,)} from {longDate(preview()!.nextDate,)}</dd></div>
                            </Show>
                        </dl>
                        <p class="membership__explain">
                            <Show
                                when={preview()!.direction === 'cancel'}
                                fallback={
                                    <Show
                                        when={preview()!.direction === 'new'}
                                        fallback={<>Your current plan is cancelled now and replaced by {preview()!.to.name}. Unused time on it is credited against the new price.</>}
                                    >
                                        Your {preview()!.to.name} subscription starts today and renews automatically. You can cancel any time.
                                    </Show>
                                }
                            >
                                Your {preview()!.from?.name} subscription is cancelled. You keep it until{' '}
                                {longDate(preview()!.effectiveDate,) || 'the end of the period you paid for'}, then move to the free plan. You won't be charged again.
                            </Show>
                        </p>

                        <Show when={preview()!.requiresPayment}>
                            <label class="profile__label">Card</label>
                            <div class="membership__card" ref={(el,) => void mountCard(el,)} />
                        </Show>
                        <Show when={!preview()!.requiresPayment && preview()!.amountDueNow > 0 && current()?.card}>
                            <p class="profile__muted">Charged to your {current()!.card!.brand} ending in {current()!.card!.last4}.</p>
                        </Show>

                        <div class="membership__actions">
                            <button type="button" class="btn btn--outline" disabled={busy()} onClick={() => { setView('overview',); setPreview(null,); }}>Cancel</button>
                            <button type="button" class="btn" disabled={busy()} onClick={confirm}>
                                {busy() ? 'Working…' : preview()!.direction === 'cancel' ? 'Confirm cancellation' : 'Confirm'}
                            </button>
                        </div>
                    </Show>

                    <Show when={error()}><div class="membership__error">{error()}</div></Show>
                </Show>
            </Show>
        </div>
    );
};

export default MembershipPanel;
