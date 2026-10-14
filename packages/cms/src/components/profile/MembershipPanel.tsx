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
import { createEffect, createResource, createSignal, For, onCleanup, Show, type Component, } from 'solid-js';
import { useSearchParams, } from '@solidjs/router';
import { ApplicationPayment, ApplyModal, } from '../membership/MembershipApplication';
import PriceChoice from '../membership/PriceChoice';
import Markdown from '../common/Markdown';
import { defaultPriceId, leadPriceId, freq, money, per, priceOptionFreq, shownPrice, tierAtPrice, } from '../../utils/membershipFormat';
import type { MembershipPreviewResponse, MembershipResponse, MembershipTierOption, } from '@sitesurge/types';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import './MembershipPanel.scss';

type View = 'overview' | 'choose' | 'confirm' | 'card';

const longDate = (iso: string | null,) => (iso ? new Date(iso,).toLocaleDateString(undefined, { dateStyle: 'long', },) : '');

const MembershipPanel: Component = () => {
    const auth = useAuth();
    const [data, { refetch, },] = createResource<MembershipResponse | null>(() => cms.payments.membership().catch(() => null),);
    const [view, setView,] = createSignal<View>('overview',);
    const [selected, setSelected,] = createSignal<string | null>(null,);
    /** The chosen price on the chosen level (one of its `prices`; null = its default). */
    const [priceSel, setPriceSel,] = createSignal<string | null>(null,);
    const [preview, setPreview,] = createSignal<MembershipPreviewResponse | null>(null,);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [notice, setNotice,] = createSignal('',);
    /** A level that requires approval: the application modal. */
    const [applying, setApplying,] = createSignal<MembershipTierOption | null>(null,);
    const [applyingPrice, setApplyingPrice,] = createSignal<string | null>(null,);
    const pending = () => data()?.pendingApplication ?? null;
    /** Approved for a level that is not started yet: choose billing + pay. */
    const offer = () => data()?.approvedOffer ?? null;
    /** Finish an application submitted without a card. */
    const [addingCard, setAddingCard,] = createSignal(false,);

    let stripe: Stripe | null = null;
    let card: StripeCardElement | null = null;
    onCleanup(() => card?.destroy(),);

    const current = () => data()?.current;
    /** Subscription-required mode: Free is not offered; "no plan" means no access. */
    const required = () => Boolean(data()?.subscriptionRequired,);
    const noPlan = () => !current()?.tier || Boolean(current()?.tier?.isFree,);
    const tiers = () => data()?.tiers ?? [];
    const currentTier = () => tiers().find((t,) => t.isCurrent,) ?? tiers().find((t,) => t.isFree,) ?? null;
    const chosen = () => tiers().find((t,) => t.id === selected(),) ?? null;
    /** The price the member pays on their current level (default when unknown). */
    const currentPrice = () => {
        const t = currentTier();
        return t ? t.currentPriceId ?? defaultPriceId(t,) : null;
    };
    /** The chosen level's chosen price id (its default when none picked). */
    const chosenPrice = () => {
        const t = chosen();
        return t ? priceSel() ?? (t.isCurrent ? t.currentPriceId ?? defaultPriceId(t,) : leadPriceId(t,)) : null;
    };
    /** The price to SEND: omitted when it is the level's default. */
    const priceArg = () => {
        const t = chosen();
        const p = chosenPrice();
        return t && p && p !== defaultPriceId(t,) ? p : undefined;
    };
    /** Monthly-equivalent cents, so $250 / year compares fairly with $25 / month. */
    const perMonth = (t: MembershipTierOption,) => {
        const months = ({ day: 1 / 30, week: 12 / 52, month: 1, year: 12, } as Record<string, number>)[t.interval] ?? 1;
        return t.priceCents / (months * Math.max(1, t.intervalCount || 1,));
    };

    const direction = () => {
        const to = chosen();
        const from = currentTier();
        if (!to) return 'same';
        if (!from) return 'upgrade'; // no current tier on offer (e.g. Free hidden): a new subscription
        if (to.id === from.id) return chosenPrice() === currentPrice() ? 'same' : 'billing';
        return perMonth(tierAtPrice(to, chosenPrice(),),) > perMonth(tierAtPrice(from, currentPrice(),),) ? 'upgrade' : 'downgrade';
    };
    const actionLabel = () => {
        const to = chosen();
        if (to?.isPending) return 'Application pending';
        if (to?.isApproved && !to.isCurrent) return `Start ${to.name}`;
        if (to?.requiresApproval && !to.isCurrent) return `Apply for ${to.name}`;
        if (!to || direction() === 'same') return current()?.cancelAtPeriodEnd ? 'Keep my membership' : 'No change';
        if (direction() === 'billing') {
            const p = (to.prices ?? []).find((x,) => x.priceId === chosenPrice(),);
            return p ? `Switch to ${priceOptionFreq(p,).toLowerCase()} billing` : 'Switch billing';
        }
        if (!currentTier() || noPlan()) return `Join ${to.name}`;
        return `${direction() === 'upgrade' ? 'Upgrade' : 'Downgrade'} to ${to.name} tier`;
    };

    /** Pick a level (its current price when it is theirs, else its default). */
    const pickTier = (t: MembershipTierOption,) => {
        if (selected() === t.id) return;
        setSelected(t.id,);
        setPriceSel(t.isCurrent ? currentPrice() : leadPriceId(t,),);
    };

    // `/profile?tab=membership&tier=<id>` (from /subscribe): open the chooser
    // with that tier picked, once the tiers are loaded.
    // `&price=<priceId>` picks one of that level's prices (e.g. yearly).
    const [params,] = useSearchParams<{ tier?: string; price?: string; }>();
    let preselected = false;
    createEffect(() => {
        const want = params.tier;
        if (preselected || !want || tiers().length === 0) return;
        preselected = true;
        const t = tiers().find((x,) => x.id === want,);
        if (!t) return;
        const price = params.price && (t.prices ?? []).some((p,) => p.priceId === params.price,) ? params.price : null;
        // Their own level at the price they pay already is no change — stay on the overview.
        if (t.isCurrent && (!price || price === currentPrice())) return;
        openChooser();
        setSelected(t.id,);
        setPriceSel(price ?? (t.isCurrent ? currentPrice() : leadPriceId(t,)),);
    },);

    const openChooser = () => {
        setError('',);
        setNotice('',);
        setSelected(currentTier()?.id ?? null,);
        setPriceSel(currentPrice(),);
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
            setPreview(await cms.payments.previewMembership(to.id, priceArg(),),);
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
            // Check + tokenise the card FIRST (when this change needs one): a typo
            // or a rejected card shows here and creates nothing in Stripe.
            let paymentMethod: string | null = null;
            if (preview()?.requiresPayment) {
                if (!stripe || !card) throw new Error('Enter your card details.',);
                const pm = await stripe.createPaymentMethod({ type: 'card', card, },);
                if (pm.error) throw new Error(pm.error.message || 'Check your card details.',);
                paymentMethod = pm.paymentMethod.id;
            }
            const res = await cms.payments.changeMembership(to.id, priceArg(),);
            if (res.result === 'payment_required' && res.clientSecret && res.subscriptionId) {
                if (!stripe || !paymentMethod) throw new Error('Enter your card details.',);
                const pay = await stripe.confirmCardPayment(res.clientSecret, { payment_method: paymentMethod, },);
                if (pay.error) throw new Error(pay.error.message || 'Your card was declined.',);
                const done = await cms.payments.confirmMembership(res.subscriptionId,);
                if (done.result !== 'changed') throw new Error('The payment is still processing — check back in a minute.',);
                await finish(`You're now on the ${to.name} tier.`,);
            } else if (res.result === 'cancel_scheduled') {
                await finish(`Your membership will end on ${longDate(res.current.currentPeriodEnd,)}; after that you're on the free plan.`,);
            } else {
                await finish(to.isFree
                    ? "You're on the free plan."
                    : preview()?.direction === 'billing'
                    ? `Your ${to.name} billing is now ${preview()!.to.interval ? `${per(preview()!.to,).replace(/^ \/ /, 'per ',).trim()}` : 'updated'}.`
                    : `You're now on the ${to.name} tier.`,);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'The change could not be completed.',);
        } finally {
            setBusy(false,);
        }
    };

    /** Subscription-required mode: cancel without "switching to Free" (it is hidden). */
    const cancelPlan = async () => {
        if (!window.confirm('Cancel your membership? You keep access until the end of the period you paid for, then you will need to become a member again.')) return;
        setBusy(true,);
        setError('',);
        try {
            const res = await cms.payments.cancelMembership();
            await finish(res.current.currentPeriodEnd
                ? `Your membership will end on ${longDate(res.current.currentPeriodEnd,)}. You won't be charged again.`
                : 'Your membership is cancelled.',);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not cancel.',);
        } finally {
            setBusy(false,);
        }
    };

    /** Replace the card on file (a SetupIntent, so nothing is charged — except a past-due invoice, retried at once). */
    const saveCard = async () => {
        setBusy(true,);
        setError('',);
        try {
            if (!stripe || !card) throw new Error('Enter your card details.',);
            const { clientSecret, } = await cms.payments.membershipCardSetup();
            const res = await stripe.confirmCardSetup(clientSecret, { payment_method: { card, }, },);
            if (res.error) throw new Error(res.error.message || 'Your card was declined.',);
            const pm = res.setupIntent?.payment_method;
            const saved = await cms.payments.updateMembershipCard(typeof pm === 'string' ? pm : pm!.id,);
            await finish(saved.paid ? 'Card updated and the outstanding payment went through.' : 'Card updated.',);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'The card could not be saved.',);
        } finally {
            setBusy(false,);
        }
    };

    const resume = async () => {
        setBusy(true,);
        setError('',);
        try {
            await cms.payments.resumeMembership();
            await finish('Your membership will continue.',);
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

                    <Show when={!pending() && data()?.lastFailedAttempt && view() === 'overview'}>
                        <div class="membership__pending membership__pending--failed" role="status">
                            <Show
                                when={data()!.lastFailedAttempt!.status === 'incomplete' || data()!.lastFailedAttempt!.status === 'incomplete_expired'}
                                fallback={<>The latest payment for your <strong>{data()!.lastFailedAttempt!.tierName}</strong> membership failed. Update your card to pay it.{' '}</>}
                            >
                                Your <strong>{data()!.lastFailedAttempt!.tierName}</strong> payment did not go through, so the membership was not started — <strong>you were not charged</strong>.{' '}
                            </Show>
                            <button
                                type="button"
                                class="membership__link"
                                onClick={() => {
                                    const id = data()!.lastFailedAttempt!.tierId;
                                    if (tiers().some((t,) => t.id === id,)) { openChooser(); setSelected(id,); } else openChooser();
                                }}
                            >
                                Try again
                            </button>
                        </div>
                    </Show>
                    <Show when={offer() && view() === 'overview'}>
                        <div class="membership__pending membership__pending--offer" role="status">
                            You're approved for <strong>{offer()!.tierName}</strong>! Choose your billing and start your membership.{' '}
                            <button
                                type="button"
                                class="btn btn--primary btn--sm"
                                onClick={() => {
                                    const t = tiers().find((x,) => x.id === offer()!.tierId,);
                                    openChooser();
                                    if (t) { setSelected(t.id,); setPriceSel(leadPriceId(t,),); }
                                }}
                            >
                                Choose billing
                            </button>
                        </div>
                    </Show>
                    <Show when={pending()}>
                        <div class="membership__pending" role="status">
                            Your application for <strong>{pending()!.tierName}</strong> is waiting for approval (sent {longDate(pending()!.createdAt,)}).{' '}
                            <Show
                                when={pending()!.hasCard || pending()!.noCard}
                                fallback={<>Add the card for your membership so it can start once approved — you will not be charged before then.{' '}</>}
                            >
                                {pending()!.noCard
                                    ? 'Once it is approved, you will see the pricing here and choose your billing — nothing is charged before then. '
                                    : 'Your card is saved and will be charged only if it is approved. '}
                            </Show>
                            <Show when={!pending()!.hasCard && !pending()!.noCard && !addingCard()}>
                                <button type="button" class="membership__link" onClick={() => setAddingCard(true,)}>Add my card</button>{' · '}
                            </Show>
                            <button
                                type="button"
                                class="membership__link"
                                disabled={busy()}
                                onClick={async () => {
                                    if (!window.confirm('Withdraw your application?',)) return;
                                    setBusy(true,);
                                    try {
                                        await cms.payments.withdrawMembershipApplication();
                                        await refetch();
                                        void auth.refreshUser?.();
                                    } catch (e) {
                                        setError(e instanceof Error ? e.message : 'Could not withdraw the application.',);
                                    } finally {
                                        setBusy(false,);
                                    }
                                }}
                            >
                                Withdraw application
                            </button>
                            <Show when={addingCard() && tiers().find((t,) => t.id === pending()!.tierId,)}>
                                <ApplicationPayment
                                    tier={tiers().find((t,) => t.id === pending()!.tierId,)!}
                                    application={{ id: pending()!.id, token: null, tierId: pending()!.tierId, }}
                                    onBack={() => setAddingCard(false,)}
                                    onDone={() => { setAddingCard(false,); void refetch(); }}
                                />
                            </Show>
                        </div>
                    </Show>

                    {/* ── Overview ── */}
                    <Show when={view() === 'overview'}>
                        <span class="profile__label">Your membership</span>
                        <div class="membership__current">
                            <div>
                                <div class="membership__tier-name">{required() && noPlan() ? 'No active membership' : current()!.tier?.name ?? 'Free'}</div>
                                <Markdown class="membership__desc" text={current()!.tier?.description} />
                            </div>
                            <div class="membership__price">
                                {current()!.interval
                                    ? shownPrice({ isFree: false, priceCents: current()!.priceCents, currency: current()!.currency, interval: current()!.interval!, intervalCount: current()!.intervalCount ?? 1, display: current()!.display, },)
                                    : required() ? '—' : 'Free'}
                            </div>
                        </div>
                        <dl class="membership__facts">
                            <div><dt>Account role</dt><dd>{current()!.roleLabel ?? current()!.role}</dd></div>
                            <Show when={(current()!.extraRoles ?? []).length > 0}>
                                <div>
                                    <dt>Also</dt>
                                    <dd>{current()!.extraRoles!.map((r,) => r.label,).join(', ',)}</dd>
                                </div>
                            </Show>
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
                                Your membership is cancelled and ends on {longDate(current()!.currentPeriodEnd,)}.{' '}
                                <button type="button" class="membership__link" disabled={busy()} onClick={resume}>Keep my membership</button>
                            </p>
                        </Show>
                        <div class="membership__actions">
                            <Show
                                when={required() && noPlan()}
                                fallback={<button type="button" class="btn btn--outline-neutral" onClick={openChooser} disabled={tiers().length < 2}>Change membership</button>}
                            >
                                <button type="button" class="btn" onClick={openChooser} disabled={tiers().length < 1}>Choose a plan</button>
                            </Show>
                            <Show when={!current()!.cancelAtPeriodEnd && (currentTier()?.prices?.length ?? 0) > 1 && !currentTier()?.isFree}>
                                <button type="button" class="membership__link" onClick={openChooser}>Change billing</button>
                            </Show>
                            <Show when={current()!.card || current()!.source === 'stripe'}>
                                <button type="button" class="btn btn--outline-neutral" onClick={() => { setError('',); setNotice('',); setView('card',); }}>
                                    Update payment method
                                </button>
                            </Show>
                            <Show when={!current()!.tier?.isFree && !current()!.cancelAtPeriodEnd}>
                                <button
                                    type="button"
                                    class="btn btn--outline"
                                    disabled={busy()}
                                    onClick={() => {
                                        if (required()) { void cancelPlan(); return; }
                                        setSelected(tiers().find((t,) => t.isFree,)?.id ?? null,);
                                        setPriceSel(null,);
                                        void toConfirm();
                                    }}
                                >
                                    Cancel membership
                                </button>
                            </Show>
                        </div>
                    </Show>

                    {/* ── Choose ── */}
                    <Show when={view() === 'choose'}>
                        <span class="profile__label">Choose your membership</span>
                        <div class="membership__tiers" role="radiogroup">
                            <For each={tiers()}>
                                {(t,) => (
                                    // A div, not a <button>: the description is Markdown
                                    // (lists, paragraphs) and a button cannot hold blocks.
                                    <div
                                        role="radio"
                                        tabindex="0"
                                        aria-checked={selected() === t.id}
                                        class="membership__tout"
                                        classList={{ 'is-selected': selected() === t.id, 'is-current': t.isCurrent, }}
                                        onClick={() => pickTier(t,)}
                                        onKeyDown={(e,) => {
                                            if (e.target !== e.currentTarget) return; // a price button inside handles its own keys
                                            if (e.key === ' ' || e.key === 'Enter') {
                                                e.preventDefault();
                                                pickTier(t,);
                                            }
                                        }}
                                    >
                                        <span class="membership__tout-head">
                                            <strong>{t.name}</strong>
                                            <Show when={t.isCurrent}><span class="membership__badge">Current</span></Show>
                                            <Show when={t.isPending}><span class="membership__badge membership__badge--pending">Pending approval</span></Show>
                                            <Show when={t.isApproved && !t.isCurrent}><span class="membership__badge membership__badge--approved">Approved</span></Show>
                                            <Show when={t.requiresApproval && !t.isPending && !t.isApproved && !t.isCurrent}><span class="membership__badge membership__badge--apply">By application</span></Show>
                                        </span>
                                        <span class="membership__tout-price">
                                            <PriceChoice
                                                tier={t}
                                                perClass="membership__tout-per"
                                                selected={selected() === t.id ? chosenPrice() : (t.isCurrent ? currentPrice() : null)}
                                                onSelect={(t.prices?.length ?? 0) > 1 ? (id,) => { setSelected(t.id,); setPriceSel(id,); } : undefined}
                                            />
                                        </span>
                                        <span class="membership__tout-freq" hidden={!!t.priceHidden}>
                                            {freq(selected() === t.id ? tierAtPrice(t, chosenPrice(),) : t.isCurrent ? tierAtPrice(t, currentPrice(),) : t,)}
                                        </span>
                                        <Markdown class="membership__tout-desc" text={t.description} />
                                    </div>
                                )}
                            </For>
                        </div>
                        <div class="membership__actions">
                            <button type="button" class="btn btn--outline" onClick={() => setView('overview',)}>Cancel</button>
                            <button
                                type="button"
                                class="btn"
                                disabled={busy() || direction() === 'same' || !!chosen()?.isPending || (!!chosen()?.requiresApproval && !chosen()?.isApproved && !!pending())}
                                onClick={() => {
                                    const to = chosen();
                                    if (to?.requiresApproval && !to.isCurrent && !to.isApproved) { setApplyingPrice(chosenPrice(),); setApplying(to,); return; }
                                    void toConfirm();
                                }}
                            >
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
                                <span>{preview()!.from && !preview()!.from!.isFree ? shownPrice(preview()!.from!,) : 'Free'}</span>
                            </div>
                            <div class="membership__flow-arrow" aria-hidden="true">→</div>
                            <div class="membership__flow-box membership__flow-box--to">
                                <small>New plan</small>
                                <strong>{preview()!.to.name}</strong>
                                <span>{preview()!.to.isFree ? 'Free' : shownPrice(preview()!.to,)}</span>
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
                        <div class="membership__explain">
                            <Show
                                when={preview()!.direction === 'cancel'}
                                fallback={
                                    <Show
                                        when={preview()!.direction === 'new'}
                                        fallback={
                                            <Show
                                                when={preview()!.direction === 'billing'}
                                                fallback={<>Your current plan is cancelled now and replaced by {preview()!.to.name}. Unused time on it is credited against the new price.</>}
                                            >
                                                <span class="membership__billing-explain">
                                                    <strong>How the switch works</strong>
                                                    <ul>
                                                        <li>
                                                            It happens <strong>today</strong> — your {preview()!.to.name} membership simply moves from{' '}
                                                            {preview()!.from ? freq(preview()!.from!,).toLowerCase() : 'its current'} to {freq(preview()!.to,).toLowerCase()} billing.
                                                            Nothing is cancelled and your access doesn't change.
                                                        </li>
                                                        <li>
                                                            The unused part of your current {preview()!.from ? freq(preview()!.from!,).toLowerCase() : ''} period
                                                            {preview()!.from ? <> ({money(preview()!.from!.priceCents, preview()!.from!.currency,)}{per(preview()!.from!,)})</> : ''} is credited (pro-rated by the day).
                                                        </li>
                                                        <li>
                                                            <Show
                                                                when={preview()!.amountDueNow > 0}
                                                                fallback={<>That credit covers the first {freq(preview()!.to,).toLowerCase()} period, so nothing is charged today{preview()!.creditAfter > 0 ? <> — the remaining {money(preview()!.creditAfter, preview()!.currency,)} is applied to your next bill</> : ''}.</>}
                                                            >
                                                                Today you're charged <strong>{money(preview()!.amountDueNow, preview()!.currency,)}</strong>: the new {freq(preview()!.to,).toLowerCase()} price
                                                                ({money(preview()!.to.priceCents, preview()!.to.currency,)}) minus that credit.
                                                            </Show>
                                                        </li>
                                                        <li>
                                                            After that you're billed {money(preview()!.nextAmount, preview()!.currency,)}{per(preview()!.to,)}
                                                            <Show when={preview()!.nextDate}>, next on {longDate(preview()!.nextDate,)}</Show>, until you change or cancel.
                                                        </li>
                                                    </ul>
                                                </span>
                                            </Show>
                                        }
                                    >
                                        Your {preview()!.to.name} membership starts today and renews automatically. You can cancel any time.
                                    </Show>
                                }
                            >
                                Your {preview()!.from?.name} membership is cancelled. You keep it until{' '}
                                {longDate(preview()!.effectiveDate,) || 'the end of the period you paid for'}, then move to the free plan. You won't be charged again.
                            </Show>
                        </div>

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

                    {/* ── Update payment method ── */}
                    <Show when={view() === 'card'}>
                        <span class="profile__label">New card</span>
                        <p class="profile__muted">
                            The new card is used for your next charges. If a payment is overdue, it is retried with this card now.
                        </p>
                        <div class="membership__card" ref={(el,) => void mountCard(el,)} />
                        <div class="membership__actions">
                            <button type="button" class="btn btn--outline" disabled={busy()} onClick={() => setView('overview',)}>Cancel</button>
                            <button type="button" class="btn" disabled={busy()} onClick={saveCard}>{busy() ? 'Saving…' : 'Save card'}</button>
                        </div>
                    </Show>

                    <Show when={error()}><div class="membership__error">{error()}</div></Show>
                </Show>
            </Show>
            <Show when={applying()}>
                <ApplyModal
                    tier={applying()!}
                    priceId={applyingPrice()}
                    onClose={() => setApplying(null,)}
                    onApplied={() => { setView('overview',); void refetch(); }}
                />
            </Show>
        </div>
    );
};

export default MembershipPanel;
