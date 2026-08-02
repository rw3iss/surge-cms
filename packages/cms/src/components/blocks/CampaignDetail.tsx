import type { Campaign, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import DonationForm from '../forms/donations/DonationForm';
import GiveButterWidget from './GiveButterWidget';
import TemplatedContent from './TemplatedContent';
import { usePluginEnabled, } from '../../hooks/usePluginGate';
import '../../pages/Campaign.scss';

/**
 * The full campaign render — hero image, title, slug, short/full description,
 * raised/goal tracker, and the donation form (GiveButter widget or the built-in
 * Stripe form). Extracted from the campaign PAGE so the SAME body is reused by
 * `/campaigns/:slug` AND the `{{campaign('slug-or-id')}}` template function.
 *
 * Per-field options come from the template's positional/keyword args
 * (`{{campaign('x', title=false, shortDescription='Custom')}}`). The four text
 * fields each take a **boolean** (show/hide the campaign's own value) OR a
 * **string** (override the value AND show it). Everything defaults on so a bare
 * `{{campaign('x')}}` renders the whole campaign.
 */
export interface CampaignDetailOptions {
    /** Title (h1). omitted/true → campaign title · false → hide · string → override. */
    title?: boolean | string;
    /** Slug line. omitted/true → campaign slug · false → hide · string → override. */
    slug?: boolean | string;
    /** Short-description subtitle. omitted/true → value · false → hide · string → override. */
    shortDescription?: boolean | string;
    /** Full description body (rendered through the `{{ }}` engine).
     *  omitted/true → campaign description · false → hide · string → override. */
    fullDescription?: boolean | string;
    /** Hero/featured image. Default true. */
    image?: boolean;
    /** Raised/goal tracker + stats. Default = the campaign's `showRaisedAmount`. */
    raised?: boolean;
    /** Donation form. Default true. */
    form?: boolean;
}

const CampaignDetail: Component<{ campaign: Campaign; options?: CampaignDetailOptions; }> = (props,) => {
    const gbEnabled = usePluginEnabled('givebutter',);
    const useGiveButter = () => gbEnabled() && props.campaign.donationProvider === 'givebutter';

    /** Boolean option → show/hide (undefined → the supplied default). */
    const on = (v: boolean | undefined, dflt: boolean,): boolean => (v === undefined ? dflt : v !== false);
    /** Field option → the string to render (or null to hide): `false` hides, a
     *  string overrides, `true`/undefined use the campaign's own value. */
    const field = (v: boolean | string | undefined, dflt: string | undefined | null,): string | null => {
        if (v === false) return null;
        if (typeof v === 'string') return v;
        return dflt || null;
    };

    const c = () => props.campaign;
    const title = () => field(props.options?.title, c().title,);
    const slug = () => field(props.options?.slug, c().slug,);
    const shortDescription = () => field(props.options?.shortDescription, c().shortDescription,);
    const fullDescription = () => field(props.options?.fullDescription, c().description,);
    const showImage = () => on(props.options?.image, true,);
    const showRaised = () => on(props.options?.raised, c().showRaisedAmount !== false,);
    const showForm = () => on(props.options?.form, true,);

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
        <div class="campaign-detail">
            <Show when={showImage() && c().featuredImage}>
                <div class="campaign-page__hero">
                    <img src={c().featuredImage!} alt={c().title} />
                </div>
            </Show>

            <div class="campaign-page__content">
                <Show when={title()}>
                    <h1 class="campaign-page__title">{title()}</h1>
                </Show>

                <Show when={slug()}>
                    <div class="campaign-detail__slug" style={{ color: 'var(--site-text-muted, #6b7280)', 'font-size': '0.85rem', 'margin': '0 0 0.5rem', }}>
                        {slug()}
                    </div>
                </Show>

                <Show when={shortDescription()}>
                    <p class="campaign-page__subtitle">{shortDescription()}</p>
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

                <Show when={fullDescription()}>
                    <TemplatedContent
                        class="campaign-page__description rich-text"
                        html={fullDescription()}
                        entities={{ campaign: { kind: 'campaign', data: c() as unknown as Record<string, unknown>, id: c().id, }, }}
                    />
                </Show>

                <Show when={showForm()}>
                    <div class="campaign-page__donate">
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
