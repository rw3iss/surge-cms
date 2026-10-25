/**
 * The membership level cards + the apply flow — ONE implementation shared by
 * the /subscribe page and `{{ membershipLevels(levels='a,b') }}` (e.g. a
 * partner-program page). Each card: name, price (PriceChoice), frequency,
 * Markdown description and the action (Join / Apply / Start / Current …).
 *
 * `applyInPlace`: Apply opens the application right here even when signed out
 * (applications accept anonymous applicants, who claim it after sign-up). The
 * /subscribe page instead sends a signed-out visitor through /join, which only
 * offers the listed levels — fine there, but a featured HIDDEN level would be
 * lost on the way.
 */
import { useNavigate, useSearchParams, } from '@solidjs/router';
import type { MembershipPublicTiersResponse, MembershipTierOption, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, Show, } from 'solid-js';
import Markdown from '../common/Markdown';
import { ApplyModal, } from './MembershipApplication';
import PriceChoice from './PriceChoice';
import { defaultPriceId, freq, leadPriceId, tierAtPrice, } from '../../utils/membershipFormat';
import { joinUrl, } from '../../utils/membershipChoice';
import '../../pages/Subscribe.scss';

export const membershipUrl = (tierId?: string,) => `/profile?tab=membership${tierId ? `&tier=${encodeURIComponent(tierId,)}` : ''}`;

export interface MembershipTierCardsProps {
    tiers: MembershipTierOption[];
    /** The viewer's current level (marks its card). */
    current?: MembershipTierOption;
    signedIn: boolean;
    /** Subscription-required mode (a new visitor signs up WITH a plan). */
    required: boolean;
    pending: MembershipPublicTiersResponse['pendingApplication'];
    /** Apply opens the application here, signed in or not. */
    applyInPlace?: boolean;
    /** After an application was sent — reload the levels. */
    onApplied: () => void;
}

const MembershipTierCards: Component<MembershipTierCardsProps> = (props,) => {
    const navigate = useNavigate();
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

    // Back from log-in with `?apply=<tierId>`: open that application.
    const [search, setSearch,] = useSearchParams<{ apply?: string; price?: string; }>();
    createEffect(() => {
        const id = search.apply;
        if (!id || !props.signedIn || !props.tiers.length) return;
        const t = props.tiers.find((x,) => x.id === id && x.requiresApproval && !x.isPending,);
        const price = search.price;
        setSearch({ apply: undefined, price: undefined, },);
        if (t && price && t.prices?.some((p,) => p.priceId === price,)) setPicked({ ...picked(), [t.id]: price, },);
        if (t && !props.pending) setApplying(t,);
    },);

    const choose = (t: MembershipTierOption,) => {
        if (t.isPending) return;
        // Approved for this level: choose billing + pay on the membership tab.
        if (t.isApproved) return navigate(`${membershipUrl(t.id,)}${priceParam(t,)}`,);
        if (t.requiresApproval) {
            if (props.signedIn || props.applyInPlace) return setApplying(t,);
            // Signed out: assume a NEW visitor — /join carries the choice through
            // sign-up (and offers "Sign in" for an existing account).
            if (props.required) return navigate(`/join?tier=${encodeURIComponent(t.id,)}${priceParam(t,)}`,);
            return navigate(joinUrl({ tier: t.id, price: altPrice(t,), apply: true, },),);
        }
        if (!props.signedIn) {
            if (props.required) return navigate(`/join?tier=${encodeURIComponent(t.id,)}${priceParam(t,)}`,);
            return navigate(t.isFree ? '/join' : joinUrl({ tier: t.id, price: altPrice(t,), },),);
        }
        navigate(`${membershipUrl(t.id,)}${priceParam(t,)}`,);
    };

    const ctaLabel = (t: MembershipTierOption,) => {
        if (props.current?.id === t.id) return 'Your current plan';
        if (t.isPending) return 'Application pending';
        if (t.isApproved) return 'Start membership';
        if (t.requiresApproval) return 'Apply';
        if (t.isFree) return props.signedIn ? 'Switch to Free' : 'Join for free';
        return 'Join';
    };

    return (
        <>
            <section class="subscribe-page__grid" aria-label="Plans">
                <For each={props.tiers}>
                    {(t,) => (
                        <article
                            class="subscribe-card"
                            classList={{ 'subscribe-card--current': props.current?.id === t.id, 'subscribe-card--paid': !t.isFree, }}
                        >
                            <header class="subscribe-card__head">
                                <h2 class="subscribe-card__name">{t.name}</h2>
                                <Show when={props.current?.id === t.id}>
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
                            <Show when={!t.priceHidden}><span class="subscribe-card__freq">{freq(tierAtPrice(t, chosen(t,),),)}</span></Show>
                            <Markdown class="subscribe-card__desc" text={t.description} />
                            <button
                                type="button"
                                class={`btn subscribe-card__cta ${t.isFree ? 'btn--outline' : 'btn--primary'}`}
                                disabled={props.current?.id === t.id || !!t.isPending || (!!props.pending && !!t.requiresApproval && !t.isApproved)}
                                onClick={() => choose(t,)}
                            >
                                {ctaLabel(t,)}
                            </button>
                        </article>
                    )}
                </For>
            </section>
            <Show when={applying()}>
                <ApplyModal
                    tier={applying()!}
                    priceId={chosen(applying()!,)}
                    onClose={() => setApplying(null,)}
                    onApplied={() => props.onApplied()}
                />
            </Show>
        </>
    );
};

export default MembershipTierCards;
