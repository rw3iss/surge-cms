import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createEffect, Show, } from 'solid-js';
import { formatDateShort as formatDate, } from '@sitesurge/types';
import DataTable from '../../components/admin/common/DataTable';
import { usePaginatedList, } from '../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../hooks/useSearchFilter';
import { cms, } from '../../services/cmsClient';
import { getStatusBadgeClass, } from '../../utils/badges';

const AdminForms: Component = () => {
    const { searchParams, setSearchParams, } = useSearchFilter();
    const currentSort = () => searchParams.sort || 'updated_at_desc';

    const sortBy = () => {
        const s = currentSort();
        if (s.endsWith('_asc',)) return s.slice(0, -4,);
        if (s.endsWith('_desc',)) return s.slice(0, -5,);
        return s;
    };
    const sortOrder = () => currentSort().endsWith('_asc',) ? 'asc' : 'desc';

    const list = usePaginatedList<any>({
        fetch: (p,) => cms.forms.list(p,),
        initialLimit: 20,
        params: () => ({
            all: 'true',
            status: searchParams.status,
            sortBy: sortBy(),
            sortOrder: sortOrder(),
        }),
    },);

    createEffect(() => {
        searchParams.status;
        searchParams.sort;
        list.resetPage();
    },);

    const handleSort = (sort: string,) => setSearchParams({ sort, },);

    return (
        <div class="admin-forms">
            <Title>Forms - Admin - RW</Title>
            <div class="admin-header">
                <h1>Forms</h1>
                <A href="/admin/forms/new" class="ui-button ui-button--primary">New Form</A>
            </div>
            <div class="admin-filter-bar">
                <select
                    class="admin-filter-bar__select"
                    value={searchParams.status || ''}
                    onChange={(e,) => setSearchParams({ status: e.currentTarget.value || undefined, },)}
                >
                    <option value="">All</option>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="closed">Closed</option>
                    <option value="archived">Archived</option>
                </select>
            </div>
            <DataTable
                items={list.items()}
                loading={list.loading()}
                emptyMessage="No forms found."
                sort={{ current: currentSort(), onSort: handleSort, }}
                pagination={{ page: list.page(), totalPages: list.totalPages(), total: list.total(), limit: list.limit(), onPageChange: list.setPage, }}
                columns={[
                    { header: 'Title', sortField: 'title', cell: (form: any,) => <A href={`/admin/forms/${form.id}`} class="table-link">{form.title}</A>, },
                    { header: 'Status', sortField: 'status', cell: (form: any,) => <span class={`badge ${getStatusBadgeClass(form.status,)}`}>{form.status}</span>, },
                    { header: 'Submissions', sortField: 'submission_count', cell: (form: any,) => form.submissionCount || 0, },
                    { header: 'Modified', sortField: 'updated_at', cell: (form: any,) => formatDate(form.updatedAt,), },
                    {
                        header: 'Actions',
                        cell: (form: any,) => (
                            <>
                                <A href={`/admin/forms/${form.id}`} class="ui-button ui-button--sm">Edit</A>
                                <Show when={form.submissionCount > 0}>
                                    <A href={`/admin/forms/${form.id}/submissions`} class="ui-button ui-button--sm ui-button--secondary">Responses</A>
                                </Show>
                            </>
                        ),
                    },
                ]}
            />
        </div>
    );
};

export default AdminForms;
