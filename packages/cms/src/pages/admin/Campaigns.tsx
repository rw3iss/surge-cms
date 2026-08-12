import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createEffect, } from 'solid-js';
import { formatDateShort as formatDate, } from '@sitesurge/types';
import DataTable from '../../components/admin/common/DataTable';
import { usePaginatedList, } from '../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../hooks/useSearchFilter';
import { cms, } from '../../services/cmsClient';
import { getStatusBadgeClass, } from '../../utils/badges';

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
        fetch: (p,) => cms.campaigns.list(p,),
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
        <div class="admin-campaigns">
            <Title>Campaigns - Admin - RW</Title>
            <div class="admin-header">
                <h1>Campaigns</h1>
                <A href="/admin/campaigns/new" class="ui-button ui-button--primary">New Campaign</A>
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
            <DataTable
                items={list.items()}
                loading={list.loading()}
                emptyMessage="No campaigns found."
                sort={{ current: currentSort(), onSort: handleSort, }}
                pagination={{ page: list.page(), totalPages: list.totalPages(), total: list.total(), limit: list.limit(), onPageChange: list.setPage, }}
                columns={[
                    { header: 'Title', sortField: 'title', cell: (c: any,) => <A href={`/admin/campaigns/${c.id}`} class="table-link">{c.title}</A>, },
                    { header: 'Goal', sortField: 'goal_amount_cents', cell: (c: any,) => formatCurrency(c.goalAmountCents,), },
                    { header: 'Raised', sortField: 'current_amount_cents', cell: (c: any,) => formatCurrency(c.currentAmountCents,), },
                    { header: 'Donors', sortField: 'donor_count', cell: (c: any,) => c.donorCount || 0, },
                    { header: 'Status', sortField: 'status', cell: (c: any,) => <span class={`badge ${getStatusBadgeClass(c.status,)}`}>{c.status}</span>, },
                    { header: 'Modified', sortField: 'updated_at', cell: (c: any,) => formatDate(c.updatedAt,), },
                    { header: 'Actions', cell: (c: any,) => <A href={`/admin/campaigns/${c.id}`} class="ui-button ui-button--sm">Edit</A>, },
                ]}
            />
        </div>
    );
};

export default AdminCampaigns;
