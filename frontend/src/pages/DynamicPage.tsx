import { Link, Meta, Title, } from '@solidjs/meta';
import { useNavigate, useParams, } from '@solidjs/router';
import type { ContentAccessLevel, Page, } from '@surge/shared';
import { Component, createResource, createSignal, For, lazy, Show, } from 'solid-js';
import { BlockRenderer, } from '../components/BlockRenderer';
import ContentGate from '../components/ContentGate';
import { fetchPage, } from '../services/api';
import { useAuth, } from '../stores/auth';

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
    const navigate = useNavigate();
    const auth = useAuth();
    const canonicalUrl = () => `${window.location.origin}/${params.slug}`;
    const [lockedContent, setLockedContent,] = createSignal<LockedContent | null>(null,);

    const isPreviewMode = () => {
        const searchParams = new URLSearchParams(window.location.search,);
        return searchParams.get('preview',) === 'admin';
    };

    const [page,] = createResource(
        () => params.slug,
        async (slug,) => {
            setLockedContent(null,);
            const preview = (isPreviewMode() && auth.user?.role === 'admin') ? 'admin' : undefined;
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
        <div class="dynamic-page">
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
                        const ogDesc = () => pageData().metaDescription || pageData().description || '';
                        return (
                            <>
                                <Title>{ogTitle()} - Surge Media</Title>
                                <Meta name="description" content={ogDesc()} />
                                <Link rel="canonical" href={canonicalUrl()} />
                                <Meta property="og:title" content={ogTitle()} />
                                <Meta property="og:description" content={ogDesc()} />
                                <Meta property="og:type" content="website" />
                                <Meta property="og:url" content={canonicalUrl()} />
                                {pageData().ogImage && <Meta property="og:image" content={pageData().ogImage!} />}
                                <Meta name="twitter:card" content="summary_large_image" />
                                <Meta name="twitter:title" content={ogTitle()} />
                                <Meta name="twitter:description" content={ogDesc()} />
                                {pageData().ogImage && <Meta name="twitter:image" content={pageData().ogImage!} />}

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
