/**
 * Admin donations table for a single campaign (rendered at the bottom of the
 * Campaign editor). Full donor info, a debounced server-side search across ALL
 * rows (name OR email — not just the current page), header-click sorting (the
 * backend does the sort), and pagination.
 */
import { formatCurrency, formatDate, } from '@sitesurge/types';
import type { CampaignAdminDonationsResponse, } from '@sitesurge/types';
import { Component, createEffect, createResource, createSignal, For, onCleanup, Show, } from 'solid-js';
import Pagination from '../../components/admin/common/Pagination';
import { cms, } from '../../services/cmsClient';

type Row = CampaignAdminDonationsResponse[number];
type SortBy = 'name' | 'email' | 'amount' | 'date' | 'status';

const COLUMNS: { key: SortBy; label: string; }[] = [
    { key: 'name', label: 'Donor', },
    { key: 'email', label: 'Email', },
    { key: 'amount', label: 'Amount', },
    { key: 'status', label: 'Status', },
    { key: 'date', label: 'Date', },
];

const CampaignDonations: Component<{ campaignId: string; }> = (props,) => {
    const [searchInput, setSearchInput,] = createSignal('',);
    const [search, setSearch,] = createSignal('',); // debounced value that drives the query
    const [page, setPage,] = createSignal(1,);
    const [sortBy, setSortBy,] = createSignal<SortBy>('date',);
    const [sortOrder, setSortOrder,] = createSignal<'asc' | 'desc'>('desc',);

    // Debounce the search box → server query (throttled, resets to page 1).
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const onSearchInput = (v: string,) => {
        setSearchInput(v,);
        if (debounceTimer) clearTimeout(debounceTimer,);
        debounceTimer = setTimeout(() => { setSearch(v.trim(),); setPage(1,); }, 300,);
    };
    onCleanup(() => { if (debounceTimer) clearTimeout(debounceTimer,); },);

    const [result,] = createResource(
        () => ({ id: props.campaignId, page: page(), search: search(), sortBy: sortBy(), sortOrder: sortOrder(), }),
        async (p) => {
            try {
                return await cms.campaigns.adminDonations(p.id, {
                    page: p.page, limit: 20, search: p.search || undefined, sortBy: p.sortBy, sortOrder: p.sortOrder,
                },);
            } catch {
                return { data: [] as Row[], meta: { page: 1, limit: 20, total: 0, totalPages: 0, }, };
            }
        },
    );

    const rows = () => result()?.data ?? [];
    const meta = () => result()?.meta;

    // Click a header → sort by it; click the active header → toggle direction.
    const toggleSort = (key: SortBy,) => {
        if (sortBy() === key) {
            setSortOrder(sortOrder() === 'asc' ? 'desc' : 'asc',);
        } else {
            setSortBy(key,);
            // Sensible default direction per column (amount/date desc, text asc).
            setSortOrder(key === 'amount' || key === 'date' ? 'desc' : 'asc',);
        }
        setPage(1,);
    };
    const sortIndicator = (key: SortBy,) => (sortBy() === key ? (sortOrder() === 'asc' ? ' ▲' : ' ▼') : '');

    // Keep the page in range if the total shrinks (e.g. after a search).
    createEffect(() => {
        const tp = meta()?.totalPages ?? 1;
        if (page() > tp && tp >= 1) setPage(tp,);
    },);

    return (
        <div class="campaign-donations">
            <div class="admin-header campaign-donations__header">
                <h2>Donations</h2>
                <Show when={meta()}>
                    <span class="campaign-donations__count">
                        {meta()!.total} donation{meta()!.total === 1 ? '' : 's'}
                    </span>
                </Show>
            </div>

            <div class="admin-filter-bar">
                <input
                    class="admin-filter-bar__search"
                    type="search"
                    placeholder="Search by name or email…"
                    value={searchInput()}
                    onInput={(e,) => onSearchInput(e.currentTarget.value,)}
                />
            </div>

            <Show
                when={!result.loading}
                fallback={<div class="empty-state">Loading donations…</div>}
            >
                <Show
                    when={rows().length}
                    fallback={
                        <div class="empty-state">
                            {search() ? 'No donations match your search.' : 'No donations for this campaign yet.'}
                        </div>
                    }
                >
                    <div class="admin-table-container">
                        <table class="admin-table campaign-donations__table">
                            <thead>
                                <tr>
                                    <For each={COLUMNS}>
                                        {(col,) => (
                                            <th
                                                class="campaign-donations__th"
                                                classList={{ 'is-sorted': sortBy() === col.key, }}
                                                onClick={() => toggleSort(col.key,)}
                                                title="Click to sort"
                                            >
                                                {col.label}{sortIndicator(col.key,)}
                                            </th>
                                        )}
                                    </For>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={rows()}>
                                    {(d,) => (
                                        <tr>
                                            <td>{d.donorName || <span class="form-help-muted">—</span>}</td>
                                            <td>{d.donorEmail}</td>
                                            <td>{formatCurrency(d.amountCents,)}</td>
                                            <td>
                                                <span class={`badge badge--donation-${d.status}`}>{d.status}</span>
                                            </td>
                                            <td>{formatDate(d.createdAt,)}</td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>

                    <Show when={meta()}>
                        <Pagination
                            page={meta()!.page}
                            totalPages={meta()!.totalPages}
                            total={meta()!.total}
                            limit={meta()!.limit}
                            onPageChange={setPage}
                        />
                    </Show>
                </Show>
            </Show>
        </div>
    );
};

export default CampaignDonations;
