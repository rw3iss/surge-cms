import { Link, Meta, Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import type { AppearanceSettings, Campaign, HeroCarouselSettings, Page, SocialPost, } from '@surge/shared';
import { Component, createResource, For, Show, Suspense, } from 'solid-js';
import { BlockRenderer, } from '../components/BlockRenderer';
import HeroCarousel from '../components/HeroCarousel';
import { JsonLd, } from '../components/JsonLd';
import SocialEmbed from '../components/SocialEmbed';
import { fetchAppearance, fetchCampaigns, fetchHeroSettings, fetchLiveSocialFeed, fetchPage, } from '../services/api';
import './Home.scss';

const Home: Component = () => {
    const canonicalUrl = window.location.origin;
    const [page,] = createResource(async () => {
        const response = await fetchPage('home',);
        return response.success ? response.data as Page : null;
    },);

    const [socialPosts,] = createResource(async () => {
        const response = await fetchLiveSocialFeed(6,);
        return response.success ? response.data as SocialPost[] : [];
    },);

    const [campaigns,] = createResource(async () => {
        const response = await fetchCampaigns(false,);
        return response.success ? response.data as Campaign[] : [];
    },);

    const [heroSettings,] = createResource(async () => {
        const response = await fetchHeroSettings();
        return response.success ? response.data as HeroCarouselSettings : null;
    },);

    const [appearance,] = createResource(async () => {
        const response = await fetchAppearance();
        return response.success ? response.data as AppearanceSettings : null;
    },);

    return (
        <div class="home">
            <Title>Surge Media - Independent Journalism</Title>
            <Meta name="description" content="Surge Media - Independent journalism for the people" />
            <Link rel="canonical" href={canonicalUrl} />
            <Meta property="og:title" content="Surge Media" />
            <Meta property="og:description" content="Independent journalism for the people" />
            <Meta property="og:type" content="website" />
            <Meta property="og:url" content={canonicalUrl} />
            <Meta name="twitter:card" content="summary_large_image" />
            <Meta name="twitter:title" content="Surge Media" />
            <Meta name="twitter:description" content="Independent journalism for the people" />
            <JsonLd
                data={{
                    '@context': 'https://schema.org',
                    '@type': 'NewsMediaOrganization',
                    'name': 'Surge Media',
                    'url': 'https://surgemedia.us',
                    'description': 'Philadelphia-based news organization',
                }}
            />

            {/* Hero Carousel */}
            <Show when={heroSettings()?.items?.length}>
                <HeroCarousel
                    items={heroSettings()!.items}
                    options={heroSettings()!.options}
                    gutterWidth={appearance()?.gutterWidth}
                />
            </Show>

            <Show when={page()} fallback={<div class="home__loading">Loading...</div>}>
                {(pageData,) => (
                    <>
                        <For each={pageData().blocks}>
                            {(block,) => (
                                <Show when={block.isVisible}>
                                    <BlockRenderer block={block} />
                                </Show>
                            )}
                        </For>
                    </>
                )}
            </Show>

            {/* Social Media Section - Embedded Content */}
            <Show when={socialPosts()?.length}>
                <section class="home__social">
                    <div class="container">
                        <h2 class="home__section-title">Follow Our Journey</h2>
                        <div class="home__social-grid">
                            <For each={socialPosts()}>
                                {(post,) => (
                                    <SocialEmbed
                                        platform={post.platform}
                                        externalId={post.externalId}
                                        mediaUrl={post.mediaUrl}
                                        content={post.content}
                                        thumbnailUrl={post.thumbnailUrl}
                                        authorName={post.authorName}
                                    />
                                )}
                            </For>
                        </div>
                    </div>
                </section>
            </Show>

            {/* Active Campaigns Section */}
            <Show when={campaigns()?.length}>
                <section class="home__campaigns">
                    <div class="container">
                        <h2 class="home__section-title">Support Our Work</h2>
                        <div class="home__campaigns-grid">
                            <For each={campaigns()?.slice(0, 3,)}>
                                {(campaign,) => (
                                    <A href={`/campaigns/${campaign.slug}`} class="home__campaign-card">
                                        <Show when={campaign.featuredImage}>
                                            <img
                                                src={campaign.featuredImage}
                                                alt={campaign.title}
                                                class="home__campaign-image"
                                                loading="lazy"
                                            />
                                        </Show>
                                        <div class="home__campaign-content">
                                            <h3 class="home__campaign-title">{campaign.title}</h3>
                                            <p class="home__campaign-desc">{campaign.shortDescription}</p>
                                            <div class="home__campaign-progress">
                                                <div
                                                    class="home__campaign-progress-bar"
                                                    style={{
                                                        width: `${
                                                            Math.min(
                                                                (campaign.currentAmountCents /
                                                                    campaign.goalAmountCents) * 100,
                                                                100,
                                                            )
                                                        }%`,
                                                    }}
                                                />
                                            </div>
                                            <div class="home__campaign-stats">
                                                <span>
                                                    ${(campaign.currentAmountCents / 100).toLocaleString()} raised
                                                </span>
                                                <span>of ${(campaign.goalAmountCents / 100).toLocaleString()}</span>
                                            </div>
                                        </div>
                                    </A>
                                )}
                            </For>
                        </div>
                        <div class="home__campaigns-cta">
                            <A href="/donate" class="home__btn">View All Campaigns</A>
                        </div>
                    </div>
                </section>
            </Show>
        </div>
    );
};

export default Home;
