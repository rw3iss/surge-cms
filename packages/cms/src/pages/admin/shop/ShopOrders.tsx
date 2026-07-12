import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createEffect, For, Show, } from 'solid-js';
import type { ShopOrder, } from '@sitesurge/types';
import Pagination from '../../../components/admin/common/Pagination';
import { usePaginatedList, } from '../../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../../hooks/useSearchFilter';
import { cms, } from '../../../services/cmsClient';
import { getStatusBadgeClass, } from '../../../utils/badges';
import ShopGuard from './ShopGuard';
import { formatCents, formatDate, } from './shopUtils';

const ShopOrdersInner: Component = () => {
    const { searchParams, setSearchParams, } = useSearchFilter();

    const list = usePaginatedList<ShopOrder>({
        fetch: (p,) => cms.shop.orders.list(p,),
        initialLimit: 20,
        params: () => ({ status: searchParams.status, }),
    },);

    createEffect(() => {
        searchParams.status;
        list.resetPage();
    },);

    return (
        <div class="shop-admin">
            <Title>Shop Orders - Admin - RW</Title>
            <div class="admin-header">
                <h1>Orders</h1>
            </div>
            <div class="admin-filter-bar">
                <select
                    class="admin-filter-bar__select"
                    value={searchParams.status || ''}
                    onChange={(e,) => setSearchParams({ status: e.currentTarget.value || undefined, },)}
                >
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="processing">Processing</option>
                    <option value="shipped">Shipped</option>
                    <option value="delivered">Delivered</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="refunded">Refunded</option>
                </select>
            </div>
            <Show when={!list.loading()} fallback={<div class="empty-state">Loading...</div>}>
                <Show
                    when={list.items().length}
                    fallback={<div class="empty-state">No orders found.</div>}
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th>Order</th>
                                    <th>Date</th>
                                    <th>Customer</th>
                                    <th>Total</th>
                                    <th>Status</th>
                                    <th>Fulfillment</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={list.items()}>
                                    {(o,) => (
                                        <tr>
                                            <td>
                                                <A href={`/admin/shop/orders/${o.id}`} class="table-link">
                                                    {o.orderNumber}
                                                </A>
                                            </td>
                                            <td>{formatDate(o.createdAt,)}</td>
                                            <td>{o.customerName || o.customerEmail}</td>
                                            <td>{formatCents(o.totalCents, o.currency,)}</td>
                                            <td>
                                                <span class={`badge ${getStatusBadgeClass(o.status,)}`}>{o.status}</span>
                                            </td>
                                            <td class="form-help-muted">{o.fulfillmentStatus}</td>
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

const ShopOrders: Component = () => (
    <ShopGuard>
        <ShopOrdersInner />
    </ShopGuard>
);

export default ShopOrders;
