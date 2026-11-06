/**
 * `{{ membershipLevels(levels='affiliate,contributor') }}` — the
 * named membership levels as /subscribe-style cards, in that order, hidden
 * levels included (a "partner program" page features levels kept off
 * /subscribe). Same cards + apply flow as /subscribe (`MembershipTierCards`);
 * Apply opens the application here, signed in or not.
 */
import type { MembershipPublicTiersResponse, } from '@sitesurge/types';
import { Component, createEffect, createSignal, on, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import MembershipNotices from './MembershipNotices';
import MembershipTierCards from './MembershipTierCards';

const MembershipLevels: Component<{ levels: string[]; }> = (props,) => {
    const auth = useAuth();
    const [data, setData,] = createSignal<MembershipPublicTiersResponse | null>(null,);
    const [failed, setFailed,] = createSignal(false,);
    const load = () => cms.payments.membershipTiers(props.levels,)
        .then((r,) => { setData(r,); setFailed(false,); },)
        .catch(() => { if (!data()) setFailed(true,); },);
    // Reload when the viewer signs in / out (current level, pending application).
    createEffect(on(() => [auth.user?.id ?? null, props.levels.join(',',),], () => { void load(); },),);
    const tiers = () => data()?.tiers ?? [];
    const pending = () => data()?.pendingApplication ?? null;
    const offer = () => data()?.approvedOffer ?? null;

    return (
        <div class="membership-levels">
            <MembershipNotices pending={pending()} offer={offer()} />
            <Show when={failed()}>
                <p class="subscribe-page__note" role="alert">The membership levels could not be loaded. Please try again later.</p>
            </Show>
            <Show when={tiers().length}>
                <MembershipTierCards
                    tiers={tiers()}
                    current={tiers().find((t,) => t.isCurrent && !t.roleOnly,)}
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
