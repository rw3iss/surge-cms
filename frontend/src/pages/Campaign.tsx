import { Link, Meta, Title, } from '@solidjs/meta';
import { useParams, } from '@solidjs/router';
import type { Campaign, } from '@surge/shared';
import { Component, createResource, Show, } from 'solid-js';
import DonationForm from '../components/DonationForm';
import { JsonLd, } from '../components/JsonLd';
import { fetchCampaign, } from '../services/api';

const CampaignPage: Component = () => {
    const params = useParams();
    const canonicalUrl = () => `${window.location.origin}/campaigns/${params.slug}`;

    const [campaign,] = createResource(() => params.slug, async (slug,) => {
        const response = await fetchCampaign(slug,);
        return response.success ? response.data as Campaign : null;
    },);

    return (
        <div class="campaign-page container">
            <Show when={campaign()} fallback={<div>Loading...</div>}>
                {(c,) => (
                    <>
                        <Title>{c().title} - Surge Media</Title>
                        <Link rel="canonical" href={canonicalUrl()} />
                        <Meta property="og:title" content={c().title} />
                        <Meta property="og:description" content={c().shortDescription || ''} />
                        <Meta property="og:type" content="website" />
                        <Meta property="og:url" content={canonicalUrl()} />
                        {c().featuredImage && <Meta property="og:image" content={c().featuredImage!} />}
                        <Meta name="twitter:card" content="summary_large_image" />
                        <Meta name="twitter:title" content={c().title} />
                        <Meta name="twitter:description" content={c().shortDescription || ''} />
                        {c().featuredImage && <Meta name="twitter:image" content={c().featuredImage!} />}
                        <JsonLd
                            data={{
                                '@context': 'https://schema.org',
                                '@type': 'DonateAction',
                                'name': c().title,
                                'description': c().shortDescription || '',
                                'url': canonicalUrl(),
                                'recipient': {
                                    '@type': 'NewsMediaOrganization',
                                    'name': 'Surge Media',
                                    'url': 'https://surgemedia.us',
                                },
                                'price': {
                                    '@type': 'MonetaryAmount',
                                    'currency': 'USD',
                                    'value': (c().goalAmountCents / 100).toFixed(2,),
                                },
                                ...(c().featuredImage ? { 'image': c().featuredImage, } : {}),
                            }}
                        />
                        <h1>{c().title}</h1>
                        <div innerHTML={c().description} />
                        <div class="campaign-progress">
                            <div
                                style={{
                                    width: `${Math.min((c().currentAmountCents / c().goalAmountCents) * 100, 100,)}%`,
                                }}
                            />
                        </div>
                        <p>
                            ${(c().currentAmountCents / 100).toLocaleString()}{' '}
                            raised of ${(c().goalAmountCents / 100).toLocaleString()}
                        </p>
                        <DonationForm campaignId={c().id} />
                    </>
                )}
            </Show>
        </div>
    );
};

export default CampaignPage;
