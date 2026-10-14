/**
 * A membership level's price + its ALTERNATIVE prices (same Stripe product,
 * other billing periods — e.g. $25 / month, $250 / year).
 *
 * The level's default price stays the big one; the others sit to its right as
 * small, equally spaced labels. With `selected` + `onSelect` they are buttons:
 * picking one marks it, and the caller carries that `priceId` to Join / Apply /
 * the change preview. Without alternatives it renders just the price.
 */
import type { MembershipTierOption, } from '@sitesurge/types';
import { Component, For, Show, } from 'solid-js';
import { billedNote, leadPriceId, money, per, priceOptionFreq, priceOptionLabel, shown, } from '../../utils/membershipFormat';
import './PriceChoice.scss';

export interface PriceChoiceProps {
    tier: MembershipTierOption;
    /** The chosen price id (default when null). */
    selected?: string | null;
    /** Make the prices selectable. */
    onSelect?: (priceId: string,) => void;
    /** Class prefix for the main price (keeps each page's existing look). */
    amountClass?: string;
    perClass?: string;
}

const PriceChoice: Component<PriceChoiceProps> = (props,) => {
    const prices = () => props.tier.prices ?? [];
    // The BIG price: normally the default; a real price identical to the custom
    // display takes its place (see leadPriceId) so no two options read the same.
    const def = () => prices().find((p,) => p.priceId === leadPriceId(props.tier,),) ?? prices()[0];
    const sel = () => props.selected ?? def()?.priceId ?? null;
    const alts = () => prices().filter((p,) => p.priceId !== def()?.priceId,);
    /** The big price's text: the custom display for the default, else its real billing. */
    const mainAmount = () => (def() && !def()!.isDefault ? money(def()!.amount, def()!.currency,) : money(shown(props.tier,).priceCents, props.tier.currency,));
    const mainPer = () => (def() && !def()!.isDefault ? per({ isFree: false, interval: def()!.interval, intervalCount: def()!.intervalCount, },) : per(shown(props.tier,),));
    const pick = (id: string, e: Event,) => {
        e.stopPropagation();
        props.onSelect?.(id,);
    };
    // A "hide price" level the viewer is not approved for: no prices at all.
    if (props.tier.priceHidden) {
        return <div class="price-choice"><span class="price-choice__hidden">Pricing shared after approval</span></div>;
    }
    return (
        <div class="price-choice" classList={{ 'price-choice--selectable': !!props.onSelect, }}>
            <Show
                when={def() && props.onSelect && alts().length}
                fallback={
                    <span class="price-choice__main">
                        <span class={props.amountClass}>{props.tier.isFree ? 'Free' : money(shown(props.tier,).priceCents, props.tier.currency,)}</span>
                        <Show when={!props.tier.isFree}><span class={props.perClass}>{per(shown(props.tier,),)}</span></Show>
                    </span>
                }
            >
                <button
                    type="button"
                    class="price-choice__main price-choice__opt"
                    classList={{ 'is-selected': sel() === def()!.priceId, }}
                    aria-pressed={sel() === def()!.priceId}
                    onClick={(e,) => pick(def()!.priceId, e,)}
                >
                    <span class={props.amountClass}>{mainAmount()}</span>
                    <span class={props.perClass}>{mainPer()}</span>
                </button>
            </Show>
            <Show when={alts().length}>
                <span class="price-choice__alts">
                    <For each={alts()}>
                        {(p,) => (
                            <Show
                                when={props.onSelect}
                                fallback={<span class="price-choice__alt" title={priceOptionFreq(p,)}>{priceOptionLabel(p,)}</span>}
                            >
                                <button
                                    type="button"
                                    class="price-choice__alt price-choice__opt"
                                    classList={{ 'is-selected': sel() === p.priceId, }}
                                    aria-pressed={sel() === p.priceId}
                                    title={`Pay ${priceOptionFreq(p,).toLowerCase()}`}
                                    onClick={(e,) => pick(p.priceId, e,)}
                                >
                                    {priceOptionLabel(p,)}
                                </button>
                            </Show>
                        )}
                    </For>
                </span>
            </Show>
            <Show when={sel() === def()?.priceId && def()?.isDefault && billedNote(props.tier,)}>
                <span class="price-choice__billed">{billedNote(props.tier,)}</span>
            </Show>
        </div>
    );
};

export default PriceChoice;
