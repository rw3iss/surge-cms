/**
 * The "application pending" / "you're approved" banners above the level cards
 * — ONE wording for /subscribe and `{{ membershipLevels(...) }}`.
 */
import { A, } from '@solidjs/router';
import type { MembershipPublicTiersResponse, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import { membershipUrl, } from './MembershipTierCards';

const MembershipNotices: Component<{
    pending: MembershipPublicTiersResponse['pendingApplication'];
    offer: MembershipPublicTiersResponse['approvedOffer'];
}> = (props,) => (
    <>
        <Show when={props.pending}>
            {(p,) => (
                <div class="subscribe-page__required subscribe-page__pending" role="status">
                    Your application for <strong>{p().tierName}</strong> is waiting for approval. We will email you when it is reviewed —
                    {p().noCard
                        ? ' nothing is charged until you choose your billing after approval.'
                        : p().hasCard
                        ? ' your card will not be charged until then.'
                        : <> but first <A href={membershipUrl()}>add your card to finish your application</A> (it is not charged unless you are approved).</>}
                </div>
            )}
        </Show>
        <Show when={props.offer}>
            {(o,) => (
                <div class="subscribe-page__required subscribe-page__pending" role="status">
                    You're approved for <strong>{o().tierName}</strong>!{' '}
                    <A href={membershipUrl(o().tierId,)}>Choose your billing and start your membership.</A>
                </div>
            )}
        </Show>
    </>
);

export default MembershipNotices;
