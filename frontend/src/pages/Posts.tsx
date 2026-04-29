import { A, useSearchParams, } from '@solidjs/router';
import type { Post, } from '@rw/shared';
import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import SeoHead from '../components/SeoHead';
import { siteName, } from '../stores/siteSettings';
import { fetchPosts, } from '../services/api';
import { buildCollectionPage, } from '../utils/schema';
import './Posts.scss';

const PAGE_SIZE = 12;

const PostsPage: Component = () => {
    const [searchParams,] = useSearchParams();
    const [posts, setPosts,] = createSignal<Post[]>([],);
    const [total, setTotal,] = createSignal(0,);
    const [page, setPage,] = createSignal(1,);
    const [loading, setLoading,] = createSignal(true,);
    const [loadingMore, setLoadingMore,] = createSignal(false,);

    const hasMore = () => posts().length < total();

    const loadPosts = async (pageNum: number, append = false,) => {
        if (append) setLoadingMore(true,);
        else setLoading(true,);

        try {
            const response = await fetchPosts({
                page: pageNum,
                limit: PAGE_SIZE,
                tag: searchParams.tag,
                category: searchParams.category,
            },);

            if (response.success) {
                const data = (response as any).data as Post[] || [];
                const meta = (response as any).meta || {};
                if (append) {
                    setPosts(prev => [...prev, ...data,],);
                } else {
                    setPosts(data,);
                }
                setTotal(meta.total || 0,);
                setPage(pageNum,);
            }
        } finally {
            setLoading(false,);
            setLoadingMore(false,);
        }
    };

    onMount(() => loadPosts(1,),);

    const handleLoadMore = () => {
        loadPosts(page() + 1, true,);
    };

    const formatDate = (dateStr: string | Date | undefined,) => {
        if (!dateStr) return '';
        return new Date(dateStr,).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        },);
    };

    return (
        <div class="posts-page">
            <SeoHead
                title="Blog"
                description={`Latest news, stories, and investigative reporting from ${siteName()}.`}
                canonical={`${window.location.origin}/posts`}
                type="website"
                aeoSummary={`Browse the latest blog posts, news articles, and reporting from ${siteName()}.`}
                aeoEntityType="Blog"
                jsonLd={buildCollectionPage({
                    name: 'Blog',
                    description: `Latest news and articles from ${siteName()}`,
                    url: `${window.location.origin}/posts`,
                    itemCount: total(),
                },)}
            />

            <div class="page-header" style={{ display: 'flex', 'align-items': 'baseline', gap: '12px', }}>
                <h1>Latest Posts</h1>
                <Show when={total() > 0}>
                    <span style={{ 'font-size': '0.85rem', color: '#888', 'font-weight': '400', }}>{total()} {total() === 1 ? 'post' : 'posts'}</span>
                </Show>
            </div>

            <Show when={!loading()} fallback={<div class="posts-page__loading">Loading posts...</div>}>
                <Show when={posts().length > 0} fallback={<div class="posts-page__empty">No posts yet. Check back soon!</div>}>
                    <div class="posts-page__list">
                        <For each={posts()}>
                            {(post,) => (
                                <A href={`/posts/${post.slug}`} class="post-card">
                                    <Show when={post.featuredImage}>
                                        <div class="post-card__image">
                                            <img src={post.featuredImage} alt={post.title} loading="lazy" />
                                        </div>
                                    </Show>
                                    <div class="post-card__body">
                                        <h2 class="post-card__title">{post.title}</h2>
                                        <Show when={post.excerpt}>
                                            <p class="post-card__excerpt">{post.excerpt}</p>
                                        </Show>
                                        <div class="post-card__meta">
                                            <Show when={post.publishedAt}>
                                                <span class="post-card__date">
                                                    {formatDate(post.publishedAt,)}
                                                </span>
                                            </Show>
                                            <Show when={post.updatedAt && post.publishedAt && new Date(post.updatedAt,).getTime() - new Date(post.publishedAt,).getTime() > 86400000}>
                                                <span class="post-card__updated">
                                                    Updated {formatDate(post.updatedAt,)}
                                                </span>
                                            </Show>
                                            <Show when={post.author}>
                                                <span class="post-card__author">By {post.author}</span>
                                            </Show>
                                        </div>
                                        <Show when={post.tags?.length}>
                                            <div class="post-card__tags">
                                                <For each={post.tags}>
                                                    {(tag,) => <span class="post-card__tag">{tag}</span>}
                                                </For>
                                            </div>
                                        </Show>
                                    </div>
                                </A>
                            )}
                        </For>
                    </div>

                    <Show when={hasMore()}>
                        <div class="posts-page__load-more">
                            <button
                                class="btn btn--secondary"
                                onClick={handleLoadMore}
                                disabled={loadingMore()}
                            >
                                {loadingMore() ? 'Loading...' : 'Load More'}
                            </button>
                        </div>
                    </Show>
                </Show>
            </Show>
        </div>
    );
};

export default PostsPage;
