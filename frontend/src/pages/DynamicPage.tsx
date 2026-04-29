import { useLocation, useNavigate, useParams, } from '@solidjs/router';
import type { ContentAccessLevel, Page, } from '@rw/shared';
import { Component, createResource, createSignal, For, lazy, Show, } from 'solid-js';
import { BlockRenderer, } from '../components/BlockRenderer';
import ContentGate from '../components/ContentGate';
import SeoHead from '../components/SeoHead';
import { fetchPage, } from '../services/api';
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
            const preview = (isPreviewMode() && (auth.user?.role === 'admin' || auth.user?.role === 'sysadmin')) ? 'admin' : undefined;
            const response = await fetchPage(slug, preview,);
            if (!response.success) {
                // Check if this is a locked content response
                const raw = response as any;
                if (raw.locked) {
                    setLockedContent({
                        accessLevel: raw.accessLevel,
                        preview: raw.preview || {},
                    },);
                    return null;
                }
                if (response.error?.code === 'UNAUTHORIZED') {
                    navigate(`/login?return=/${slug}`,);
                    return null;
                }
                return null;
            }
            return response.data as Page;
        },
    );

    return (
        <div class="dynamic-page page-wrapper">
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

                                <For each={pageData().blocks}>
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
