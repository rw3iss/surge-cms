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
 */
import { A, useNavigate, } from '@solidjs/router';
import type { MembershipPublicTiersResponse, MembershipTierOption, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, on, Show, } from 'solid-js';
import Markdown from '../components/common/Markdown';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import { useAuth, } from '../stores/auth';
import { siteName, } from '../stores/siteSettings';
import { freq, money, per, } from '../utils/membershipFormat';
import './Subscribe.scss';

const membershipUrl = (tierId?: string,) => `/profile?tab=membership${tierId ? `&tier=${encodeURIComponent(tierId,)}` : ''}`;
const loginUrl = (after: string,) => `/login?redirect=${encodeURIComponent(after,)}`;

const SubscribePage: Component = () => {
    const auth = useAuth();
    const navigate = useNavigate();
    const [data, setData,] = createSignal<MembershipPublicTiersResponse | null>(null,);
    const [failed, setFailed,] = createSignal(false,);

    // Reload when the viewer signs in/out (their "current" tier changes).
    createEffect(on(() => auth.user?.id ?? null, () => {
        cms.payments.membershipTiers().then(setData,).catch(() => setFailed(true,),);
    },),);

    const signedIn = () => !!auth.user;
    const tiers = () => data()?.tiers ?? [];
    const current = () => tiers().find((t,) => t.isCurrent) ?? (signedIn() ? tiers().find((t,) => t.isFree) : undefined);
    const paidAvailable = () => !!data()?.paidAvailable;

    const choose = (t: MembershipTierOption,) => {
        const target = membershipUrl(t.id,);
        navigate(signedIn() ? target : loginUrl(target,),);
    };

    const ctaLabel = (t: MembershipTierOption,) => {
        if (current()?.id === t.id) return 'Your current plan';
        if (t.isFree) return signedIn() ? 'Switch to Free' : 'Join for free';
        return `Choose ${t.name}`;
    };

    return (
        <div class="subscribe-page page-wrapper">
            <SeoHead
                title="Membership"
                description={`Membership plans for ${siteName()}.`}
                canonical={`${window.location.origin}/subscribe`}
            />

            <header class="subscribe-page__header">
                <h1>Membership</h1>
                <p class="subscribe-page__lead">
                    <Show when={paidAvailable()} fallback={`Everything on ${siteName()} is free to read.`}>
                        Support {siteName()} and get more — choose the plan that fits you.
                    </Show>
                </p>
            </header>

            <Show when={data()} fallback={<Show when={failed()} fallback={<div class="subscribe-page__loading" aria-busy="true" />}><p class="subscribe-page__note">Plans could not be loaded. Please try again later.</p></Show>}>
                <Show
                    when={paidAvailable()}
                    fallback={
                        <section class="subscribe-page__free">
                            <h2>{siteName()} is completely free</h2>
                            <p>There are no paid subscriptions right now — every article and video is open to everyone.</p>
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
                                    <span>Log in to see your plan, or create a free account to get started.</span>
                                </div>
                                <div class="subscribe-page__actions">
                                    <A href={loginUrl('/subscribe',)} class="btn btn--outline">Log in</A>
                                    <A href="/join" class="btn btn--primary">Create an account</A>
                                </div>
                            </section>
                        }
                    >
                        <section class="subscribe-page__tout subscribe-page__tout--current">
                            <div>
                                <span class="subscribe-page__eyebrow">Your plan</span>
                                <strong>{current()?.name ?? 'Free'}</strong>
                                <Show when={current() && !current()!.isFree}>
                                    <span>{money(current()!.priceCents, current()!.currency,)}{per(current()!,)}</span>
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
                                        <span class="subscribe-card__amount">{t.isFree ? 'Free' : money(t.priceCents, t.currency,)}</span>
                                        <Show when={!t.isFree}><span class="subscribe-card__per">{per(t,)}</span></Show>
                                    </div>
                                    <span class="subscribe-card__freq">{freq(t,)}</span>
                                    <Markdown class="subscribe-card__desc" text={t.description} />
                                    <button
                                        type="button"
                                        class={`btn subscribe-card__cta ${t.isFree ? 'btn--outline' : 'btn--primary'}`}
                                        disabled={current()?.id === t.id}
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
        </div>
    );
};

export default SubscribePage;
