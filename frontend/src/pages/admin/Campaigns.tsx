import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createEffect, For, Show, } from 'solid-js';
import Pagination from '../../components/admin/Pagination';
import SortTh from '../../components/admin/SortTh';
import { usePaginatedList, } from '../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../hooks/useSearchFilter';
import { getStatusBadgeClass, } from '../../utils/badges';

function formatDate(iso: string | null | undefined,): string {
    if (!iso) return '—';
    return new Date(iso,).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', },);
}

function formatCurrency(cents: number | null | undefined,): string {
    if (cents === null || cents === undefined) return 'Open';
    return `$${(cents / 100).toLocaleString()}`;
}

const AdminCampaigns: Component = () => {
    const { searchParams, setSearchParams, } = useSearchFilter();
    const currentSort = () => searchParams.sort || 'updated_at_desc';

    // Map the frontend sort key (e.g. "title_desc") to backend sortBy + sortOrder
    const sortBy = () => {
        const s = currentSort();
        const idx = s.lastIndexOf('_',);
        return idx > 0 ? s.slice(0, idx,) : s;
    };
    const sortOrder = () => {
        const s = currentSort();
        return s.endsWith('_asc',) ? 'asc' : 'desc';
    };

    const list = usePaginatedList<any>({
        endpoint: '/campaigns',
        initialLimit: 20,
        params: () => ({
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
        <div class="admin-campaigns">
            <Title>Campaigns - Admin - RW</Title>
            <div class="admin-header">
                <h1>Campaigns</h1>
                <A href="/admin/campaigns/new" class="btn btn--primary">New Campaign</A>
            </div>
            <div class="admin-filter-bar">
                <select
                    class="admin-filter-bar__select"
                    value={searchParams.status || ''}
                    onChange={(e,) => setSearchParams({ status: e.currentTarget.value || undefined, },)}
                >
                    <option value="">All</option>
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                </select>
            </div>
            <Show
                when={!list.loading()}
                fallback={<div class="empty-state">Loading...</div>}
            >
                <Show
                    when={list.items().length}
                    fallback={<div class="empty-state">No campaigns found.</div>}
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <SortTh label="Title" field="title" current={currentSort()} onSort={handleSort} />
                                    <SortTh label="Goal" field="goal_amount_cents" current={currentSort()} onSort={handleSort} />
                                    <SortTh label="Raised" field="current_amount_cents" current={currentSort()} onSort={handleSort} />
                                    <SortTh label="Donors" field="donor_count" current={currentSort()} onSort={handleSort} />
                                    <SortTh label="Status" field="status" current={currentSort()} onSort={handleSort} />
                                    <SortTh label="Modified" field="updated_at" current={currentSort()} onSort={handleSort} />
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={list.items()}>
                                    {(c: any,) => (
                                        <tr>
                                            <td>
                                                <A href={`/admin/campaigns/${c.id}`} class="table-link">
                                                    {c.title}
                                                </A>
                                            </td>
                                            <td>{formatCurrency(c.goalAmountCents,)}</td>
                                            <td>{formatCurrency(c.currentAmountCents,)}</td>
                                            <td>{c.donorCount || 0}</td>
                                            <td>
                                                <span class={`badge ${getStatusBadgeClass(c.status,)}`}>
                                                    {c.status}
                                                </span>
                                            </td>
                                            <td>{formatDate(c.updatedAt,)}</td>
                                            <td>
                                                <A href={`/admin/campaigns/${c.id}`} class="btn btn--small">Edit</A>
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

export default AdminCampaigns;
