import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createEffect, For, Show, } from 'solid-js';
import { formatDateShort as formatDate, } from '@sitesurge/types';
import EmptyState from '../../components/admin/common/EmptyState';
import LoadingState from '../../components/admin/common/LoadingState';
import Pagination from '../../components/admin/common/Pagination';
import SortTh from '../../components/admin/common/SortTh';
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
                <A href="/admin/forms/new" class="btn btn--primary">New Form</A>
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
            <Show
                when={!list.loading()}
                fallback={<LoadingState />}
            >
                <Show
                    when={list.items().length}
                    fallback={<EmptyState message="No forms found." />}
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <SortTh label="Title" field="title" current={currentSort()} onSort={handleSort} />
                                    <SortTh label="Status" field="status" current={currentSort()} onSort={handleSort} />
                                    <SortTh label="Submissions" field="submission_count" current={currentSort()} onSort={handleSort} />
                                    <SortTh label="Modified" field="updated_at" current={currentSort()} onSort={handleSort} />
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={list.items()}>
                                    {(form: any,) => (
                                        <tr>
                                            <td>
                                                <A href={`/admin/forms/${form.id}`} class="table-link">
                                                    {form.title}
                                                </A>
                                            </td>
                                            <td>
                                                <span class={`badge ${getStatusBadgeClass(form.status,)}`}>
                                                    {form.status}
                                                </span>
                                            </td>
                                            <td>{form.submissionCount || 0}</td>
                                            <td>{formatDate(form.updatedAt,)}</td>
                                            <td>
                                                <A href={`/admin/forms/${form.id}`} class="btn btn--small">Edit</A>
                                                <Show when={form.submissionCount > 0}>
                                                    <A
                                                        href={`/admin/forms/${form.id}/submissions`}
                                                        class="btn btn--small btn--secondary"
                                                    >
                                                        Responses
                                                    </A>
                                                </Show>
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

export default AdminForms;
