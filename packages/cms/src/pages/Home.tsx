import { buildBlockTree, type Page, resolvePageTitle, } from '@sitesurge/types';
import { Component, createEffect, createResource, For, onCleanup, Show, } from 'solid-js';
import { BlockRenderer, } from '../components/blocks/BlockRenderer';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import { setActiveHeaderPosition, setActiveHeaderStyle, } from '../stores/headerStyle';
import { siteDescription, siteLogo, siteName, siteSeo, } from '../stores/siteSettings';
import { buildOrganization, } from '../utils/schema';
import './Home.scss';

const Home: Component = () => {
    const canonicalUrl = window.location.origin;
    // The homepage is whichever page has `is_homepage=true`. Slugs are
    // free to be anything ("home", "welcome", etc.) — we don't query by
    // a fixed slug, so renaming the slug of the page-flagged-as-homepage
    // doesn't break the public root.
    const [page,] = createResource(async () => {
        try {
            return await cms.pages.homepage() as Page;
        } catch {
            return null;
        }
    },);

    // Publish the homepage's chosen header style (explicit wins; otherwise
    // `null` → the site default page style). Clear on leaving the route.
    createEffect(() => {
        const p = page() as
            (Page & { headerStyle?: 'default' | 'alt'; headerPosition?: 'static' | 'float'; })
            | null
            | undefined;
        setActiveHeaderStyle(p?.headerStyle ?? null,);
        setActiveHeaderPosition(p?.headerPosition ?? null,);
    },);
    onCleanup(() => {
        setActiveHeaderStyle(null,);
        setActiveHeaderPosition(null,);
    },);

    /**
     * The homepage `<title>`, resolved the same way the SSR head resolves it:
     * the operator's `seo.homeTitle`, else the homepage page row's own
     * metaTitle/title, else the site name. `buildDocumentTitle` appends the
     * brand, so this is the page half only.
     */
    const homeTitle = () =>
        siteSeo().homeTitle
        || resolvePageTitle(page() as { metaTitle?: string; title?: string; } | null,)
        || siteName();

    return (
        <div class="home">
            <SeoHead
                // NOT the literal "Home". The homepage title is the site's most
                // valuable, and this route has no CMS entity to carry a
                // metaTitle — so it comes from Settings → SEO (`seo.homeTitle`),
                // exactly as the SSR head resolves it. Hardcoding "Home" here
                // overwrote the server's optimised title in the rendered DOM,
                // which is the title search engines actually index.
                title={homeTitle()}
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
