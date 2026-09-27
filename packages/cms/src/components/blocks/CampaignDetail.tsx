import type { Campaign, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import CampaignForm from './CampaignForm';
import CampaignStatus from './CampaignStatus';
import TemplatedContent from './TemplatedContent';
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
 *
 * Composed from the two pieces the template engine also exposes on their
 * own: `CampaignStatus` (`{{campaignStatus()}}` — raised/goal + Recent Donors)
 * and `CampaignForm` (`{{campaignForm()}}` — the donation form).
 */
export interface CampaignDetailOptions {
    /** Title (h1). omitted/true → campaign title · false → hide · string → override. */
    title?: boolean | string;
    /** Slug line — OPT-IN (hidden by default). true → campaign slug · string →
     *  override · omitted/false → hidden. */
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
    /** Recent Donors list. Default = the campaign's `showDonorListing`. */
    donors?: boolean;
    /** Donation form. Default true. */
    form?: boolean;
}

const CampaignDetail: Component<{ campaign: Campaign; options?: CampaignDetailOptions; }> = (props,) => {
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
    // Slug is OPT-IN (hidden by default): only rendered when explicitly requested
    // via slug=true (→ the campaign's slug) or a string override.
    const slug = () => {
        const v = props.options?.slug;
        if (v === true) return c().slug || null;
        if (typeof v === 'string') return v;
        return null;
    };
    const shortDescription = () => field(props.options?.shortDescription, c().shortDescription,);
    const fullDescription = () => field(props.options?.fullDescription, c().description,);
    const showImage = () => on(props.options?.image, true,);
    const showForm = () => on(props.options?.form, true,);

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
                    <div class="campaign-detail__slug">{slug()}</div>
                </Show>

                <Show when={shortDescription()}>
                    <p class="campaign-page__subtitle">{shortDescription()}</p>
                </Show>

                <CampaignStatus
                    campaign={c()}
                    options={{ raised: props.options?.raised, donors: props.options?.donors, }}
                />

                <Show when={fullDescription()}>
                    <TemplatedContent
                        class="campaign-page__description rich-text"
                        html={fullDescription()}
                        entities={{ campaign: { kind: 'campaign', data: c() as unknown as Record<string, unknown>, id: c().id, }, }}
                    />
                </Show>

                {/* The text fields are already shown above, so the form renders bare. */}
                <Show when={showForm()}>
                    <CampaignForm campaign={c()} />
                </Show>
            </div>
        </div>
    );
};

export default CampaignDetail;
