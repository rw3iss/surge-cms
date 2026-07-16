import { useParams, } from '@solidjs/router';
import { isAdminRole, type ContentAccessLevel, type Post, } from '@sitesurge/types';
import { ContentLockedError, } from '@sitesurge/client';
import { Component, createEffect, createResource, createSignal, For, onCleanup, Show, } from 'solid-js';
import ContentGate from '../components/auth/ContentGate';
import PostContentBlock from '../components/blocks/posts/PostContentBlock';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import { contentPaddingStyle, } from '../utils/appearanceStyle';
import { setActiveHeaderStyle, } from '../stores/headerStyle';
import { useAuth, } from '../stores/auth';
import { siteLogo, siteName, } from '../stores/siteSettings';
import { buildArticle, buildBreadcrumb, stripHtml, truncateText, } from '../utils/schema';
import './Post.scss';

interface LockedContent {
    accessLevel: ContentAccessLevel;
    preview: {
        title?: string;
        description?: string;
        featuredImage?: string;
    };
}

const PostPage: Component = () => {
    const params = useParams();
    const auth = useAuth();
    const canonicalUrl = () => `${window.location.origin}/posts/${params.slug}`;
    const [lockedContent, setLockedContent,] = createSignal<LockedContent | null>(null,);

    const isPreviewMode = () => {
        const searchParams = new URLSearchParams(window.location.search,);
        return searchParams.get('preview',) === 'admin';
    };

    /** Whether the current viewer should see drafts / non-published
     *  posts. Admins always do — the explicit `?preview=admin` URL is
     *  no longer required just to view your own draft. Public
     *  visitors never see drafts. */
    const isAdminViewer = () => isAdminRole(auth.user?.role,);
    const usePreview = () => isPreviewMode() || isAdminViewer();

    const [post,] = createResource(
        () => params.slug,
        async (slug,) => {
            setLockedContent(null,);
            const preview = (usePreview() && isAdminViewer()) ? 'admin' : undefined;
            try {
                return await cms.posts.getBySlug(slug, preview ? { preview, } : undefined,) as Post;
            } catch (e) {
                if (e instanceof ContentLockedError) {
                    // ContentLockedError.preview types fields as `string |
                    // null`; LockedContent uses `string | undefined`. Both
                    // are read only via truthy `<Show>` gates in ContentGate,
                    // so the cast is safe (null and undefined behave alike).
                    setLockedContent({
                        accessLevel: e.accessLevel as ContentAccessLevel,
                        preview: (e.preview ?? {}) as LockedContent['preview'],
                    },);
                }
                return null;
            }
        },
    );

    // Header style for posts: the post's own choice, else the site's
    // `defaultPostHeaderStyle`. Publish it to the Header via the global signal.
    const [headerCfg,] = createResource(async () => {
        try {
            return await cms.settings.getSiteHeader() as { defaultPostHeaderStyle?: 'default' | 'alt'; } | null;
        } catch {
            return null;
        }
    },);
    createEffect(() => {
        const p = post() as (Post & { headerStyle?: 'default' | 'alt'; }) | null | undefined;
        const explicit = p?.headerStyle;
        const fallback = headerCfg()?.defaultPostHeaderStyle === 'alt' ? 'alt' : 'default';
        setActiveHeaderStyle(
            explicit === 'alt' ? 'alt' : explicit === 'default' ? 'default' : fallback,
        );
    },);
    onCleanup(() => setActiveHeaderStyle('default',),);

    // Left/right gutter + top/bottom post-padding are each opt-in per post
    // (defaults on). Falls back to on/on while the post loads or 404s.
    const wrapperStyle = () => {
        const p = post() as (Post & { applyPostPadding?: boolean; applySiteGutter?: boolean; }) | null | undefined;
        return contentPaddingStyle('--site-post-padding', p?.applyPostPadding, p?.applySiteGutter,);
    };

    return (
        <div class="post-page page-wrapper" style={wrapperStyle()}>
            <Show when={lockedContent()}>
                {(locked,) => (
                    <ContentGate
                        accessLevel={locked().accessLevel}
                        preview={locked().preview}
                    />
                )}
            </Show>
            <Show when={!lockedContent()}>
                {/* Three states for the post resource:
                      1. Loading — fetch in flight, show spinner text.
                      2. Resolved with data — render the post.
                      3. Resolved with null — fetch returned 404 / error.
                         Without an explicit not-found state the UI fell
                         through to the loading fallback, which made
                         draft / mistyped slugs look like infinite
                         loaders. */}
                <Show when={!post.loading} fallback={<div class="post-page__loading">Loading…</div>}>
                    <Show when={post()} fallback={
                        <div class="post-page__not-found">
                            <h1>Post not found</h1>
                            <p>
                                The post you're looking for doesn't exist or hasn't been published yet.
                            </p>
                        </div>
                    }>
                        {(postData,) => {
                        const description = () =>
                            (postData() as any).metaDescription ||
                            postData().excerpt ||
                            truncateText(stripHtml(postData().content || '',), 200,) ||
                            `${postData().title} — published by ${siteName()}`;
                        const aeoSummary = () =>
                            truncateText(
                                stripHtml(postData().excerpt || postData().content || '',),
                                280,
                            );
                        const jsonLd = () => [
                            buildArticle({
                                headline: postData().title,
                                description: description(),
                                url: canonicalUrl(),
                                image: postData().featuredImage,
                                datePublished: postData().publishedAt || undefined,
                                dateModified: postData().updatedAt || undefined,
                                authorName: postData().author,
                                publisherName: siteName(),
                                publisherLogo: siteLogo() ||
                                    `${window.location.origin}/icons/icon-512x512.png`,
                                articleSection: (postData() as any).category,
                                keywords: (postData() as any).tags,
                            },),
                            buildBreadcrumb({
                                items: [
                                    { name: 'Home', url: window.location.origin, },
                                    { name: 'Posts', url: `${window.location.origin}/posts`, },
                                    { name: postData().title, url: canonicalUrl(), },
                                ],
                            },),
                        ];

                        return (
                        <>
                            <SeoHead
                                title={(postData() as any).metaTitle || postData().title}
                                description={description()}
                                canonical={canonicalUrl()}
                                type="article"
                                image={postData().featuredImage}
                                imageAlt={postData().title}
                                publishedAt={postData().publishedAt || undefined}
                                modifiedAt={postData().updatedAt || undefined}
                                author={postData().author}
                                section={(postData() as any).category}
                                tags={(postData() as any).tags}
                                keywords={(postData() as any).tags}
                                aeoSummary={aeoSummary()}
                                aeoEntityType="NewsArticle"
                                jsonLd={jsonLd()}
                            />

                            <article class="post-page__article">
                                <header class="page-header">
                                    <h1>{postData().title}</h1>
                                    <div class="post-page__meta">
                                        <span>By {postData().author}</span>
                                        <Show when={postData().publishedAt}>
                                            <span>{new Date(postData().publishedAt!,).toLocaleDateString()}</span>
                                        </Show>
                                    </div>
                                </header>

                                <Show when={postData().featuredImage}>
                                    <img
                                        src={postData().featuredImage}
                                        alt={postData().title}
                                        class="post-page__image"
                                    />
                                </Show>

                                {/* Render content blocks if present */}
                                <Show when={(postData() as any).contentBlocks?.length}>
                                    <div class="post-page__blocks">
                                        <For each={(postData() as any).contentBlocks}>
                                            {(block: any,) => <PostContentBlock block={block} />}
                                        </For>
                                    </div>
                                </Show>

                                {/* Fallback to legacy content field if no blocks */}
                                <Show when={!(postData() as any).contentBlocks?.length && postData().content}>
                                    <div class="rich-text" innerHTML={postData().content} />
                                </Show>
                            </article>
                        </>
                        );
                    }}
                    </Show>
                </Show>
            </Show>
        </div>
    );
};

export default PostPage;
