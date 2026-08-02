import type { Campaign, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import DonationForm from '../forms/donations/DonationForm';
import GiveButterWidget from './GiveButterWidget';
import TemplatedContent from './TemplatedContent';
import { usePluginEnabled, } from '../../hooks/usePluginGate';
import '../../pages/Campaign.scss';

/**
 * The full campaign render — hero image, title, subtitle, raised/goal tracker,
 * the templated description, and the donation form (GiveButter widget or the
 * built-in Stripe form). Extracted from the campaign PAGE so the SAME body is
 * reused by `/campaigns/:slug` AND the `{{campaign('slug-or-id')}}` template
 * function (which renders the whole campaign inline, form and all).
 *
 * `options` is a keyword-arg bag from the template (`{{campaign('x', form=false)}}`)
 * — each section can be toggled; everything defaults on so a bare
 * `{{campaign('x')}}` matches the campaign page. (Fuller option set is a
 * follow-up.)
 */
export interface CampaignDetailOptions {
    /** Show the hero/featured image. Default true. */
    image?: boolean;
    /** Show the title. Default true. */
    title?: boolean;
    /** Show the short-description subtitle. Default true. */
    subtitle?: boolean;
    /** Show the raised/goal tracker + stats. Default = the campaign's own
     *  `showRaisedAmount`. */
    raised?: boolean;
    /** Show the templated description body. Default true. */
    description?: boolean;
    /** Show the donation form. Default true. */
    form?: boolean;
}

const CampaignDetail: Component<{ campaign: Campaign; options?: CampaignDetailOptions; }> = (props,) => {
    const gbEnabled = usePluginEnabled('givebutter',);
    const useGiveButter = () => gbEnabled() && props.campaign.donationProvider === 'givebutter';

    /** Read a boolean option; `undefined` → the supplied default. */
    const on = (v: boolean | undefined, dflt: boolean,): boolean => (v === undefined ? dflt : v !== false);

    const showImage = () => on(props.options?.image, true,);
    const showTitle = () => on(props.options?.title, true,);
    const showSubtitle = () => on(props.options?.subtitle, true,);
    const showRaised = () => on(props.options?.raised, props.campaign.showRaisedAmount !== false,);
    const showDescription = () => on(props.options?.description, true,);
    const showForm = () => on(props.options?.form, true,);

    const progress = () => {
        const c = props.campaign;
        if (!c.goalAmountCents) return 0;
        return Math.min((c.currentAmountCents / c.goalAmountCents) * 100, 100,);
    };
    const formatCurrency = (cents: number,) =>
        `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, },)}`;
    const formatDate = (d: string | Date | undefined,) =>
        d ? new Date(d,).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', },) : null;

    const c = () => props.campaign;

    return (
        <div class="campaign-detail">
            <Show when={showImage() && c().featuredImage}>
                <div class="campaign-page__hero">
                    <img src={c().featuredImage!} alt={c().title} />
                </div>
            </Show>

            <div class="campaign-page__content">
                <Show when={showTitle()}>
                    <h1 class="campaign-page__title">{c().title}</h1>
                </Show>

                <Show when={showSubtitle() && c().shortDescription}>
                    <p class="campaign-page__subtitle">{c().shortDescription}</p>
                </Show>

                <Show when={showRaised()}>
                    <div class="campaign-page__tracker">
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
                            <Show when={(c() as any).startDate}>
                                <div class="campaign-page__stat">
                                    <span class="campaign-page__stat-value">{formatDate((c() as any).startDate,)}</span>
                                    <span class="campaign-page__stat-label">started</span>
                                </div>
                            </Show>
                            <Show when={(c() as any).endDate}>
                                <div class="campaign-page__stat">
                                    <span class="campaign-page__stat-value">{formatDate((c() as any).endDate,)}</span>
                                    <span class="campaign-page__stat-label">ends</span>
                                </div>
                            </Show>
                        </div>
                    </div>
                </Show>

                <Show when={showDescription()}>
                    <TemplatedContent
                        class="campaign-page__description rich-text"
                        html={c().description}
                        entities={{ campaign: { kind: 'campaign', data: c() as unknown as Record<string, unknown>, id: c().id, }, }}
                    />
                </Show>

                <Show when={showForm()}>
                    <div class="campaign-page__donate">
                        <h2>Make a Donation</h2>
                        <Show
                            when={useGiveButter()}
                            fallback={<DonationForm campaignId={c().id} />}
                        >
                            <GiveButterWidget code={c().givebutterCampaignCode} type="giving-form" />
                        </Show>
                    </div>
                </Show>
            </div>
        </div>
    );
};

export default CampaignDetail;
