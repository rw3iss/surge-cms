/**
 * `/subscribe` — the site's membership "advert": every subscription tier
 * (Free included) as a card with its price and Markdown description.
 *
 *   - Only free tiers exist → a short "everything here is free" message.
 *   - Signed in → their current tier in a tout at the top (+ manage link).
 *   - Signed out → log in / create account, and the tiers below.
 *
 * Choosing a tier goes to profile → Membership with that tier picked
 * (`?tab=membership&tier=<id>`), through the login page when signed out —
 * payment and changes happen there, in one place.
 *
 * A tier that REQUIRES APPROVAL reads "Apply": signed in → the application
 * modal here (answers + a saved card, no charge); signed out → sign-up (or log
 * in) first. A pending application reads "Application pending".
 */
import { A, useNavigate, useSearchParams, } from '@solidjs/router';
import type { MembershipPublicTiersResponse, MembershipTierOption, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, on, Show, } from 'solid-js';
import Markdown from '../components/common/Markdown';
import { ApplyModal, } from '../components/membership/MembershipApplication';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import { useAuth, } from '../stores/auth';
import { siteName, } from '../stores/siteSettings';
import PriceChoice from '../components/membership/PriceChoice';
import { defaultPriceId, leadPriceId, freq, shownPrice, tierAtPrice, } from '../utils/membershipFormat';
import './Subscribe.scss';

const membershipUrl = (tierId?: string,) => `/profile?tab=membership${tierId ? `&tier=${encodeURIComponent(tierId,)}` : ''}`;
const loginUrl = (after: string,) => `/login?redirect=${encodeURIComponent(after,)}`;

const SubscribePage: Component = () => {
    const auth = useAuth();
    const navigate = useNavigate();
    const [data, setData,] = createSignal<MembershipPublicTiersResponse | null>(null,);
    const [failed, setFailed,] = createSignal(false,);
    const [applying, setApplying,] = createSignal<MembershipTierOption | null>(null,);
    /** The price the visitor picked per level (absent = the level's default). */
    const [picked, setPicked,] = createSignal<Record<string, string>>({},);
    const chosen = (t: MembershipTierOption,): string | null => picked()[t.id] ?? leadPriceId(t,);
    /** The chosen price when it is NOT the default — only then does it travel in URLs. */
    const altPrice = (t: MembershipTierOption,): string | null => {
        const c = chosen(t,);
        return c && c !== defaultPriceId(t,) ? c : null;
    };
    const priceParam = (t: MembershipTierOption,) => (altPrice(t,) ? `&price=${encodeURIComponent(altPrice(t,)!,)}` : '');
    const load = () => cms.payments.membershipTiers().then(setData,).catch(() => setFailed(true,),);

    // Reload when the viewer signs in/out (their "current" tier changes).
    createEffect(on(() => auth.user?.id ?? null, () => { void load(); },),);

    const signedIn = () => !!auth.user;
    const tiers = () => data()?.tiers ?? [];
    const current = () => tiers().find((t,) => t.isCurrent) ?? (signedIn() ? tiers().find((t,) => t.isFree) : undefined);
    /** A signed-in member walled by subscription-required mode. */
    const walled = () => Boolean(auth.access?.restricted && auth.access.reason === 'subscription',);
    const paidAvailable = () => !!data()?.paidAvailable;

    /** Subscription-required mode: Free is hidden and a new visitor signs up WITH a plan. */
    const required = () => Boolean(data()?.subscriptionRequired,);

    const pending = () => data()?.pendingApplication ?? null;

    // Back from log-in with `?apply=<tierId>`: open that application.
    const [search, setSearch,] = useSearchParams<{ apply?: string; price?: string; }>();
    createEffect(() => {
        const id = search.apply;
        if (!id || !signedIn() || !data()) return;
        const t = tiers().find((x,) => x.id === id && x.requiresApproval && !x.isPending,);
        const price = search.price;
        setSearch({ apply: undefined, price: undefined, },);
        if (t && price && t.prices?.some((p,) => p.priceId === price,)) setPicked({ ...picked(), [t.id]: price, },);
        if (t && !pending()) setApplying(t,);
    },);

    const choose = (t: MembershipTierOption,) => {
        if (t.isPending) return;
        if (t.requiresApproval) {
            if (signedIn()) return setApplying(t,);
            if (required()) return navigate(`/join?tier=${encodeURIComponent(t.id,)}${priceParam(t,)}`,);
            return navigate(loginUrl(`/subscribe?apply=${encodeURIComponent(t.id,)}${priceParam(t,)}`,),);
        }
        const target = `${membershipUrl(t.id,)}${priceParam(t,)}`;
        if (!signedIn() && required()) return navigate(`/join?tier=${encodeURIComponent(t.id,)}${priceParam(t,)}`,);
        navigate(signedIn() ? target : loginUrl(target,),);
    };

    const ctaLabel = (t: MembershipTierOption,) => {
        if (current()?.id === t.id) return 'Your current plan';
        if (t.isPending) return 'Application pending';
        if (t.requiresApproval) return 'Apply';
        if (t.isFree) return signedIn() ? 'Switch to Free' : 'Join for free';
        return 'Join';
    };

    return (
        <div class="subscribe-page page-wrapper">
            <SeoHead
                title="Membership"
                description={`Membership plans for ${siteName()}.`}
                canonical={`${window.location.origin}/subscribe`}
            />

            <Show when={pending()}>
                <div class="subscribe-page__required subscribe-page__pending" role="status">
                    Your application for <strong>{pending()!.tierName}</strong> is waiting for approval. We will email you when it is reviewed —
                    your card will not be charged until then.
                </div>
            </Show>
            <Show when={walled()}>
                <div class="subscribe-page__required" role="status">
                    {auth.access?.lapsed
                        ? 'Your membership has ended. Choose a plan to renew — or update your payment method in your profile.'
                        : 'A membership is required to use your account. Choose a plan below.'}
                </div>
            </Show>
            <header class="subscribe-page__header">
                <h1>Membership</h1>
                <p class="subscribe-page__lead">
                    <Show when={paidAvailable()} fallback={`Everything on ${siteName()} is free to read.`}>
                        Join the movement by choosing a plan that best fits you.
                    </Show>
                </p>
            </header>

            <Show when={data()} fallback={<Show when={failed()} fallback={<div class="subscribe-page__loading" aria-busy="true" />}><p class="subscribe-page__note">Plans could not be loaded. Please try again later.</p></Show>}>
                <Show
                    when={paidAvailable()}
                    fallback={
                        <section class="subscribe-page__free">
                            <h2>{siteName()} is completely free</h2>
                            <p>There are no paid memberships right now — every article and video is open to everyone.</p>
                            <Show when={!signedIn()}>
                                <p class="subscribe-page__note">Create a free account to comment, get updates and more.</p>
                                <div class="subscribe-page__actions">
                                    <A href="/join" class="btn btn--primary">Create an account</A>
                                    <A href={loginUrl('/subscribe',)} class="btn btn--outline">Log in</A>
                                </div>
                            </Show>
                        </section>
                    }
                >
                    {/* ── Who you are ── */}
                    <Show
                        when={signedIn()}
                        fallback={
                            <section class="subscribe-page__tout">
                                <div>
                                    <strong>Already a member?</strong>
                                    <span>
                                        {required()
                                            ? 'Log in to manage your plan, or choose a plan below to join.'
                                            : 'Log in to see your plan, or create a free account to get started.'}
                                    </span>
                                </div>
                                <div class="subscribe-page__actions">
                                    <A href={loginUrl('/subscribe',)} class="btn btn--outline">Log in</A>
                                    <Show when={!required()}><A href="/join" class="btn btn--primary">Create an account</A></Show>
                                </div>
                            </section>
                        }
                    >
                        <section class="subscribe-page__tout subscribe-page__tout--current">
                            <div>
                                <span class="subscribe-page__eyebrow">Your plan</span>
                                <strong>{current()?.name ?? (required() ? 'No active membership' : 'Free')}</strong>
                                <Show when={current() && !current()!.isFree}>
                                    <span>{shownPrice(current()!,)}</span>
                                </Show>
                            </div>
                            <A href={membershipUrl()} class="btn btn--outline">Manage membership</A>
                        </section>
                    </Show>

                    {/* ── Plans ── */}
                    <section class="subscribe-page__grid" aria-label="Plans">
                        <For each={tiers()}>
                            {(t,) => (
                                <article
                                    class="subscribe-card"
                                    classList={{ 'subscribe-card--current': current()?.id === t.id, 'subscribe-card--paid': !t.isFree, }}
                                >
                                    <header class="subscribe-card__head">
                                        <h2 class="subscribe-card__name">{t.name}</h2>
                                        <Show when={current()?.id === t.id}>
                                            <span class="subscribe-card__badge">Current</span>
                                        </Show>
                                    </header>
                                    <div class="subscribe-card__price">
                                        {/* Default price large; other billing periods as small chips beside it (pick one, then Join). */}
                                        <PriceChoice
                                            tier={t}
                                            selected={chosen(t,)}
                                            onSelect={(id,) => setPicked({ ...picked(), [t.id]: id, },)}
                                            amountClass="subscribe-card__amount"
                                            perClass="subscribe-card__per"
                                        />
                                    </div>
                                    <span class="subscribe-card__freq">{freq(tierAtPrice(t, chosen(t,),),)}</span>
                                    <Markdown class="subscribe-card__desc" text={t.description} />
                                    <button
                                        type="button"
                                        class={`btn subscribe-card__cta ${t.isFree ? 'btn--outline' : 'btn--primary'}`}
                                        disabled={current()?.id === t.id || !!t.isPending || (!!pending() && !!t.requiresApproval)}
                                        onClick={() => choose(t,)}
                                    >
                                        {ctaLabel(t,)}
                                    </button>
                                </article>
                            )}
                        </For>
                    </section>
                </Show>
            </Show>
            <Show when={applying()}>
                <ApplyModal
                    tier={applying()!}
                    priceId={chosen(applying()!,)}
                    onClose={() => setApplying(null,)}
                    onApplied={() => void load()}
                />
            </Show>
        </div>
    );
};

export default SubscribePage;
