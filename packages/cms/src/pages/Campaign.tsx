import { A, useParams, } from '@solidjs/router';
import type { Campaign, } from '@sitesurge/types';
import { Component, createResource, Show, } from 'solid-js';
import DonationForm from '../components/forms/donations/DonationForm';
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

    const progress = () => {
        const c = campaign();
        if (!c || !c.goalAmountCents) return 0;
        return Math.min((c.currentAmountCents / c.goalAmountCents) * 100, 100,);
    };

    const formatCurrency = (cents: number,) =>
        `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, },)}`;

    const formatDate = (d: string | Date | undefined,) => {
        if (!d) return null;
        return new Date(d,).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', },);
    };

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

                        {/* Hero / Featured Image */}
                        <Show when={c().featuredImage}>
                            <div class="campaign-page__hero">
                                <img src={c().featuredImage!} alt={c().title} />
                            </div>
                        </Show>

                        <div class="campaign-page__content">
                            <h1 class="campaign-page__title">{c().title}</h1>

                            <Show when={c().shortDescription}>
                                <p class="campaign-page__subtitle">{c().shortDescription}</p>
                            </Show>

                            {/* Progress Tracker */}
                            <div class="campaign-page__tracker">
                                <Show when={c().showRaisedAmount !== false}>
                                    <div class="campaign-page__tracker-header">
                                        <span class="campaign-page__tracker-raised">
                                            {formatCurrency(c().currentAmountCents,)}
                                        </span>
                                        <Show when={c().goalAmountCents}>
                                            <span class="campaign-page__tracker-goal">
                                                raised of {formatCurrency(c().goalAmountCents,)} goal
                                            </span>
                                        </Show>
                                        <Show when={!c().goalAmountCents}>
                                            <span class="campaign-page__tracker-goal">raised</span>
                                        </Show>
                                    </div>

                                    <Show when={c().goalAmountCents}>
                                        <div class="campaign-page__progress">
                                            <div
                                                class="campaign-page__progress-fill"
                                                style={{ width: `${progress()}%`, }}
                                            />
                                        </div>
                                        <div class="campaign-page__tracker-percent">
                                            {Math.round(progress(),)}% funded
                                        </div>
                                    </Show>
                                </Show>

                                <div class="campaign-page__tracker-stats">
                                    <Show when={c().showRaisedAmount !== false}>
                                        <div class="campaign-page__stat">
                                            <span class="campaign-page__stat-value">{c().donorCount || 0}</span>
                                            <span class="campaign-page__stat-label">
                                                {c().donorCount === 1 ? 'donor' : 'donors'}
                                            </span>
                                        </div>
                                    </Show>
                                    <Show when={(c() as any).startDate}>
                                        <div class="campaign-page__stat">
                                            <span class="campaign-page__stat-value">
                                                {formatDate((c() as any).startDate,)}
                                            </span>
                                            <span class="campaign-page__stat-label">started</span>
                                        </div>
                                    </Show>
                                    <Show when={(c() as any).endDate}>
                                        <div class="campaign-page__stat">
                                            <span class="campaign-page__stat-value">
                                                {formatDate((c() as any).endDate,)}
                                            </span>
                                            <span class="campaign-page__stat-label">ends</span>
                                        </div>
                                    </Show>
                                </div>
                            </div>

                            {/* Description */}
                            <div class="campaign-page__description rich-text" innerHTML={c().description} />

                            {/* Donation Form */}
                            <div class="campaign-page__donate">
                                <h2>Make a Donation</h2>
                                <DonationForm campaignId={c().id} />
                            </div>
                        </div>
                    </>
                )}
            </Show>
        </div>
    );
};

export default CampaignPage;
