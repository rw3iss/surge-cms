import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, For, Show, } from 'solid-js';
import type { ShopOrder, ShopProduct, } from '@rw/cms-shared';
import { cms, } from '../../../services/cmsClient';
import { getStatusBadgeClass, } from '../../../utils/badges';
import ShopGuard from './ShopGuard';
import { formatCents, formatDate, } from './shopUtils';

const PAID_STATUSES = new Set(['paid', 'processing', 'shipped', 'delivered',],);

const ShopDashboardInner: Component = () => {
    // Recent orders (rows for the table) + the true total for the nav count.
    const [ordersData,] = createResource(async () => {
        try {
            const res = await cms.shop.orders.list({ limit: 10, },);
            return { rows: res.data as ShopOrder[], total: res.meta?.total ?? res.data.length, };
        } catch {
            return { rows: [] as ShopOrder[], total: 0, };
        }
    },);
    const orders = () => ordersData()?.rows ?? [];

    const [productsData,] = createResource(async () => {
        try {
            const res = await cms.shop.products.list({ limit: 100, },);
            return { rows: res.data as ShopProduct[], total: res.meta?.total ?? res.data.length, };
        } catch {
            return { rows: [] as ShopProduct[], total: 0, };
        }
    },);
    const products = () => productsData()?.rows ?? [];

    const [categoriesCount,] = createResource(async () => {
        try {
            return (await cms.shop.categories.list()).length;
        } catch {
            return 0;
        }
    },);

    const [collectionsCount,] = createResource(async () => {
        try {
            return (await cms.shop.collections.list({ all: 'true', },)).length;
        } catch {
            return 0;
        }
    },);

    const [reviewsCount,] = createResource(async () => {
        try {
            const res = await cms.shop.reviews.adminList({ limit: 1, },);
            return res.meta?.total ?? res.data.length;
        } catch {
            return 0;
        }
    },);

    const totalSales = () =>
        orders()
            .filter((o,) => PAID_STATUSES.has(o.status,))
            .reduce((sum, o,) => sum + (o.totalCents || 0), 0,);

    const paidCount = () => orders().filter((o,) => PAID_STATUSES.has(o.status,)).length;

    // Left-nav entries. `count: null` renders no badge (Settings has no items).
    const navLinks = (): { href: string; label: string; count: number | null; }[] => [
        { href: '/admin/shop/products', label: 'Products', count: productsData()?.total ?? 0, },
        { href: '/admin/shop/orders', label: 'Orders', count: ordersData()?.total ?? 0, },
        { href: '/admin/shop/categories', label: 'Categories', count: categoriesCount() ?? 0, },
        { href: '/admin/shop/collections', label: 'Collections', count: collectionsCount() ?? 0, },
        { href: '/admin/shop/reviews', label: 'Reviews', count: reviewsCount() ?? 0, },
        { href: '/admin/shop/settings', label: 'Settings', count: null, },
    ];

    return (
        <div class="shop-admin">
            <Title>Shop - Admin - RW</Title>
            <div class="admin-header">
                <h1>Shop</h1>
                <A href="/admin/shop/products/new" class="btn btn--primary">New Product</A>
            </div>

            <div class="shop-admin__layout">
                {/* Left: thin nav column — one link per section with its item count. */}
                <nav class="shop-admin__nav" aria-label="Shop sections">
                    <For each={navLinks()}>
                        {(link,) => (
                            <A href={link.href} end class="shop-admin__nav-link">
                                <span class="shop-admin__nav-label">{link.label}</span>
                                <Show when={link.count !== null}>
                                    <span class="shop-admin__nav-count">{link.count}</span>
                                </Show>
                            </A>
                        )}
                    </For>
                </nav>

                {/* Right: stats summary, recent orders, and other highlights. */}
                <div class="shop-admin__main">
                    <div class="shop-admin__cards">
                        <div class="shop-admin__card stat-card">
                            <span class="stat-card__label">Recent paid sales</span>
                            <span class="stat-card__value">{formatCents(totalSales(),)}</span>
                            <span class="form-help-muted">{paidCount()} of last {orders().length} orders</span>
                        </div>
                    </div>

                    <div class="shop-admin__section">
                        <div class="shop-admin__section-header">
                            <h2>Recent orders</h2>
                            <A href="/admin/shop/orders" class="table-link">View all</A>
                        </div>
                        <Show
                            when={orders().length}
                            fallback={<div class="empty-state">No orders yet.</div>}
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
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <For each={orders()}>
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
                                                </tr>
                                            )}
                                        </For>
                                    </tbody>
                                </table>
                            </div>
                        </Show>
                    </div>

                    <div class="shop-admin__section">
                        <div class="shop-admin__section-header">
                            <h2>Low stock</h2>
                            <A href="/admin/shop/products" class="table-link">All products</A>
                        </div>
                        <Show
                            when={products().length}
                            fallback={<div class="empty-state">No products yet.</div>}
                        >
                            <p class="form-help-muted">
                                Inventory per variant is shown on each product; open a product to adjust stock.
                            </p>
                        </Show>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ShopDashboard: Component = () => (
    <ShopGuard>
        <ShopDashboardInner />
    </ShopGuard>
);

export default ShopDashboard;
