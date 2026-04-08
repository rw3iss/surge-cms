import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createEffect, For, Show, } from 'solid-js';
import Pagination from '../../components/admin/Pagination';
import { useBulkActions, } from '../../hooks/useBulkActions';
import { usePaginatedList, } from '../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../hooks/useSearchFilter';
import { getStatusBadgeClass, } from '../../utils/badges';

const AdminPosts: Component = () => {
    const { searchInput, handleSearchInput, searchParams, setSearchParams, } = useSearchFilter();

    const list = usePaginatedList<any>({
        endpoint: '/posts',
        initialLimit: 20,
        params: () => ({
            status: searchParams.status,
            search: searchParams.search,
            sort: searchParams.sort,
        }),
    },);

    // Reset to page 1 when filters change
    createEffect(() => {
        searchParams.status;
        searchParams.search;
        searchParams.sort;
        list.resetPage();
    },);

    const bulk = useBulkActions({
        entityType: 'post',
        onComplete: () => list.refetch(),
    },);

    const statusBadge = getStatusBadgeClass;

    return (
        <div>
            <Title>Posts - Admin - Surge Media</Title>
            <div class="admin-header">
                <h1>Posts</h1>
                <A href="/admin/posts/new" class="btn btn--primary">New Post</A>
            </div>
            <div class="admin-filter-bar">
                <input
                    class="admin-filter-bar__search"
                    type="text"
                    placeholder="Search posts..."
                    value={searchInput()}
                    onInput={(e,) => handleSearchInput(e.currentTarget.value,)}
                />
                <select
                    class="admin-filter-bar__select"
                    value={searchParams.status || ''}
                    onChange={(e,) => setSearchParams({ status: e.currentTarget.value || undefined, },)}
                >
                    <option value="">All</option>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="archived">Archived</option>
                    <option value="deleted">Deleted</option>
                </select>
                <select
                    class="admin-filter-bar__select"
                    value={searchParams.sort || 'date_desc'}
                    onChange={(e,) => setSearchParams({ sort: e.currentTarget.value || undefined, },)}
                >
                    <option value="date_desc">Newest</option>
                    <option value="date_asc">Oldest</option>
                    <option value="title_asc">Name A-Z</option>
                    <option value="title_desc">Name Z-A</option>
                </select>
            </div>
            <Show when={bulk.selectedCount() > 0}>
                <div class="admin-list-page__bulk-bar">
                    <span class="admin-list-page__bulk-count">
                        {bulk.selectedCount()} selected
                    </span>
                    <button
                        class="btn btn--small btn--secondary"
                        onClick={() => bulk.applyStatus('published',)}
                    >
                        Publish
                    </button>
                    <button
                        class="btn btn--small btn--secondary"
                        onClick={() => bulk.applyStatus('draft',)}
                    >
                        Unpublish
                    </button>
                    <button
                        class="btn btn--small btn--danger"
                        onClick={() => bulk.applyDelete()}
                    >
                        Delete
                    </button>
                    <button
                        class="btn btn--small btn--ghost"
                        onClick={() => bulk.clear()}
                    >
                        Clear
                    </button>
                </div>
            </Show>
            <Show
                when={!list.loading()}
                fallback={<div class="empty-state">Loading...</div>}
            >
                <Show
                    when={list.items().length}
                    fallback={<div class="empty-state">No posts found.</div>}
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '40px', }}>
                                        <input
                                            type="checkbox"
                                            checked={bulk.allSelected(list.items(),)}
                                            onChange={() => bulk.toggleAll(list.items(),)}
                                        />
                                    </th>
                                    <th>Title</th>
                                    <th>Status</th>
                                    <th>Blocks</th>
                                    <th>Date</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={list.items()}>
                                    {(post: any,) => (
                                        <tr>
                                            <td onClick={(e,) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={bulk.isSelected(post.id,)}
                                                    onChange={() => bulk.toggle(post.id,)}
                                                />
                                            </td>
                                            <td>
                                                <A
                                                    href={`/admin/posts/${post.id}`}
                                                    class="table-link"
                                                >
                                                    {post.title}
                                                </A>
                                            </td>
                                            <td>
                                                <span class={`badge ${statusBadge(post.status,)}`}>
                                                    {post.status}
                                                </span>
                                            </td>
                                            <td>{post.blockCount || 0}</td>
                                            <td>
                                                {post.publishedAt ?
                                                    new Date(post.publishedAt,).toLocaleDateString() :
                                                    '—'}
                                            </td>
                                            <td>
                                                <A
                                                    href={`/admin/posts/${post.id}`}
                                                    class="btn btn--small btn--secondary"
                                                >
                                                    Edit
                                                </A>
                                                <a
                                                    href={post.status === 'published' ?
                                                        `/posts/${post.slug}` :
                                                        `/posts/${post.slug}?preview=admin`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    class="btn btn--small btn--ghost"
                                                >
                                                    View
                                                </a>
                                            </td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                    <Pagination
                        page={list.page()}
                        totalPages={list.totalPages()}
                        total={list.total()}
                        limit={list.limit()}
                        onPageChange={list.setPage}
                    />
                </Show>
            </Show>
        </div>
    );
};

export default AdminPosts;
