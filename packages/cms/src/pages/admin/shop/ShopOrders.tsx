import { A, } from '@solidjs/router';
import { Component, createEffect, For, Show, } from 'solid-js';
import EmptyState from '../../../components/admin/common/EmptyState';
import LoadingState from '../../../components/admin/common/LoadingState';
import type { ShopOrder, } from '@sitesurge/types';
import { SHOP_ORDER_STATUSES, } from '@sitesurge/types';
import ExportMenu from '../../../components/admin/common/ExportMenu';
import Toggle from '../../../components/ui/Toggle';
import Pagination from '../../../components/admin/common/Pagination';
import { usePaginatedList, } from '../../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../../hooks/useSearchFilter';
import { cms, } from '../../../services/cmsClient';
import { getStatusBadgeClass, } from '../../../utils/badges';
import ShopGuard from './ShopGuard';
import ShopifyManagedBanner from './ShopifyManagedBanner';
import { formatCents, formatDate, } from './shopUtils';
import { createResource, } from 'solid-js';
import { isShopifyActive, shopifyAdminUrl, shopifySource, } from '../../../services/shopifySource';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import OrderTracking, { orderShipmentsOf, } from '../../../components/shop/OrderTracking';

const ShopOrdersInner: Component = () => {
    const { searchInput, handleSearchInput, searchParams, setSearchParams, } = useSearchFilter();

    // `?attention=1` is where the "needs attention" alert links: the same rule
    // as its count (services/shop/attention.ts), so the numbers match.
    const attention = () => searchParams.attention === '1' || searchParams.attention === 'true';
    const filters = () => ({
        status: searchParams.status || undefined,
        search: searchParams.search || undefined,
        attention: attention() || undefined,
        from: searchParams.from || undefined,
        // `to` is a date: include the whole day.
        to: searchParams.to ? new Date(new Date(`${searchParams.to}T00:00:00`,).getTime() + 86_400_000,).toISOString() : undefined,
    });

    const list = usePaginatedList<ShopOrder>({
        fetch: (p,) => cms.shop.orders.list(p as never,),
        initialLimit: 20,
        params: filters,
    },);

    createEffect(() => {
        filters();
        list.resetPage();
    },);

    return (
        <div class="shop-admin">
            <AdminTitle>Shop Orders</AdminTitle>
            <div class="admin-header">
                <A href="/admin/shop" class="admin-header__back">← Shop</A>
                <h1>Orders</h1>
            </div>
            <div class="admin-filter-bar">
                {/* Search-as-you-type (debounced) — the documented exception to commit-on-blur. */}
                <input
                    class="admin-filter-bar__search"
                    type="text"
                    placeholder="Order number, email or name…"
                    value={searchInput()}
                    onInput={(e,) => handleSearchInput(e.currentTarget.value,)}
                />
                <select
                    class="admin-filter-bar__select"
                    value={searchParams.status || ''}
                    onChange={(e,) => setSearchParams({ status: e.currentTarget.value || undefined, },)}
                >
                    <option value="">All statuses</option>
                    <For each={SHOP_ORDER_STATUSES}>
                        {(st,) => <option value={st}>{st.charAt(0,).toUpperCase() + st.slice(1,)}</option>}
                    </For>
                </select>
                <input
                    class="admin-filter-bar__select"
                    type="date"
                    aria-label="Placed from"
                    title="Placed from"
                    value={searchParams.from || ''}
                    onChange={(e,) => setSearchParams({ from: e.currentTarget.value || undefined, },)}
                />
                <input
                    class="admin-filter-bar__select"
                    type="date"
                    aria-label="Placed to"
                    title="Placed to"
                    value={searchParams.to || ''}
                    onChange={(e,) => setSearchParams({ to: e.currentTarget.value || undefined, },)}
                />
                <Toggle
                    checked={attention()}
                    onChange={(on,) => setSearchParams({ attention: on ? '1' : undefined, },)}
                    label="Needs attention"
                />
                <ExportMenu
                    url={(format, query,) => cms.shop.orders.exportUrl(format, query,)}
                    query={() => filters()}
                />
            </div>
            <Show when={!list.loading()} fallback={<LoadingState />}>
                <Show
                    when={list.items().length}
                    fallback={<EmptyState message="No orders found." />}
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
                                    <th>Tracking</th>
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
                                            <td>
                                                <Show when={orderShipmentsOf(o,).length} fallback={<span class="form-help-muted">—</span>}>
                                                    <OrderTracking order={o} compact />
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

/** Read-only Shopify orders (override). Requires an Admin API token. */
const ShopifyOrdersInner: Component = () => {
    const [data,] = createResource(async () => {
        const r = await shopifySource.listOrders(50,);
        return r?.ok ? { orders: r.orders, error: '', } : { orders: [], error: r?.error || 'Could not load orders', };
    },);

    return (
        <div class="shop-admin">
            <AdminTitle>Shop Orders</AdminTitle>
            <div class="admin-header">
                <A href="/admin/shop" class="admin-header__back">← Shop</A>
                <h1>Orders</h1>
                <Show when={shopifyAdminUrl()}>
                    <a href={`${shopifyAdminUrl()}/orders`} target="_blank" rel="noopener" class="ui-button ui-button--secondary">
                        Manage in Shopify ↗
                    </a>
                </Show>
            </div>
            <ShopifyManagedBanner note="Orders are managed in Shopify. This list is read-only (last 60 days unless read_all_orders is granted)." />
            <Show when={!data.loading} fallback={<div class="empty-state">Loading…</div>}>
                <Show
                    when={(data()?.orders ?? []).length}
                    fallback={<div class="empty-state">{data()?.error || 'No orders found.'}</div>}
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr><th>Order</th><th>Date</th><th>Customer</th><th>Total</th><th>Payment</th><th>Fulfillment</th></tr>
                            </thead>
                            <tbody>
                                <For each={data()?.orders}>
                                    {(o,) => (
                                        <tr>
                                            <td>{o.name}</td>
                                            <td>{formatDate(o.createdAt,)}</td>
                                            <td>{o.customerName || o.email || '—'}</td>
                                            <td>{formatCents(o.totalCents, o.currency,)}</td>
                                            <td><span class="badge">{o.financialStatus || '—'}</span></td>
                                            <td class="form-help-muted">{o.fulfillmentStatus || '—'}</td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                </Show>
            </Show>
        </div>
    );
};

const ShopOrders: Component = () => (
    <ShopGuard>
        <Show when={isShopifyActive()} fallback={<ShopOrdersInner />}>
            <ShopifyOrdersInner />
        </Show>
    </ShopGuard>
);

export default ShopOrders;
