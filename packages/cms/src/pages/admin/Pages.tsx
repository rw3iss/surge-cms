import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createEffect, For, Show, } from 'solid-js';
import Pagination from '../../components/admin/common/Pagination';
import SortTh from '../../components/admin/common/SortTh';
import { usePaginatedList, } from '../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../hooks/useSearchFilter';
import { getStatusBadgeClass, } from '../../utils/badges';

function formatDate(iso: string | null | undefined,): string {
    if (!iso) return '—';
    const d = new Date(iso,);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', },);
}

const AdminPages: Component = () => {
    const { searchInput, handleSearchInput, searchParams, setSearchParams, } = useSearchFilter();
    const currentSort = () => searchParams.sort || 'updated_desc';

    const list = usePaginatedList<any>({
        endpoint: '/pages',
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

    const handleSort = (sort: string,) => {
        setSearchParams({ sort, },);
    };

    return (
        <div>
            <Title>Pages - Admin - RW</Title>
            <div class="admin-header">
                <h1>Pages</h1>
                <A href="/admin/pages/new" class="btn btn--primary">New Page</A>
            </div>
            <div class="admin-filter-bar">
                <input
                    class="admin-filter-bar__search"
                    type="text"
                    placeholder="Search pages..."
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
            </div>
            <Show
                when={!list.loading()}
                fallback={<div class="empty-state">Loading...</div>}
            >
                <Show
                    when={list.items().length}
                    fallback={<div class="empty-state">No pages found.</div>}
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <SortTh label="Title" field="title" current={currentSort()} onSort={handleSort} />
                                    <th>Slug</th>
                                    <SortTh label="Status" field="status" current={currentSort()} onSort={handleSort} />
                                    {/* `field="date"` maps to the backend's date_asc /
                                        date_desc sort tokens, which order by
                                        created_at. The other date column below
                                        uses field="updated" → updated_at. */}
                                    <SortTh label="Created" field="date" current={currentSort()} onSort={handleSort} />
                                    <SortTh label="Modified" field="updated" current={currentSort()} onSort={handleSort} />
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={list.items()}>
                                    {(page: any,) => (
                                        <tr>
                                            <td>
                                                <A href={`/admin/pages/${page.id}`} class="table-link">
                                                    {page.title}
                                                </A>
                                            </td>
                                            <td>/{page.slug}</td>
                                            <td>
                                                <span class={`badge ${getStatusBadgeClass(page.status,)}`}>
                                                    {page.status}
                                                </span>
                                            </td>
                                            <td>{formatDate(page.createdAt,)}</td>
                                            <td>{formatDate(page.updatedAt,)}</td>
                                            <td>
                                                <A href={`/admin/pages/${page.id}`} class="btn btn--small btn--secondary">
                                                    Edit
                                                </A>
                                                <a
                                                    href={page.status === 'published' ?
                                                        `/${page.slug}` :
                                                        `/${page.slug}?preview=admin`}
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

export default AdminPages;
