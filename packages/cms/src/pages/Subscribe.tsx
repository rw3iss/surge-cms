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
import { A, } from '@solidjs/router';
import type { MembershipPublicTiersResponse, } from '@sitesurge/types';
import { Component, createEffect, createSignal, on, Show, } from 'solid-js';
import MembershipTierCards, { membershipUrl, } from '../components/membership/MembershipTierCards';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import { useAuth, } from '../stores/auth';
import { siteName, } from '../stores/siteSettings';
import { shownPrice, } from '../utils/membershipFormat';
import './Subscribe.scss';

const loginUrl = (after: string,) => `/login?redirect=${encodeURIComponent(after,)}`;

const SubscribePage: Component = () => {
    const auth = useAuth();
    const [data, setData,] = createSignal<MembershipPublicTiersResponse | null>(null,);
    const [failed, setFailed,] = createSignal(false,);
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

    const offer = () => data()?.approvedOffer ?? null;

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
                    {pending()!.noCard
                        ? ' nothing is charged until you choose your billing after approval.'
                        : pending()!.hasCard
                        ? ' your card will not be charged until then.'
                        : <> but first <A href="/profile?tab=membership">add your card to finish your application</A> (it is not charged unless you are approved).</>}
                </div>
            </Show>
            <Show when={offer()}>
                <div class="subscribe-page__required subscribe-page__pending" role="status">
                    You're approved for <strong>{offer()!.tierName}</strong>! Choose your billing below and start your membership.
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
                    <MembershipTierCards
                        tiers={tiers()}
                        current={current()}
                        signedIn={signedIn()}
                        required={required()}
                        pending={pending()}
                        onApplied={() => void load()}
                    />
                </Show>
            </Show>
        </div>
    );
};

export default SubscribePage;
