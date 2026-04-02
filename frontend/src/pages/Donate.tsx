import { Link, Meta, Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import type { Campaign, } from '@surge/shared';
import { Component, createResource, For, Show, } from 'solid-js';
import { fetchCampaigns, } from '../services/api';
import './Donate.scss';

const DonatePage: Component = () => {
    const [campaigns,] = createResource(async () => {
        const response = await fetchCampaigns(true,);
        return response.success ? response.data as Campaign[] : [];
    },);

    const activeCampaigns = () => campaigns()?.filter(c => c.status === 'active') || [];
    const pastCampaigns = () => campaigns()?.filter(c => c.status === 'completed') || [];

    return (
        <div class="donate-page page-wrapper">
            <Title>Donate | Surge Media</Title>
            <Meta name="description" content="Support our independent journalism with a donation" />
            <Link rel="canonical" href={`${window.location.origin}/donate`} />
            <Meta property="og:title" content="Donate | Surge Media" />
            <Meta property="og:description" content="Support our independent journalism with a donation" />
            <Meta property="og:type" content="website" />
            <Meta property="og:url" content={`${window.location.origin}/donate`} />
            <Meta name="twitter:card" content="summary_large_image" />
            <Meta name="twitter:title" content="Donate | Surge Media" />
            <Meta name="twitter:description" content="Support our independent journalism with a donation" />

            <header class="page-header">
                <h1>Support Our Mission</h1>
                <p>Your donations help us continue our independent journalism.</p>
            </header>

            <section class="donate-page__section">
                <h2>Active Campaigns</h2>
                <Show when={activeCampaigns().length} fallback={<p>No active campaigns at this time.</p>}>
                    <div class="donate-page__grid">
                        <For each={activeCampaigns()}>
                            {(campaign,) => (
                                <A href={`/campaigns/${campaign.slug}`} class="donate-page__card">
                                    <Show when={campaign.featuredImage}>
                                        <img src={campaign.featuredImage} alt={campaign.title} />
                                    </Show>
                                    <div class="donate-page__card-content">
                                        <h3>{campaign.title}</h3>
                                        <p>{campaign.shortDescription}</p>
                                        <div class="donate-page__progress">
                                            <div
                                                class="donate-page__progress-bar"
                                                style={{
                                                    width: `${
                                                        Math.min(
                                                            (campaign.currentAmountCents / campaign.goalAmountCents) *
                                                                100,
                                                            100,
                                                        )
                                                    }%`,
                                                }}
                                            />
                                        </div>
                                        <span>
                                            ${(campaign.currentAmountCents / 100).toLocaleString()}{' '}
                                            raised of ${(campaign.goalAmountCents / 100).toLocaleString()}
                                        </span>
                                    </div>
                                </A>
                            )}
                        </For>
                    </div>
                </Show>
            </section>

            <Show when={pastCampaigns().length}>
                <section class="donate-page__section">
                    <h2>Past Campaigns</h2>
                    <div class="donate-page__grid">
                        <For each={pastCampaigns()}>
                            {(campaign,) => (
                                <A
                                    href={`/campaigns/${campaign.slug}`}
                                    class="donate-page__card donate-page__card--past"
                                >
                                    <h3>{campaign.title}</h3>
                                    <span>
                                        Completed - ${(campaign.currentAmountCents / 100).toLocaleString()} raised
                                    </span>
                                </A>
                            )}
                        </For>
                    </div>
                </section>
            </Show>
        </div>
    );
};

export default DonatePage;
