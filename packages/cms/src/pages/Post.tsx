import { useParams, } from '@solidjs/router';
import { getPostType, isAdminRole, resolveBannerHeight, resolveBannerPosition, type Post, featuredImageAlt, featuredImagePath, } from '@sitesurge/types';
import { Component, createEffect, createResource, For, Match, onCleanup, Show, Switch, } from 'solid-js';
import PostVisibilityBadge from '../components/content/PostVisibilityBadge';
import PostTypeBadge from '../components/content/PostTypeBadge';
import LiveShow from '../components/live/LiveShow';
import UpgradeTout from '../components/content/UpgradeTout';
import PostContentBlock from '../components/blocks/posts/PostContentBlock';
import TemplatedContent from '../components/blocks/TemplatedContent';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import { contentPaddingStyle, } from '../utils/appearanceStyle';
import { setActiveHeaderPosition, setActiveHeaderStyle, } from '../stores/headerStyle';
import { useAuth, } from '../stores/auth';
import { siteLogo, siteName, } from '../stores/siteSettings';
import { buildArticle, buildBreadcrumb, stripHtml, truncateText, } from '../utils/schema';
import './Post.scss';

const PostPage: Component = () => {
    const params = useParams();
    const auth = useAuth();
    const canonicalUrl = () => `${window.location.origin}/posts/${params.slug}`;

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

    // Keyed on the signed-in user too: a post's body is shaped per viewer
    // (subscription gating), so logging in — e.g. from the upgrade prompt's
    // modal — refetches and unlocks the post in place.
    const [post,] = createResource(
        () => ({ slug: params.slug, viewer: auth.user?.id ?? null, }),
        async ({ slug, },) => {
            const preview = (usePreview() && isAdminViewer()) ? 'admin' : undefined;
            try {
                return await cms.posts.getBySlug(slug!, preview ? { preview, } : undefined,) as Post;
            } catch {
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
        const p = post() as
            (Post & { headerStyle?: 'default' | 'alt'; headerPosition?: 'static' | 'float'; })
            | null
            | undefined;
        // Post's own style wins; else the site's default post style; else
        // `null` (→ the site default page style, via the Header).
        setActiveHeaderStyle(p?.headerStyle ?? headerCfg()?.defaultPostHeaderStyle ?? null,);
        // Header position: post's own, else null → site default (via Header).
        setActiveHeaderPosition(p?.headerPosition ?? null,);
    },);
    onCleanup(() => {
        setActiveHeaderStyle(null,);
        setActiveHeaderPosition(null,);
    },);

    // Left/right gutter + top/bottom post-padding are each opt-in per post
    // (defaults on). Falls back to on/on while the post loads or 404s.
    const wrapperStyle = () => {
        const p = post() as (Post & { applyPostPadding?: boolean; applySiteGutter?: boolean; }) | null | undefined;
        return contentPaddingStyle('--site-post-padding', p?.applyPostPadding, p?.applySiteGutter,);
    };

    return (
        <div class="post-page page-wrapper" style={wrapperStyle()}>
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
                                image: featuredImagePath(postData()),
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

                        // Banner layout: how the featured image + title/meta
                        // header renders. Only meaningful with a banner image.
                        const bannerLayout = () =>
                            ((postData() as any).bannerLayout as 'hero' | 'hero-full' | 'standalone' | 'thumbnail')
                            || 'standalone';
                        const hasBanner = () => !!featuredImagePath(postData());
                        // Vertical anchor of the banner image (start=top, end=bottom).
                        // Applied as background-position (hero) / object-position (img).
                        const bannerPos = () =>
                            resolveBannerPosition(postData().bannerImagePosition, postData().bannerImagePositionCustom,);
                        // Per-post banner height, handed to every layout as a CSS
                        // variable; each layout's stylesheet falls back to its own
                        // default when it is unset (see Post.scss).
                        const bannerHeightVar = () => {
                            const h = resolveBannerHeight(postData().bannerHeight,);
                            return h ? { '--post-banner-height': h, } : {};
                        };
                        // Expose the current post to `{{post.*}}` in its blocks.
                        const postCtx = () => ({
                            post: { kind: 'post', data: postData() as unknown as Record<string, unknown>, id: postData().id },
                        });
                        const isLocked = () => postData().gate?.state === 'locked';
                        // Live posts render the live show in place of the content
                        // blocks (unless the viewer's tier is locked out).
                        const isLive = () => getPostType(postData().postType,).display === 'live';
                        const heading = () => (
                            <>
                                <a class="post-page__back" href="/posts">← Back to Posts</a>
                                <h1 class="post-page__title">
                                    {postData().title}
                                    <PostTypeBadge type={postData().postType} ended={!!postData().liveEndedAt} />
                                    <PostVisibilityBadge gate={postData().gate} />
                                </h1>
                                <div class="post-page__meta">
                                    {/* Only show the byline when an author is actually set. */}
                                    <Show when={postData().author}>
                                        <span>By {postData().author}</span>
                                    </Show>
                                    <Show when={postData().publishedAt}>
                                        <span>{new Date(postData().publishedAt!,).toLocaleDateString()}</span>
                                    </Show>
                                    {/* Photo credit, pushed to the right end of the row. Only
                                        when the post opts in AND its banner's media item has
                                        credits (Admin → Media). */}
                                    <Show when={postData().showPhotoCredits && postData().featuredMedia?.credits?.trim()}>
                                        <span class="post-page__credits">
                                            {postData().featuredMedia!.credits}
                                        </span>
                                    </Show>
                                </div>
                            </>
                        );

                        return (
                        <>
                            <SeoHead
                                title={(postData() as any).metaTitle || postData().title}
                                description={description()}
                                canonical={canonicalUrl()}
                                type="article"
                                image={featuredImagePath(postData())}
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

                            <article class={`post-page__article post-page__article--${bannerLayout()}`}>
                                <Switch>
                                    {/* Hero: full-width banner with title/meta overlaid (white text). */}
                                    <Match when={hasBanner() && bannerLayout() === 'hero'}>
                                        <header
                                            class="post-page__hero"
                                            style={{
                                                'background-image': `url("${featuredImagePath(postData())}")`,
                                                'background-position': bannerPos(),
                                                ...bannerHeightVar(),
                                            }}
                                        >
                                            <div class="post-page__hero-overlay">
                                                {heading()}
                                            </div>
                                        </header>
                                    </Match>
                                    {/* Hero Full: banner background spans the entire page width
                                        (breaks out of the content column) while the title/meta
                                        stay in the centered, padded content column. */}
                                    <Match when={hasBanner() && bannerLayout() === 'hero-full'}>
                                        <header
                                            class="post-page__hero post-page__hero--full"
                                            style={{
                                                // Painted by the full-bleed ::after (see Post.scss).
                                                '--hero-image': `url("${featuredImagePath(postData())}")`,
                                                '--hero-position': bannerPos(),
                                                ...bannerHeightVar(),
                                            }}
                                        >
                                            <div class="post-page__hero-overlay post-page__hero-overlay--full">
                                                {heading()}
                                            </div>
                                        </header>
                                    </Match>
                                    {/* Thumbnail: small image beside the title/meta, single-row header. */}
                                    <Match when={hasBanner() && bannerLayout() === 'thumbnail'}>
                                        <header class="page-header post-page__header--thumb">
                                            <img
                                                src={featuredImagePath(postData())}
                                                alt={featuredImageAlt(postData(), postData().title,)}
                                                class="post-page__thumb"
                                                style={{ 'object-position': bannerPos(), ...bannerHeightVar(), }}
                                            />
                                            <div class="post-page__header-text">
                                                {heading()}
                                            </div>
                                        </header>
                                    </Match>
                                    {/* Standalone (default) + no-banner: title/meta on top, image below. */}
                                    <Match when={true}>
                                        <header class="page-header">
                                            {heading()}
                                        </header>
                                        <Show when={hasBanner()}>
                                            <img
                                                src={featuredImagePath(postData())}
                                                alt={featuredImageAlt(postData(), postData().title,)}
                                                class="post-page__image"
                                                style={{ 'object-position': bannerPos(), ...bannerHeightVar(), }}
                                            />
                                        </Show>
                                    </Match>
                                </Switch>

                                <Show when={isLive() && !isLocked()}>
                                    <LiveShow post={postData()} />
                                </Show>

                                <Show when={!isLive()}>
                                    {/* Render content blocks if present. For a viewer without the
                                        post's subscription tier these are only the SAMPLE blocks
                                        (or none) — the server never sends the rest. */}
                                    <Show when={(postData() as any).contentBlocks?.length}>
                                        <div class={`post-page__blocks${isLocked() && postData().gate?.sample ? ' gated-sample' : ''}`}>
                                            <For each={(postData() as any).contentBlocks}>
                                                {(block: any,) => <PostContentBlock block={block} templateContext={postCtx()} />}
                                            </For>
                                        </div>
                                    </Show>

                                    {/* Fallback to legacy content field if no blocks */}
                                    <Show when={!(postData() as any).contentBlocks?.length && postData().content}>
                                        <TemplatedContent class="rich-text" html={postData().content} entities={postCtx()} />
                                    </Show>
                                </Show>

                                <Show when={isLocked()}>
                                    <UpgradeTout
                                        requiredTier={postData().gate?.requiredTier}
                                        variant={postData().gate?.sample ? 'continue' : 'locked'}
                                    />
                                </Show>

                                {/* Footer nav row after the article body:
                                    "Back to Posts" on the left, "Back to top" on the right. */}
                                <div class="post-page__footer-nav">
                                    <a class="post-page__footer-btn" href="/posts">
                                        ← Back to Posts
                                    </a>
                                    <button
                                        type="button"
                                        class="post-page__footer-btn"
                                        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth', },)}
                                    >
                                        ↑ Back to top
                                    </button>
                                </div>
                            </article>
                        </>
                        );
                    }}
                    </Show>
                </Show>
        </div>
    );
};

export default PostPage;
