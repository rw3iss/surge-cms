import type { Campaign, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import CampaignDonors from './CampaignDonors';
import '../../pages/Campaign.scss';

/**
 * The campaign's status panel — amount raised, goal + progress bar, donor
 * count and dates, then (when enabled) the Recent Donors list.
 *
 * Rendered on its own by `{{campaignStatus('slug-or-id')}}` and inside the full
 * `CampaignDetail` (campaign page + `{{campaign()}}`).
 */
export interface CampaignStatusOptions {
    /** Raised/goal tracker. Default = the campaign's `showRaisedAmount`. */
    raised?: boolean;
    /** Recent Donors list. Default = the campaign's `showDonorListing`. */
    donors?: boolean;
}

const CampaignStatus: Component<{ campaign: Campaign; options?: CampaignStatusOptions; }> = (props,) => {
    const c = () => props.campaign;
    const on = (v: boolean | undefined, dflt: boolean,): boolean => (v === undefined ? dflt : v !== false);
    const showRaised = () => on(props.options?.raised, c().showRaisedAmount !== false,);
    const showDonors = () => on(props.options?.donors, c().showDonorListing === true,);

    const progress = () => {
        const cc = c();
        if (!cc.goalAmountCents) return 0;
        return Math.min((cc.currentAmountCents / cc.goalAmountCents) * 100, 100,);
    };
    const formatCurrency = (cents: number,) =>
        `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, },)}`;
    const formatDate = (d: string | Date | undefined,) =>
        d ? new Date(d,).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', },) : null;

    return (
        <Show when={showRaised() || showDonors()}>
            <div class="campaign-page__tracker campaign-status">
                <Show when={showRaised()}>
                    <div class="campaign-page__tracker-header">
                        <span class="campaign-page__tracker-raised">{formatCurrency(c().currentAmountCents,)}</span>
                        <Show
                            when={c().goalAmountCents}
                            fallback={<span class="campaign-page__tracker-goal">raised</span>}
                        >
                            <span class="campaign-page__tracker-goal">
                                raised of {formatCurrency(c().goalAmountCents,)} goal
                            </span>
                        </Show>
                    </div>

                    <Show when={c().goalAmountCents}>
                        <div class="campaign-page__progress">
                            <div class="campaign-page__progress-fill" style={{ width: `${progress()}%`, }} />
                        </div>
                        <div class="campaign-page__tracker-percent">{Math.round(progress(),)}% funded</div>
                    </Show>

                    <div class="campaign-page__tracker-stats">
                        <div class="campaign-page__stat">
                            <span class="campaign-page__stat-value">{c().donorCount || 0}</span>
                            <span class="campaign-page__stat-label">
                                {c().donorCount === 1 ? 'donor' : 'donors'}
                            </span>
                        </div>
                        <Show when={c().startDate}>
                            <div class="campaign-page__stat">
                                <span class="campaign-page__stat-value">{formatDate(c().startDate,)}</span>
                                <span class="campaign-page__stat-label">started</span>
                            </div>
                        </Show>
                        <Show when={c().endDate}>
                            <div class="campaign-page__stat">
                                <span class="campaign-page__stat-value">{formatDate(c().endDate,)}</span>
                                <span class="campaign-page__stat-label">ends</span>
                            </div>
                        </Show>
                    </div>
                </Show>

                <Show when={showDonors()}>
                    {/* Amounts follow "Show raised amount": off means no figures anywhere. */}
                    <CampaignDonors campaignId={c().id} showAmounts={c().showRaisedAmount !== false} />
                </Show>
            </div>
        </Show>
    );
};

export default CampaignStatus;
