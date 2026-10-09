import { featuredImagePath, getPostType, listPostTypes, } from '@sitesurge/types';
import { A, useSearchParams, } from '@solidjs/router';
import type { Post, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, on, onMount, Show, } from 'solid-js';
import PostVisibilityBadge from '../components/content/PostVisibilityBadge';
import PostTypeBadge from '../components/content/PostTypeBadge';
import { useAuth, } from '../stores/auth';
import SeoHead from '../components/common/seo/SeoHead';
import { siteName, } from '../stores/siteSettings';
import { cms, } from '../services/cmsClient';
import { buildCollectionPage, } from '../utils/schema';
import './Posts.scss';

const PAGE_SIZE = 12;

const PostsPage: Component = () => {
    const [searchParams, setSearchParams,] = useSearchParams();
    const [posts, setPosts,] = createSignal<Post[]>([],);
    const [total, setTotal,] = createSignal(0,);
    const [page, setPage,] = createSignal(1,);
    const [loading, setLoading,] = createSignal(true,);
    const [loadingMore, setLoadingMore,] = createSignal(false,);
    const auth = useAuth();

    // ─── Post-type filter (?type=) ───
    // Counts are per viewer (subscriber-hidden posts don't count for others),
    // so a type button only appears when this viewer has posts of that type,
    // and the bar only when there are at least two types to choose between.
    const activeType = () => {
        const t = Array.isArray(searchParams.type,) ? searchParams.type[0] : searchParams.type;
        return t || null;
    };
    const [typeCounts, setTypeCounts,] = createSignal<Record<string, number>>({},);
    const loadTypeCounts = () => cms.posts.typeCounts().then(setTypeCounts,).catch(() => setTypeCounts({},),);
    const typeLabel = (key: string,) => (key === 'custom' ? 'Other' : getPostType(key,).label);
    const typeOptions = () => {
        const counts = typeCounts();
        const known = listPostTypes().map((t,) => t.key);
        const keys = [...known, ...Object.keys(counts,).filter((k,) => !known.includes(k,)),];
        return keys.filter((k,) => (counts[k] ?? 0) > 0).map((k,) => ({ key: k, label: typeLabel(k,), count: counts[k], icon: getPostType(k,).icon, }));
    };
    const showTypeBar = () => typeOptions().length > 1;
    const allCount = () => Object.values(typeCounts(),).reduce((a, b,) => a + b, 0,);
    const selectType = (key: string | null,) => setSearchParams({ type: key ?? undefined, },);

    const hasMore = () => posts().length < total();

    const loadPosts = async (pageNum: number, append = false,) => {
        if (append) setLoadingMore(true,);
        else setLoading(true,);

        const tag = Array.isArray(searchParams.tag,) ? searchParams.tag[0] : searchParams.tag;
        const type = activeType() ?? undefined;
        const category = Array.isArray(searchParams.category,) ? searchParams.category[0] : searchParams.category;

        try {
            const { data, meta, } = await cms.posts.list({
                page: pageNum,
                limit: PAGE_SIZE,
                tag,
                category,
                type,
            },);

            const items = data ?? [];
            if (append) {
                setPosts(prev => [...prev, ...items,],);
            } else {
                setPosts(items,);
            }
            setTotal(meta?.total || 0,);
            setPage(pageNum,);
        } catch {
            // Non-critical read — leave existing list intact; the cms.onError
            // bus surfaces the failure.
        } finally {
            setLoading(false,);
            setLoadingMore(false,);
        }
    };

    // The list is shaped per viewer (hidden subscriber posts, badges), so
    // reload it when someone signs in or out.
    createEffect(on(() => auth.user?.id ?? null, () => {
        void loadPosts(1,);
        void loadTypeCounts();
    }, { defer: true, },),);
    // Picking a type re-queries from page 1.
    createEffect(on(activeType, () => void loadPosts(1,), { defer: true, },),);

    onMount(() => {
        void loadPosts(1,);
        void loadTypeCounts();
    },);

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

            <div class="page-header u-flex-row u-items-baseline">
                <h1>Latest Posts</h1>
                <Show when={total() > 0}>
                    <span style={{ 'font-size': '0.85rem', color: 'var(--site-text-muted, #6b7280)', 'font-weight': '400', }}>{total()} {total() === 1 ? 'post' : 'posts'}</span>
                </Show>
                <Show when={showTypeBar()}>
                    <div class="posts-type-filter" role="toolbar" aria-label="Filter posts by type">
                        <button
                            type="button"
                            class={`posts-type-filter__btn${activeType() === null ? ' posts-type-filter__btn--active' : ''}`}
                            aria-pressed={activeType() === null}
                            onClick={() => selectType(null,)}
                        >
                            All
                            <span class="posts-type-filter__count">{allCount()}</span>
                        </button>
                        <For each={typeOptions()}>
                            {(t,) => (
                                <button
                                    type="button"
                                    class={`posts-type-filter__btn${activeType() === t.key ? ' posts-type-filter__btn--active' : ''}`}
                                    aria-pressed={activeType() === t.key}
                                    onClick={() => selectType(activeType() === t.key ? null : t.key,)}
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} /></svg>
                                    {t.label}
                                    <span class="posts-type-filter__count">{t.count}</span>
                                </button>
                            )}
                        </For>
                    </div>
                </Show>
            </div>

            <Show when={!loading()} fallback={<div class="posts-page__loading">Loading posts...</div>}>
                <Show when={posts().length > 0} fallback={<div class="posts-page__empty">No posts yet. Check back soon!</div>}>
                    <div class="posts-page__list">
                        <For each={posts()}>
                            {(post,) => (
                                <A href={`/posts/${post.slug}`} class="post-card">
                                    <PostTypeBadge
                                        type={post.postType}
                                        ended={!!post.liveEndedAt}
                                        variant="float"
                                        class="post-card__type"
                                    />
                                    <Show when={featuredImagePath(post)}>
                                        <div class="post-card__image">
                                            <img src={featuredImagePath(post)} alt={post.title} loading="lazy" />
                                        </div>
                                    </Show>
                                    <div class="post-card__body">
                                        <h2 class="post-card__title">
                                            {post.title}
                                            <PostVisibilityBadge gate={post.gate} />
                                        </h2>
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
