import { A, } from '@solidjs/router';
import type { Campaign, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';

/**
 * Teaser "link block" for a single campaign — title, short description, and
 * (when the operator allows) the raised/goal progress — linking to the full
 * campaign page. Rendered by the `campaign` content block AND the
 * `{{campaignLink('slug-or-id')}}` template function.
 *
 * Styling (`.campaign-block*`) lives in `BlockRenderer.scss`, which is loaded on
 * any block-rendered page (where this component is used).
 */
const CampaignCard: Component<{ campaign: Campaign; }> = (props,) => {
    // Whether to surface any monetary info at all (operator toggle).
    const showAmount = () => props.campaign.showRaisedAmount !== false;
    // A goal is set only when goalAmountCents is a positive number; a null/0
    // goal is an open/unlimited fund (no goal, no progress bar).
    const hasGoal = () => !!props.campaign.goalAmountCents && props.campaign.goalAmountCents > 0;
    const raised = () => `$${(props.campaign.currentAmountCents / 100).toLocaleString()}`;

    return (
        <A
            href={`/campaigns/${props.campaign.slug}`}
            class="campaign-block"
            style={{ 'text-decoration': 'none', color: 'inherit', display: 'block', }}
        >
            <h2 class="campaign-block__title">{props.campaign.title}</h2>
            <p class="campaign-block__desc">{props.campaign.shortDescription}</p>
            <Show when={showAmount()}>
                <Show when={hasGoal()}>
                    <div class="campaign-block__progress">
                        <div
                            class="campaign-block__progress-bar"
                            style={{
                                width: `${
                                    Math.min(
                                        (props.campaign.currentAmountCents / props.campaign.goalAmountCents) * 100,
                                        100,
                                    )
                                }%`,
                            }}
                        />
                    </div>
                </Show>
                <p class="campaign-block__stats">
                    <Show
                        when={hasGoal()}
                        fallback={<>{raised()} raised so far</>}
                    >
                        {raised()} of ${(props.campaign.goalAmountCents / 100).toLocaleString()}
                    </Show>
                </p>
            </Show>
        </A>
    );
};

export default CampaignCard;
