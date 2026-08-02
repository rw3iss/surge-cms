import { A, useParams, } from '@solidjs/router';
import type { Campaign, } from '@sitesurge/types';
import { Component, createResource, Show, } from 'solid-js';
import CampaignDetail from '../components/blocks/CampaignDetail';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import { siteName, } from '../stores/siteSettings';
import { buildBreadcrumb, buildDonation, } from '../utils/schema';
import './Campaign.scss';

const CampaignPage: Component = () => {
    const params = useParams();
    const canonicalUrl = () => `${window.location.origin}/campaigns/${params.slug}`;

    const [campaign,] = createResource(() => params.slug, async (slug,) => {
        try {
            return await cms.campaigns.getBySlug(slug,) as Campaign;
        } catch {
            return null;
        }
    },);

    return (
        <div class="campaign-page">
            <Show when={campaign()} fallback={<div class="campaign-page__loading">Loading campaign...</div>}>
                {(c,) => (
                    <>
                        <SeoHead
                            title={c().title}
                            description={c().shortDescription ||
                                `Support ${siteName()} — donate to ${c().title}.`}
                            canonical={canonicalUrl()}
                            type="website"
                            image={c().featuredImage}
                            imageAlt={c().title}
                            aeoSummary={c().shortDescription ||
                                `${c().title} is a fundraising campaign from ${siteName()}.`}
                            aeoEntityType="DonateAction"
                            jsonLd={[
                                buildDonation({
                                    name: c().title,
                                    description: c().shortDescription,
                                    url: canonicalUrl(),
                                    image: c().featuredImage,
                                    goalAmount: c().goalAmountCents,
                                    raisedAmount: c().currentAmountCents,
                                    publisherName: siteName(),
                                },),
                                buildBreadcrumb({
                                    items: [
                                        { name: 'Home', url: window.location.origin, },
                                        { name: 'Donate', url: `${window.location.origin}/donate`, },
                                        { name: c().title, url: canonicalUrl(), },
                                    ],
                                },),
                            ]}
                        />

                        <A href="/donate" class="campaign-page__back">&larr; All Campaigns</A>

                        {/* Full campaign render — shared with the
                            `{{campaign('slug-or-id')}}` template function. Slug is
                            opt-in, so the page's own slug is hidden by default. */}
                        <CampaignDetail campaign={c()} />
                    </>
                )}
            </Show>
        </div>
    );
};

export default CampaignPage;
