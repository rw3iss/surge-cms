import type { Campaign, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import { usePluginEnabled, } from '../../hooks/usePluginGate';
import DonationForm from '../forms/donations/DonationForm';
import GiveButterWidget from './GiveButterWidget';
import TemplatedContent from './TemplatedContent';
import '../../pages/Campaign.scss';

/**
 * A campaign's donation form — the built-in Stripe form, or the GiveButter
 * widget when the campaign routes donations there.
 *
 * Rendered on its own by `{{campaignForm('slug-or-id')}}` and inside the full
 * `CampaignDetail`. On its own it is JUST the form: the text fields are
 * OPT-IN here (the opposite of `{{campaign()}}`), each taking `true` (the
 * campaign's own value) or a string (an override), e.g.
 * `{{campaignForm('x', title=true, shortDescription='Every dollar helps')}}`.
 */
export interface CampaignFormOptions {
    title?: boolean | string;
    slug?: boolean | string;
    shortDescription?: boolean | string;
    fullDescription?: boolean | string;
}

/** Opt-in field: `true` → the campaign's value, a string → override, else hidden. */
export function optInField(v: boolean | string | undefined, own: string | undefined | null,): string | null {
    if (v === true) return own || null;
    if (typeof v === 'string') return v;
    return null;
}

const CampaignForm: Component<{ campaign: Campaign; options?: CampaignFormOptions; }> = (props,) => {
    const gbEnabled = usePluginEnabled('givebutter',);
    const c = () => props.campaign;
    const useGiveButter = () => gbEnabled() && c().donationProvider === 'givebutter';

    const title = () => optInField(props.options?.title, c().title,);
    const slug = () => optInField(props.options?.slug, c().slug,);
    const shortDescription = () => optInField(props.options?.shortDescription, c().shortDescription,);
    const fullDescription = () => optInField(props.options?.fullDescription, c().description,);

    return (
        <div class="campaign-form">
            <Show when={title()}>
                <h2 class="campaign-form__title">{title()}</h2>
            </Show>
            <Show when={slug()}>
                <div class="campaign-detail__slug">{slug()}</div>
            </Show>
            <Show when={shortDescription()}>
                <p class="campaign-page__subtitle">{shortDescription()}</p>
            </Show>
            <Show when={fullDescription()}>
                <TemplatedContent
                    class="campaign-page__description rich-text"
                    html={fullDescription()}
                    entities={{
                        campaign: { kind: 'campaign', data: c() as unknown as Record<string, unknown>, id: c().id, },
                    }}
                />
            </Show>
            <div class="campaign-page__donate">
                <Show when={useGiveButter()} fallback={<DonationForm campaignId={c().id} showVisibility={c().showDonorListing === true} />}>
                    <GiveButterWidget code={c().givebutterCampaignCode} type="giving-form" />
                </Show>
            </div>
        </div>
    );
};

export default CampaignForm;
