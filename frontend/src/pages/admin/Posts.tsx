import { Title, } from '@solidjs/meta';
import { A, useSearchParams, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { api, } from '../../services/api';

const AdminPosts: Component = () => {
    const [searchParams, setSearchParams,] = useSearchParams();

    const [searchInput, setSearchInput,] = createSignal(searchParams.search || '',);
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const handleSearchInput = (value: string,) => {
        setSearchInput(value,);
        clearTimeout(debounceTimer,);
        debounceTimer = setTimeout(() => {
            setSearchParams({ search: value || undefined, },);
        }, 300,);
    };

    const fetchKey = () => {
        const s = searchParams.status || '';
        const q = searchParams.search || '';
        const sort = searchParams.sort || '';
        return `${s}:${q}:${sort}`;
    };

    const [posts,] = createResource(fetchKey, async () => {
        const params = new URLSearchParams();
        if (searchParams.status) params.set('status', searchParams.status,);
        if (searchParams.search) params.set('search', searchParams.search,);
        if (searchParams.sort) params.set('sort', searchParams.sort,);
        const response = await api.get(`/posts?${params.toString()}`,);
        return response.success ? (response as any).data : [];
    },);

    const statusBadge = (status: string,) => {
        switch (status) {
            case 'published':
                return 'badge--success';
            case 'draft':
                return 'badge--warning';
            case 'archived':
                return 'badge--muted';
            case 'deleted':
                return 'badge--error';
            default:
                return 'badge--muted';
        }
    };

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
            <Show
                when={posts()?.length}
                fallback={<div class="empty-state">No posts found.</div>}
            >
                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Title</th>
                                <th>Status</th>
                                <th>Blocks</th>
                                <th>Date</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={posts()}>
                                {(post: any,) => (
                                    <tr>
                                        <td>
                                            <A href={`/admin/posts/${post.id}`} class="table-link">{post.title}</A>
                                        </td>
                                        <td>
                                            <span class={`badge ${statusBadge(post.status,)}`}>{post.status}</span>
                                        </td>
                                        <td>{post.blockCount || 0}</td>
                                        <td>
                                            {post.publishedAt ? new Date(post.publishedAt,).toLocaleDateString() : '—'}
                                        </td>
                                        <td>
                                            <A href={`/admin/posts/${post.id}`} class="btn btn--small btn--secondary">
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
            </Show>
        </div>
    );
};

export default AdminPosts;
