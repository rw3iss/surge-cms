import { buildBlockTree, type Page, } from '@rw/cms-shared';
import { Component, createResource, For, Show, } from 'solid-js';
import { BlockRenderer, } from '../components/blocks/BlockRenderer';
import SeoHead from '../components/common/seo/SeoHead';
import { fetchHomepage, } from '../services/api';
import { siteDescription, siteLogo, siteName, } from '../stores/siteSettings';
import { buildOrganization, } from '../utils/schema';
import './Home.scss';

const Home: Component = () => {
    const canonicalUrl = window.location.origin;
    // The homepage is whichever page has `is_homepage=true`. Slugs are
    // free to be anything ("home", "welcome", etc.) — we don't query by
    // a fixed slug, so renaming the slug of the page-flagged-as-homepage
    // doesn't break the public root.
    const [page,] = createResource(async () => {
        const response = await fetchHomepage();
        return response.success ? response.data as Page : null;
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

            <Show
                when={page()}
                fallback={
                    page.loading ? (
                        <div class="home__loading">Loading...</div>
                    ) : (
                        // The resource has resolved to null — there is no
                        // homepage in the DB. New installs always seed one,
                        // but if it was deleted or the seeder was skipped,
                        // show a friendly empty state instead of a stuck
                        // loader so the operator knows what to do.
                        <div class="home__loading">
                            <h2>{siteName()}</h2>
                            <p>This site doesn't have a homepage yet.</p>
                            <p>
                                <a href="/admin/pages">Create one in the admin →</a>
                            </p>
                        </div>
                    )
                }
            >
                {(pageData,) => (
                    <>
                        <For each={buildBlockTree(pageData().blocks ?? [])}>
                            {(block,) => (
                                <Show when={block.isVisible}>
                                    <BlockRenderer block={block} />
                                </Show>
                            )}
                        </For>
                    </>
                )}
            </Show>
        </div>
    );
};

export default Home;
