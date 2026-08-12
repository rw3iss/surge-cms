import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createEffect, } from 'solid-js';
import { formatDateShort as formatDate, } from '@sitesurge/types';
import DataTable from '../../components/admin/common/DataTable';
import { usePaginatedList, } from '../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../hooks/useSearchFilter';
import { cms, } from '../../services/cmsClient';
import { getStatusBadgeClass, } from '../../utils/badges';

const AdminPages: Component = () => {
    const { searchInput, handleSearchInput, searchParams, setSearchParams, } = useSearchFilter();
    const currentSort = () => searchParams.sort || 'updated_desc';

    const list = usePaginatedList<any>({
        fetch: (p,) => cms.pages.list(p,),
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
                <A href="/admin/pages/new" class="ui-button ui-button--primary">New Page</A>
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
            <DataTable
                items={list.items()}
                loading={list.loading()}
                emptyMessage="No pages found."
                sort={{ current: currentSort(), onSort: handleSort, }}
                pagination={{ page: list.page(), totalPages: list.totalPages(), total: list.total(), limit: list.limit(), onPageChange: list.setPage, }}
                columns={[
                    { header: 'Title', sortField: 'title', cell: (page: any,) => <A href={`/admin/pages/${page.id}`} class="table-link">{page.title}</A>, },
                    { header: 'Slug', cell: (page: any,) => `/${page.slug}`, },
                    { header: 'Status', sortField: 'status', cell: (page: any,) => <span class={`badge ${getStatusBadgeClass(page.status,)}`}>{page.status}</span>, },
                    // `field="date"` maps to the backend's date_asc / date_desc sort
                    // tokens, which order by created_at. The Modified column uses
                    // field="updated" → updated_at.
                    { header: 'Created', sortField: 'date', cell: (page: any,) => formatDate(page.createdAt,), },
                    { header: 'Modified', sortField: 'updated', cell: (page: any,) => formatDate(page.updatedAt,), },
                    {
                        header: 'Actions',
                        cell: (page: any,) => (
                            <>
                                <A href={`/admin/pages/${page.id}`} class="ui-button ui-button--sm ui-button--secondary">Edit</A>
                                <a
                                    href={page.status === 'published' ? `/${page.slug}` : `/${page.slug}?preview=admin`}
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

export default AdminPages;
