import { useParams, } from '@solidjs/router';
import type { ContentAccessLevel, Post, } from '@surge/shared';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import ContentGate from '../components/ContentGate';
import PostContentBlock from '../components/PostContentBlock';
import SeoHead from '../components/SeoHead';
import { fetchPost, } from '../services/api';
import { useAuth, } from '../stores/auth';
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

    const [post,] = createResource(
        () => params.slug,
        async (slug,) => {
            setLockedContent(null,);
            const preview = (isPreviewMode() && (auth.user?.role === 'admin' || auth.user?.role === 'sysadmin')) ? 'admin' : undefined;
            const response = await fetchPost(slug, preview,);
            if (!response.success) {
                const raw = response as any;
                if (raw.locked) {
                    setLockedContent({
                        accessLevel: raw.accessLevel,
                        preview: raw.preview || {},
                    },);
                    return null;
                }
                return null;
            }
            return response.data as Post;
        },
    );

    return (
        <div class="post-page page-wrapper">
            <Show when={lockedContent()}>
                {(locked,) => (
                    <ContentGate
                        accessLevel={locked().accessLevel}
                        preview={locked().preview}
                    />
                )}
            </Show>
            <Show when={!lockedContent()}>
                <Show when={post()} fallback={<div>Loading...</div>}>
                    {(postData,) => {
                        const description = () =>
                            postData().excerpt ||
                            truncateText(stripHtml(postData().content || '',), 200,);
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
                                publisherName: 'Surge Media',
                                publisherLogo: `${window.location.origin}/icons/icon-512x512.png`,
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
                                title={postData().title}
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
        </div>
    );
};

export default PostPage;
