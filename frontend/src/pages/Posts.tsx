import { Link, Meta, Title, } from '@solidjs/meta';
import { A, useSearchParams, } from '@solidjs/router';
import type { Post, } from '@surge/shared';
import { Component, createResource, For, Show, } from 'solid-js';
import { fetchPosts, } from '../services/api';

const PostsPage: Component = () => {
    const [searchParams,] = useSearchParams();

    const [posts,] = createResource(
        () => ({ page: searchParams.page || '1', tag: searchParams.tag, category: searchParams.category, }),
        async (params,) => {
            const response = await fetchPosts({
                page: parseInt(params.page, 10,),
                tag: params.tag,
                category: params.category,
            },);
            return response.success ? response : null;
        },
    );

    return (
        <div class="posts-page container">
            <Title>Blog | Surge Media</Title>
            <Meta name="description" content="Latest posts and articles from Surge Media" />
            <Link rel="canonical" href={`${window.location.origin}/posts`} />
            <Meta property="og:title" content="Blog | Surge Media" />
            <Meta property="og:description" content="Latest posts and articles from Surge Media" />
            <Meta property="og:type" content="website" />
            <Meta property="og:url" content={`${window.location.origin}/posts`} />
            <Meta name="twitter:card" content="summary_large_image" />
            <Meta name="twitter:title" content="Blog | Surge Media" />
            <Meta name="twitter:description" content="Latest posts and articles from Surge Media" />
            <h1>Latest Posts</h1>

            <Show when={posts()?.data} fallback={<div>Loading...</div>}>
                <div class="posts-grid">
                    <For each={posts()?.data as Post[]}>
                        {(post,) => (
                            <A href={`/posts/${post.slug}`} class="post-card">
                                <Show when={post.featuredImage}>
                                    <img src={post.featuredImage} alt={post.title} />
                                </Show>
                                <h2>{post.title}</h2>
                                <p>{post.excerpt}</p>
                            </A>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
};

export default PostsPage;
