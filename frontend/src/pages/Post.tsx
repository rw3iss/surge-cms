import { Link, Meta, Title, } from '@solidjs/meta';
import { useParams, } from '@solidjs/router';
import type { ContentAccessLevel, Post, } from '@surge/shared';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import ContentGate from '../components/ContentGate';
import { JsonLd, } from '../components/JsonLd';
import PostContentBlock from '../components/PostContentBlock';
import { fetchPost, } from '../services/api';
import { useAuth, } from '../stores/auth';
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
            const preview = (isPreviewMode() && auth.user?.role === 'admin') ? 'admin' : undefined;
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
        <div class="post-page container">
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
                    {(postData,) => (
                        <>
                            <Title>{postData().title} - Surge Media</Title>
                            <Meta name="description" content={postData().excerpt || ''} />
                            <Link rel="canonical" href={canonicalUrl()} />
                            <Meta property="og:title" content={postData().title} />
                            <Meta property="og:description" content={postData().excerpt || ''} />
                            <Meta property="og:type" content="article" />
                            <Meta property="og:url" content={canonicalUrl()} />
                            {postData().featuredImage && (
                                <Meta property="og:image" content={postData().featuredImage!} />
                            )}
                            {postData().publishedAt && (
                                <Meta
                                    property="article:published_time"
                                    content={new Date(postData().publishedAt!,).toISOString()}
                                />
                            )}
                            <Meta property="article:author" content={postData().author} />
                            <Meta name="twitter:card" content="summary_large_image" />
                            <Meta name="twitter:title" content={postData().title} />
                            <Meta name="twitter:description" content={postData().excerpt || ''} />
                            {postData().featuredImage && (
                                <Meta name="twitter:image" content={postData().featuredImage!} />
                            )}
                            <JsonLd
                                data={{
                                    '@context': 'https://schema.org',
                                    '@type': 'NewsArticle',
                                    'headline': postData().title,
                                    'description': postData().excerpt || '',
                                    'url': canonicalUrl(),
                                    'datePublished': postData().publishedAt ?
                                        new Date(postData().publishedAt!,).toISOString() :
                                        undefined,
                                    'dateModified': postData().updatedAt ?
                                        new Date(postData().updatedAt,).toISOString() :
                                        undefined,
                                    'author': {
                                        '@type': 'Person',
                                        'name': postData().author,
                                    },
                                    'publisher': {
                                        '@type': 'NewsMediaOrganization',
                                        'name': 'Surge Media',
                                        'url': 'https://surgemedia.us',
                                    },
                                    ...(postData().featuredImage ? { 'image': postData().featuredImage, } : {}),
                                }}
                            />

                            <article class="post-page__article">
                                <header class="post-page__header">
                                    <h1 class="post-page__title">{postData().title}</h1>
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
                    )}
                </Show>
            </Show>
        </div>
    );
};

export default PostPage;
