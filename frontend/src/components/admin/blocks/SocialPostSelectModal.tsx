/**
 * Larger "select a social post" modal — used by the merged Social Feed
 * block when the operator wants more than the inline search dropdown.
 *
 * Pre-configured to a specific provider; offers full search, sort, and
 * pagination across that provider's synced posts. Picking a post fires
 * `onSelect` and closes.
 */
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import { api, } from '../../../services/api';
import Pagination from '../common/Pagination';

export interface SocialPost {
    id: string;
    externalId?: string;
    provider?: string;
    content?: string;
    thumbnailUrl?: string;
    mediaUrl?: string;
    authorName?: string;
    likes?: number;
    comments?: number;
    publishedAt?: string;
}

interface SocialPostSelectModalProps {
    provider: string;
    initialPostId?: string;
    onSelect: (post: SocialPost,) => void;
    onClose: () => void;
}

const SORT_OPTIONS = [
    { value: 'date', label: 'Date', },
    { value: 'likes', label: 'Likes', },
    { value: 'comments', label: 'Comments', },
];
const LIMIT = 20;

const SocialPostSelectModal: Component<SocialPostSelectModalProps> = (props,) => {
    const [page, setPage,] = createSignal(1,);
    const [sort, setSort,] = createSignal('date',);
    const [sortDir, setSortDir,] = createSignal<'desc' | 'asc'>('desc',);
    const [search, setSearch,] = createSignal('',);
    const [searchInput, setSearchInput,] = createSignal('',);

    const fetchKey = () =>
        `${props.provider}:${page()}:${sort()}:${sortDir()}:${search()}`;

    const [result,] = createResource(fetchKey, async () => {
        const params = new URLSearchParams({
            page: String(page(),),
            limit: String(LIMIT,),
            sort: sort(),
            sortDir: sortDir(),
        },);
        const q = search().trim();
        if (q) params.set('search', q,);
        const response = await api.get(`/social/posts/${props.provider}?${params.toString()}`,);
        if (!response.success) return null;
        return {
            posts: ((response as any).data || []) as SocialPost[],
            meta: (response as any).meta || { total: 0, totalPages: 1, page: 1, limit: LIMIT, },
        };
    },);

    const posts = () => result()?.posts || [];
    const meta = () => result()?.meta || { total: 0, totalPages: 1, page: 1, limit: LIMIT, };

    const submitSearch = () => {
        setSearch(searchInput(),);
        setPage(1,);
    };

    return (
        <Portal>
            <div
                class="social-post-modal-backdrop"
                onClick={(e,) => {
                    if (e.target === e.currentTarget) props.onClose();
                }}
            >
                <div class="social-post-modal">
                    <div class="social-post-modal__header">
                        <h2>Select a {props.provider} post</h2>
                        <button
                            type="button"
                            class="social-post-modal__close"
                            onClick={props.onClose}
                            aria-label="Close"
                        >
                            ×
                        </button>
                    </div>

                    <div class="social-post-modal__toolbar">
                        <input
                            type="text"
                            class="social-post-modal__search"
                            placeholder="Search posts…"
                            value={searchInput()}
                            onInput={(e,) => setSearchInput(e.currentTarget.value,)}
                            onKeyDown={(e,) => { if (e.key === 'Enter') submitSearch(); }}
                            onBlur={submitSearch}
                        />
                        <select
                            class="social-post-modal__sort"
                            value={sort()}
                            onChange={(e,) => { setSort(e.currentTarget.value,); setPage(1,); }}
                        >
                            <For each={SORT_OPTIONS}>
                                {(o,) => <option value={o.value}>{o.label}</option>}
                            </For>
                        </select>
                        <button
                            type="button"
                            class="btn btn--icon btn--small"
                            onClick={() => { setSortDir(sortDir() === 'desc' ? 'asc' : 'desc',); setPage(1,); }}
                            title={sortDir() === 'desc' ? 'Newest first' : 'Oldest first'}
                        >
                            {sortDir() === 'desc' ? '↓' : '↑'}
                        </button>
                    </div>

                    <div class="social-post-modal__body">
                        <Show
                            when={!result.loading}
                            fallback={<div class="social-post-modal__loading">Loading posts…</div>}
                        >
                            <Show
                                when={posts().length > 0}
                                fallback={
                                    <div class="social-post-modal__empty">
                                        {search()
                                            ? `No posts matching "${search()}"`
                                            : 'No posts found for this provider. Sync posts first from the Connections page.'}
                                    </div>
                                }
                            >
                                <div class="social-media-grid">
                                    <For each={posts()}>
                                        {(post,) => (
                                            <div
                                                class={`social-media-grid__item ${
                                                    props.initialPostId === (post.externalId || post.id)
                                                        ? 'social-media-grid__item--selected'
                                                        : ''
                                                }`}
                                                onClick={() => {
                                                    props.onSelect(post,);
                                                    props.onClose();
                                                }}
                                            >
                                                <Show when={post.thumbnailUrl || post.mediaUrl}>
                                                    <img
                                                        src={post.thumbnailUrl || post.mediaUrl}
                                                        alt=""
                                                        loading="lazy"
                                                    />
                                                </Show>
                                                <div class="social-media-grid__caption">
                                                    {(post.content || '').substring(0, 80,)}
                                                </div>
                                                <div class="social-media-grid__meta">
                                                    {post.likes ?? 0} likes · {post.comments ?? 0} comments
                                                    <Show when={post.publishedAt}>
                                                        {' · '}{new Date(post.publishedAt!,).toLocaleDateString()}
                                                    </Show>
                                                </div>
                                            </div>
                                        )}
                                    </For>
                                </div>

                                <Pagination
                                    page={meta().page}
                                    totalPages={meta().totalPages}
                                    total={meta().total}
                                    limit={meta().limit}
                                    onPageChange={setPage}
                                />
                            </Show>
                        </Show>
                    </div>
                </div>
            </div>
        </Portal>
    );
};

export default SocialPostSelectModal;
