import { useLocation, useNavigate, useParams, } from '@solidjs/router';
import { buildBlockTree, isAdminRole, type ContentAccessLevel, type Page, } from '@sitesurge/types';
import { ContentLockedError, UnauthorizedError, } from '@sitesurge/client';
import { Component, createEffect, createResource, createSignal, For, lazy, onCleanup, Show, } from 'solid-js';
import { BlockRenderer, } from '../components/blocks/BlockRenderer';
import ContentGate from '../components/auth/ContentGate';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import { contentPaddingStyle, } from '../utils/appearanceStyle';
import { setActiveHeaderStyle, } from '../stores/headerStyle';
import { useAuth, } from '../stores/auth';
import { siteName, } from '../stores/siteSettings';
import { buildBreadcrumb, buildWebPage, stripHtml, truncateText, } from '../utils/schema';
import './DynamicPage.scss';

const NotFoundPage = lazy(() => import('./NotFound'));

interface LockedContent {
    accessLevel: ContentAccessLevel;
    preview: {
        title?: string;
        description?: string;
        featuredImage?: string;
    };
}

const DynamicPage: Component = () => {
    const params = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const auth = useAuth();
    const slug = () => params.slug || location.pathname.replace(/^\//, '',);
    const canonicalUrl = () => `${window.location.origin}/${slug()}`;
    const [lockedContent, setLockedContent,] = createSignal<LockedContent | null>(null,);

    const isPreviewMode = () => {
        const searchParams = new URLSearchParams(window.location.search,);
        return searchParams.get('preview',) === 'admin';
    };

    const [page,] = createResource(
        slug,
        async (slug,) => {
            setLockedContent(null,);
            const preview = (isPreviewMode() && isAdminRole(auth.user?.role,)) ? 'admin' : undefined;
            try {
                return await cms.pages.getBySlug(slug, preview ? { preview, } : undefined,) as Page;
            } catch (e) {
                // Gated content now arrives as a ContentLockedError carrying
                // the preview shape (same as the post detail route).
                if (e instanceof ContentLockedError) {
                    setLockedContent({
                        accessLevel: e.accessLevel as ContentAccessLevel,
                        preview: (e.preview ?? {}) as LockedContent['preview'],
                    },);
                    return null;
                }
                if (e instanceof UnauthorizedError) {
                    navigate(`/login?return=/${slug}`,);
                    return null;
                }
                return null;
            }
        },
    );

    // Publish this page's chosen header style to the global signal the
    // Layout's Header reads. Reset to 'default' when leaving the route.
    createEffect(() => {
        const p = page() as (Page & { headerStyle?: 'default' | 'alt'; }) | null | undefined;
        setActiveHeaderStyle(p?.headerStyle === 'alt' ? 'alt' : 'default',);
    },);
    onCleanup(() => setActiveHeaderStyle('default',),);

    // Left/right gutter + top/bottom page-padding are each opt-in per page
    // (defaults on). Falls back to on/on while the page loads or 404s.
    const wrapperStyle = () => {
        const p = page() as (Page & { applyPagePadding?: boolean; applySiteGutter?: boolean; }) | null | undefined;
        return contentPaddingStyle('--site-page-padding', p?.applyPagePadding, p?.applySiteGutter,);
    };

    return (
        <div class="dynamic-page page-wrapper" style={wrapperStyle()}>
            <Show when={lockedContent()}>
                {(locked,) => (
                    <ContentGate
                        accessLevel={locked().accessLevel}
                        preview={locked().preview}
                    />
                )}
            </Show>
            <Show when={!lockedContent()}>
                <Show
                    when={page()}
                    fallback={
                        <Show when={page.loading} fallback={<NotFoundPage />}>
                            <div>Loading...</div>
                        </Show>
                    }
                >
                    {(pageData,) => {
                        const ogTitle = () => pageData().metaTitle || pageData().title;
                        const ogDesc = () =>
                            pageData().metaDescription ||
                            pageData().description ||
                            `${pageData().title} — ${siteName()}`;
                        const aeoSummary = () => truncateText(stripHtml(ogDesc(),), 280,);
                        const jsonLd = () => [
                            buildWebPage({
                                name: ogTitle(),
                                description: ogDesc(),
                                url: canonicalUrl(),
                                publisherName: siteName(),
                            },),
                            buildBreadcrumb({
                                items: [
                                    { name: 'Home', url: window.location.origin, },
                                    { name: pageData().title, url: canonicalUrl(), },
                                ],
                            },),
                        ];
                        return (
                            <>
                                <SeoHead
                                    title={ogTitle()}
                                    description={ogDesc()}
                                    canonical={canonicalUrl()}
                                    type="website"
                                    image={pageData().ogImage}
                                    imageAlt={pageData().title}
                                    modifiedAt={(pageData() as any).updatedAt}
                                    keywords={(pageData() as any).metaKeywords}
                                    aeoSummary={aeoSummary() || undefined}
                                    aeoEntityType="WebPage"
                                    jsonLd={jsonLd()}
                                />

                                {/* Auto-printed page title. Gated on
                                    the per-page `showTitle` flag (set
                                    from the editor; defaults to true
                                    for legacy rows where the column is
                                    missing). When false, the operator
                                    has chosen to let their first block
                                    be the headline. */}
                                <Show when={pageData().title && (pageData() as any).showTitle !== false}>
                                    <h1
                                        class="dynamic-page__title"
                                        style={{ 'text-align': (pageData() as any).titleAlignment || 'left', }}
                                    >
                                        {pageData().title}
                                    </h1>
                                </Show>

                                <For each={buildBlockTree(pageData().blocks ?? [])}>
                                    {(block,) => (
                                        <Show when={block.isVisible}>
                                            <BlockRenderer block={block} />
                                        </Show>
                                    )}
                                </For>
                            </>
                        );
                    }}
                </Show>
            </Show>
        </div>
    );
};

export default DynamicPage;
