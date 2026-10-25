/**
 * `{{ membershipLevels(levels='affiliate-test,contributor-test') }}` — the
 * named membership levels as /subscribe-style cards, in that order, hidden
 * levels included (a "partner program" page features levels kept off
 * /subscribe). Same cards + apply flow as /subscribe (`MembershipTierCards`);
 * Apply opens the application here, signed in or not.
 */
import type { MembershipPublicTiersResponse, } from '@sitesurge/types';
import { Component, createEffect, createSignal, on, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import MembershipTierCards from './MembershipTierCards';

const MembershipLevels: Component<{ levels: string[]; }> = (props,) => {
    const auth = useAuth();
    const [data, setData,] = createSignal<MembershipPublicTiersResponse | null>(null,);
    const load = () => cms.payments.membershipTiers(props.levels,).then(setData,).catch(() => setData(null,),);
    // Reload when the viewer signs in / out (current level, pending application).
    createEffect(on(() => [auth.user?.id ?? null, props.levels.join(',',),], () => { void load(); },),);
    const tiers = () => data()?.tiers ?? [];
    const pending = () => data()?.pendingApplication ?? null;
    const offer = () => data()?.approvedOffer ?? null;

    return (
        <div class="membership-levels">
            <Show when={pending()}>
                <div class="subscribe-page__required subscribe-page__pending" role="status">
                    Your application for <strong>{pending()!.tierName}</strong> is waiting for approval. We will email you when it is reviewed.
                </div>
            </Show>
            <Show when={offer()}>
                <div class="subscribe-page__required subscribe-page__pending" role="status">
                    You're approved for <strong>{offer()!.tierName}</strong>!
                </div>
            </Show>
            <Show when={tiers().length}>
                <MembershipTierCards
                    tiers={tiers()}
                    current={tiers().find((t,) => t.isCurrent,)}
                    signedIn={!!auth.user}
                    required={Boolean(data()?.subscriptionRequired,)}
                    pending={pending()}
                    applyInPlace
                    onApplied={() => void load()}
                />
            </Show>
        </div>
    );
};

export default MembershipLevels;
