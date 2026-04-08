import { A, } from '@solidjs/router';
import type { AppearanceSettings, HeroCarouselSettings, Page, SocialPost, } from '@surge/shared';
import { Component, createResource, For, Show, Suspense, } from 'solid-js';
import { BlockRenderer, } from '../components/BlockRenderer';
import HeroCarousel from '../components/HeroCarousel';
import SeoHead from '../components/SeoHead';
import SocialEmbed from '../components/SocialEmbed';
import { fetchAppearance, fetchHeroSettings, fetchLiveSocialFeed, fetchPage, } from '../services/api';
import { siteDescription, siteLogo, siteName, } from '../stores/siteSettings';
import { buildOrganization, } from '../utils/schema';
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
            <SeoHead
                title="Home"
                description={siteDescription()}
                canonical={canonicalUrl}
                type="website"
                image={siteLogo() || `${canonicalUrl}/icons/icon-512x512.png`}
                aeoSummary={`${siteName()} — ${siteDescription()}. Independent journalism, investigative reporting, and community stories.`}
                aeoEntityType="NewsMediaOrganization"
                jsonLd={buildOrganization({
                    name: siteName(),
                    url: canonicalUrl,
                    logo: siteLogo() || `${canonicalUrl}/icons/icon-512x512.png`,
                },)}
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

        </div>
    );
};

export default Home;
