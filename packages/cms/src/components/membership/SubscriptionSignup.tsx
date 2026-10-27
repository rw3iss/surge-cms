/**
 * Join, when a paid subscription is required (Users → Settings).
 *
 *   1 Plan     — the tiers at or above the minimum (the /subscribe cards)
 *   2 Account  — name / email / password. The account is created HERE and
 *                signed in RESTRICTED, so it can pay; nothing else opens yet.
 *   3 Payment  — card → a Stripe subscription, confirmed in the browser.
 *   4 Done     — access opens (or: "verify your email", when that is on).
 *
 * A plan that REQUIRES APPROVAL adds an Application step after Plan (its form,
 * or the built-in one), and Payment SAVES the card instead of charging it:
 * the account is created and stays pending until an admin approves.
 *
 * If payment fails the account stays, still restricted: the member can retry
 * here, or later from the wall / Profile → Membership.
 */
import type { FormAnswer, MembershipTierOption, } from '@sitesurge/types';
import type { Stripe, StripeCardElement, } from '@stripe/stripe-js';
import { mountStripeCard, payNewSubscription, tokenizeCard, } from '../../utils/stripeCard';
import { A, useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, onCleanup, Show, } from 'solid-js';
import Markdown from '../common/Markdown';
import {
    applicantFrom, ApplicationDone, ApplicationPayment, ApplicationQuestions, ApplicationSubmitted, claimApplication, submitApplication, type SubmittedApplication,
} from './MembershipApplication';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { siteName, } from '../../stores/siteSettings';
import { billedNote, defaultPriceId, leadPriceId, freq, money, per, shownPrice, tierAtPrice, } from '../../utils/membershipFormat';
import PriceChoice from './PriceChoice';
import '../../pages/Subscribe.scss';
import './SubscriptionSignup.scss';
import { takeJoinPrefill, } from '../../utils/joinPrefill';

type Step = 'plan' | 'application' | 'submitted' | 'account' | 'payment' | 'done';

const STEPS: { key: Step; label: string; }[] = [
    { key: 'plan', label: 'Plan', },
    { key: 'account', label: 'Account', },
    { key: 'payment', label: 'Payment', },
];
const APPLY_STEPS: { key: Step; label: string; }[] = [
    { key: 'plan', label: 'Plan', },
    { key: 'application', label: 'Application', },
    { key: 'account', label: 'Account', },
    { key: 'payment', label: 'Card', },
];

/** A "hide price" level: no card — the application is the whole sign-up. */
const OFFER_STEPS: { key: Step; label: string; }[] = [
    { key: 'plan', label: 'Plan', },
    { key: 'application', label: 'Application', },
    { key: 'account', label: 'Account', },
];

const SubscriptionSignup: Component = () => {
    const auth = useAuth();
    const [params,] = useSearchParams<{ tier?: string; price?: string; }>();
    const [tiers,] = createResource(() => cms.payments.membershipTiers().then((r,) => r.tiers.filter((t,) => !t.isFree)).catch(() => [] as MembershipTierOption[]),);
    const [step, setStep,] = createSignal<Step>('plan',);
    const [tierId, setTierId,] = createSignal<string | null>(params.tier ?? null,);
    const tier = () => tiers()?.find((t,) => t.id === tierId(),) ?? null;
    /** The billing price picked per level (`?price=` from /subscribe seeds it); absent = default. */
    const [picks, setPicks,] = createSignal<Record<string, string>>(params.tier && params.price ? { [params.tier]: params.price, } : {},);
    const chosenFor = (t: MembershipTierOption,): string | null => {
        const p = picks()[t.id];
        return p && t.prices?.some((x,) => x.priceId === p,) ? p : leadPriceId(t,);
    };
    const pick = (t: MembershipTierOption, id: string,) => setPicks({ ...picks(), [t.id]: id, },);
    /** The chosen level re-priced to the chosen billing price. */
    const chosenTier = (): MembershipTierOption | null => (tier() ? tierAtPrice(tier()!, chosenFor(tier()!,),) : null);
    /** The chosen price when it is NOT the default (what the server is sent). */
    const altPrice = (): string | null => {
        const t = tier();
        if (!t) return null;
        const c = chosenFor(t,);
        return c && c !== defaultPriceId(t,) ? c : null;
    };
    const hasChoice = () => (tier()?.prices?.length ?? 0) > 1;
    const [error, setError,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);
    /** The application sent in the Application step (plans that require approval). */
    const [submitted, setSubmitted,] = createSignal<SubmittedApplication | null>(null,);
    const [applied, setApplied,] = createSignal(false,);
    const needsApproval = () => !!tier()?.requiresApproval;
    /** "Hide price" level: nothing is paid until the member is approved. */
    const noCard = () => !!tier()?.priceHidden;
    const steps = () => (noCard() ? OFFER_STEPS : needsApproval() ? APPLY_STEPS : STEPS);

    /** Attach the sent application to the account (no card) and finish. */
    const finishOffer = async () => {
        const app = submitted();
        if (!app) return setStep('plan',);
        setBusy(true,);
        setError('',);
        try {
            await claimApplication(app,);
            setApplied(true,);
            await auth.refreshUser();
            setStep('done',);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Your application could not be sent.',);
        } finally {
            setBusy(false,);
        }
    };

    // Already signed in (e.g. came back after a failed payment): skip the account step.
    createEffect(() => {
        if (step() === 'account' && auth.user) {
            if (noCard()) void finishOffer();
            else setStep('payment',);
        }
    },);

    // ─── Account ───
    // Pre-filled from a membership application typed just before (utils/joinPrefill).
    const handed = takeJoinPrefill();
    const [name, setName,] = createSignal(handed?.name ?? '',);
    const [email, setEmail,] = createSignal(handed?.email ?? '',);
    const [password, setPassword,] = createSignal('',);
    const [confirmPassword, setConfirmPassword,] = createSignal('',);

    const createAccount = async (e: Event,) => {
        e.preventDefault();
        setError('',);
        if (password() !== confirmPassword()) return setError('Passwords do not match',);
        if (password().length < 8) return setError('Password must be at least 8 characters',);
        setBusy(true,);
        try {
            const res = await cms.auth.register({ name: name().trim(), email: email().trim(), password: password(), },);
            if (!res.signedIn) throw new Error('Your account was created. Sign in to finish choosing your plan.',);
            await auth.refreshUser();
            // The effect above moves on (a "hide price" level claims its application there).
            if (!noCard()) setStep('payment',);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Registration failed',);
        } finally {
            setBusy(false,);
        }
    };

    // ─── Payment ───
    let stripe: Stripe | null = null;
    let card: StripeCardElement | null = null;
    onCleanup(() => card?.destroy(),);
    const mountCard = async (el: HTMLDivElement,) => {
        try {
            card?.destroy();
            ({ stripe, card, } = await mountStripeCard(el,));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the payment form.',);
        }
    };

    const pay = async () => {
        const t = tier();
        if (!t) return setStep('plan',);
        setError('',);
        setBusy(true,);
        try {
            // Check + tokenise the card FIRST: a typo or a rejected card shows
            // here and creates nothing in Stripe (each server call used to leave
            // an "incomplete" subscription behind).
            if (!stripe || !card) throw new Error('Enter your card details.',);
            const m = { stripe, card, };
            const pm = await tokenizeCard(m,);
            const res = await cms.payments.changeMembership(t.id, altPrice(),);
            if (res.result === 'payment_required' && res.clientSecret && res.subscriptionId) {
                await payNewSubscription(m, res.clientSecret, pm,);
                const done = await cms.payments.confirmMembership(res.subscriptionId,);
                if (done.result !== 'changed') throw new Error('Your payment is still processing — check back in a minute from your profile.',);
            } else if (res.result !== 'changed' && res.result !== 'unchanged') {
                throw new Error('The membership could not be started.',);
            }
            await auth.refreshUser();
            setStep('done',);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'The payment did not go through.',);
        } finally {
            setBusy(false,);
        }
    };

    const stepIndex = () => steps().findIndex((s,) => s.key === (step() === 'submitted' ? 'application' : step()),);

    return (
        <div class="subscription-signup">
            <h1 class="join__title">Join {siteName()}</h1>
            <p class="join__subtitle">Joining requires payment. Choose a plan, create your account, and pay — that's it.</p>

            <Show when={step() !== 'done'}>
                <ol class="subscription-signup__steps" aria-label="Sign-up steps">
                    <For each={steps()}>
                        {(s, i,) => (
                            <li classList={{ 'is-active': step() === s.key, 'is-done': i() < stepIndex(), }}>
                                <span>{i() + 1}</span>{s.label}
                            </li>
                        )}
                    </For>
                </ol>
            </Show>

            <Show when={error()}><div class="join__error">{error()}</div></Show>

            {/* 1 · Plan */}
            <Show when={step() === 'plan'}>
                <Show when={!tiers.loading} fallback={<p>Loading plans…</p>}>
                    <Show when={(tiers() ?? []).length} fallback={<p>No plans are available right now. Please check back soon.</p>}>
                        <section class="subscribe-page__grid" aria-label="Plans">
                            <For each={tiers()}>
                                {(t,) => (
                                    <article class="subscribe-card subscribe-card--paid" classList={{ 'subscribe-card--current': tierId() === t.id, }}>
                                        <header class="subscribe-card__head"><h2 class="subscribe-card__name">{t.name}</h2></header>
                                        <div class="subscribe-card__price">
                                            <PriceChoice
                                                tier={t}
                                                selected={chosenFor(t,)}
                                                onSelect={(id,) => pick(t, id,)}
                                                amountClass="subscribe-card__amount"
                                                perClass="subscribe-card__per"
                                            />
                                        </div>
                                        <Show when={!t.priceHidden}><span class="subscribe-card__freq">{freq(tierAtPrice(t, chosenFor(t,),),)}</span></Show>
                                        <Markdown class="subscribe-card__desc" text={t.description} />
                                        <button
                                            type="button"
                                            class="btn btn--primary subscribe-card__cta"
                                            onClick={() => {
                                                setTierId(t.id,);
                                                setError('',);
                                                setStep(t.requiresApproval ? 'application' : auth.user ? 'payment' : 'account',);
                                            }}
                                        >
                                            {t.requiresApproval ? 'Apply' : 'Join'}
                                        </button>
                                    </article>
                                )}
                            </For>
                        </section>
                    </Show>
                </Show>
                <p class="subscription-signup__login">Already a member? <A href="/login">Sign in</A></p>
            </Show>

            {/* 1b · Application (plans that require approval) */}
            <Show when={step() === 'application' && tier()}>
                <div class="subscription-signup__form">
                    <p class="subscription-signup__plan">
                        Applying for <strong>{tier()!.name}</strong><Show when={!noCard()}> · {shownPrice(chosenTier()!,)}</Show>{' '}
                        <button type="button" class="subscription-signup__change" onClick={() => setStep('plan',)}>Change</button>
                    </p>
                    <Show when={hasChoice() && !noCard()}>
                        <div class="subscription-signup__billing">
                            <span class="join__label">Billing</span>
                            <PriceChoice tier={tier()!} selected={chosenFor(tier()!,)} onSelect={(id,) => pick(tier()!, id,)} />
                        </div>
                    </Show>
                    <p class="subscription-signup__hint">
                        {noCard()
                            ? 'This membership requires approval. Tell us about yourself — pricing is shared once you are approved, and nothing is charged now.'
                            : 'This membership requires approval. Tell us about yourself — you will not be charged unless you are approved.'}
                    </p>
                    <ApplicationQuestions
                        tier={tier()!}
                        prefill={{ name: auth.user?.displayName ?? name(), email: auth.user?.email ?? email(), }}
                        onCollected={async (answers: FormAnswer[], form,) => {
                            // Sent NOW (signed in or not): the team is emailed and will call.
                            setSubmitted(await submitApplication(tier()!, answers, noCard() ? null : chosenFor(tier()!,),),);
                            const who = applicantFrom(form, answers,);
                            if (!name()) setName(who.name,);
                            if (!email()) setEmail(who.email,);
                            setStep('submitted',);
                        }}
                    />
                </div>
            </Show>

            {/* 1c · Submitted — then the account (if needed) and the card */}
            <Show when={step() === 'submitted' && tier()}>
                <div class="subscription-signup__form">
                    <ApplicationSubmitted
                        tierName={tier()!.name}
                        signedIn={!!auth.user}
                        noCard={noCard()}
                        busy={busy()}
                        onContinue={() => (noCard() && auth.user ? void finishOffer() : setStep(auth.user ? 'payment' : 'account',))}
                    />
                </div>
            </Show>

            {/* 2 · Account */}
            <Show when={step() === 'account'}>
                <form class="join__form subscription-signup__form" onSubmit={createAccount}>
                    <p class="subscription-signup__plan">
                        Plan: <strong>{tier()?.name}</strong><Show when={!noCard() && chosenTier()}> · {shownPrice(chosenTier()!,)}</Show>{' '}
                        <button type="button" class="subscription-signup__change" onClick={() => setStep('plan',)}>Change</button>
                    </p>
                    <div class="join__field">
                        <label for="ss-name" class="join__label">Name</label>
                        <input id="ss-name" class="join__input" type="text" required autocomplete="name" value={name()} onInput={(e,) => setName(e.currentTarget.value,)} />
                    </div>
                    <div class="join__field">
                        <label for="ss-email" class="join__label">Email</label>
                        <input id="ss-email" class="join__input" type="email" required autocomplete="email" value={email()} onInput={(e,) => setEmail(e.currentTarget.value,)} />
                    </div>
                    <div class="join__field">
                        <label for="ss-password" class="join__label">Password</label>
                        <input id="ss-password" class="join__input" type="password" required minLength={8} autocomplete="new-password" value={password()} onInput={(e,) => setPassword(e.currentTarget.value,)} />
                    </div>
                    <div class="join__field">
                        <label for="ss-confirm" class="join__label">Confirm password</label>
                        <input id="ss-confirm" class="join__input" type="password" required minLength={8} autocomplete="new-password" value={confirmPassword()} onInput={(e,) => setConfirmPassword(e.currentTarget.value,)} />
                    </div>
                    <button type="submit" class="join__btn join__btn--primary" disabled={busy()}>
                        {busy() ? 'Creating your account…' : needsApproval() ? 'Continue' : 'Continue to payment'}
                    </button>
                </form>
            </Show>

            {/* 3 · Card — an application saves it (no charge) */}
            <Show when={step() === 'payment' && needsApproval() && !noCard() && tier() && submitted()}>
                <div class="subscription-signup__form">
                    <ApplicationPayment
                        tier={tier()!}
                        application={submitted()!}
                        onDone={() => { setApplied(true,); void auth.refreshUser(); setStep('done',); }}
                    />
                    <p class="subscription-signup__hint">Your account is created and your application is in. You can sign in any time to add the card or check its status.</p>
                </div>
            </Show>

            {/* 3 · Payment */}
            <Show when={step() === 'payment' && !needsApproval()}>
                <div class="subscription-signup__form">
                    <Show when={chosenTier()} fallback={<p>Choose a plan first. <button type="button" class="subscription-signup__change" onClick={() => setStep('plan',)}>See plans</button></p>}>
                        {(t,) => (
                            <>
                                <Show when={hasChoice()}>
                                    <div class="subscription-signup__billing">
                                        <span class="join__label">Billing</span>
                                        <PriceChoice tier={tier()!} selected={chosenFor(tier()!,)} onSelect={(id,) => pick(tier()!, id,)} />
                                    </div>
                                </Show>
                                <div class="subscription-signup__summary">
                                    <div>
                                        <strong>{t().name}</strong>
                                        <span>{freq(t(),)}</span>
                                    </div>
                                    <strong>{shownPrice(t(),)}</strong>
                                    <Show when={billedNote(t(),)}> <small class="subscribe-card__billed">({billedNote(t(),)})</small></Show>
                                </div>
                                <p class="subscription-signup__hint">
                                    You are charged {money(t().priceCents, t().currency,)} now, then{per(t(),)} until you cancel.{' '}
                                    <button type="button" class="subscription-signup__change" onClick={() => setStep('plan',)}>Change plan</button>
                                </p>
                                <label class="join__label">Card</label>
                                <div class="subscription-signup__card" ref={(el,) => void mountCard(el,)} />
                                <button type="button" class="join__btn join__btn--primary" disabled={busy()} onClick={pay}>
                                    {busy() ? 'Processing…' : `Pay & start my membership`}
                                </button>
                                <p class="subscription-signup__hint">
                                    Your account is created. If the payment does not go through, sign in any time to finish from your profile.
                                </p>
                            </>
                        )}
                    </Show>
                </div>
            </Show>

            {/* 4 · Done */}
            <Show when={step() === 'done' && applied()}>
                <div class="join__success">
                    <ApplicationDone tierName={tier()?.name ?? 'membership'} noCard={noCard()} program={!!tier()?.roleOnly} />
                    <A href="/profile?tab=membership" class="join__btn join__btn--primary">View my account</A>
                </div>
            </Show>
            <Show when={step() === 'done' && !applied()}>
                <div class="join__success">
                    <h2>Welcome to {siteName()}!</h2>
                    <Show
                        when={auth.access?.reason === 'verify_email'}
                        fallback={
                            <>
                                <p>Your membership is active.</p>
                                <A href="/" class="join__btn join__btn--primary">Start exploring</A>
                            </>
                        }
                    >
                        <p>
                            Your membership is active. One last step: we sent a verification link to <strong>{auth.user?.email}</strong> —
                            open it to finish setting up your account.
                        </p>
                    </Show>
                </div>
            </Show>
        </div>
    );
};

export default SubscriptionSignup;
