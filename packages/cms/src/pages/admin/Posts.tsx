import { A, useNavigate, } from '@solidjs/router';
import { Component, createEffect, createSignal, For, } from 'solid-js';
import { formatDateShort as formatDate, getPostType, } from '@sitesurge/types';
import ModalShell from '../../components/admin/common/ModalShell';
import { PostTypeIcon, usePostTypes, } from '../../components/admin/posts/usePostTypes';
import DataTable from '../../components/admin/common/DataTable';
import { useBulkActions, } from '../../hooks/useBulkActions';
import { usePaginatedList, } from '../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../hooks/useSearchFilter';
import { cms, } from '../../services/cmsClient';
import { getStatusBadgeClass, } from '../../utils/badges';
import AdminTitle from '../../components/admin/common/AdminTitle';

const AdminPosts: Component = () => {
    const { searchInput, handleSearchInput, searchParams, setSearchParams, } = useSearchFilter();
    const currentSort = () => searchParams.sort || 'updated_desc';

    const list = usePaginatedList<any>({
        fetch: (p,) => cms.posts.list(p,),
        initialLimit: 20,
        params: () => ({
            status: searchParams.status,
            search: searchParams.search,
            sort: currentSort(),
        }),
    },);

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

    const navigate = useNavigate();
    const postTypes = usePostTypes();
    const creatableTypes = () => postTypes().filter((t,) => t.creatable !== false);
    const [showCreate, setShowCreate,] = createSignal(false,);
    const createPost = (key: string,) => {
        setShowCreate(false,);
        navigate(`/admin/posts/new?type=${encodeURIComponent(key,)}`,);
    };

    const handleSort = (sort: string,) => {
        setSearchParams({ sort, },);
    };

    return (
        <div>
            <AdminTitle>Posts</AdminTitle>
            <div class="admin-header">
                <h1>Posts</h1>
                <button type="button" class="ui-button ui-button--primary" onClick={() => setShowCreate(true,)}>New Post</button>
            </div>
            <ModalShell open={showCreate()} onClose={() => setShowCreate(false,)} size="md" showClose ariaLabel="Create a post">
                <div class="post-type-picker">
                    <h3 class="post-type-picker__title">Create a post</h3>
                    <div class="post-type-picker__tiles">
                        <For each={creatableTypes()}>
                            {(t,) => (
                                <button
                                    type="button"
                                    class="post-type-picker__tile"
                                    title={t.description}
                                    onClick={() => createPost(t.key,)}
                                >
                                    <PostTypeIcon def={t} class="post-type-icon post-type-icon--lg" />
                                    <span class="post-type-picker__label">{t.label}</span>
                                    <span class="post-type-picker__hint">{t.description}</span>
                                </button>
                            )}
                        </For>
                    </div>
                </div>
            </ModalShell>
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
            </div>
            <DataTable
                items={list.items()}
                loading={list.loading()}
                emptyMessage="No posts found."
                sort={{ current: currentSort(), onSort: handleSort, }}
                bulk={{
                    selectedCount: bulk.selectedCount,
                    isSelected: bulk.isSelected,
                    toggle: bulk.toggle,
                    allSelected: bulk.allSelected,
                    toggleAll: bulk.toggleAll,
                    clear: bulk.clear,
                    actions: [
                        { label: 'Publish', onClick: () => bulk.applyStatus('published',), },
                        { label: 'Unpublish', onClick: () => bulk.applyStatus('draft',), },
                        { label: 'Delete', variant: 'danger', onClick: () => bulk.applyDelete(), },
                    ],
                }}
                pagination={{ page: list.page(), totalPages: list.totalPages(), total: list.total(), limit: list.limit(), onPageChange: list.setPage, }}
                columns={[
                    { header: 'Title', sortField: 'title', cell: (post: any,) => <A href={`/admin/posts/${post.id}`} class="table-link">{post.title}</A>, },
                    {
                        header: 'Type',
                        cell: (post: any,) => {
                            postTypes();
                            const def = getPostType(post.postType,);
                            return (
                                <span class="post-type-cell">
                                    <PostTypeIcon def={def} class="post-type-icon post-type-icon--sm" />
                                    {def.label}
                                </span>
                            );
                        },
                    },
                    { header: 'Status', sortField: 'status', cell: (post: any,) => <span class={`badge ${getStatusBadgeClass(post.status,)}`}>{post.status}</span>, },
                    { header: 'Blocks', cell: (post: any,) => post.blockCount || 0, },
                    { header: 'Published', sortField: 'date', cell: (post: any,) => formatDate(post.publishedAt,), },
                    { header: 'Modified', sortField: 'updated', cell: (post: any,) => formatDate(post.updatedAt,), },
                    {
                        header: 'Actions',
                        cell: (post: any,) => (
                            <>
                                <A href={`/admin/posts/${post.id}`} class="ui-button ui-button--sm ui-button--secondary">Edit</A>
                                <a
                                    href={post.status === 'published' ? `/posts/${post.slug}` : `/posts/${post.slug}?preview=admin`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="ui-button ui-button--sm ui-button--ghost"
                                >
                                    View
                                </a>
                            </>
                        ),
                    },
                ]}
            />
        </div>
    );
};

export default AdminPosts;
