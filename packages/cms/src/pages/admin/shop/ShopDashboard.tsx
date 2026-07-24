import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, For, Show, } from 'solid-js';
import { createSafeResource, } from '../../../hooks/createSafeResource';
import type { ShopOrder, ShopProduct, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { getStatusBadgeClass, } from '../../../utils/badges';
import PrintifySyncBar from './PrintifySyncBar';
import ShopGuard from './ShopGuard';
import ShopifyManagedBanner from './ShopifyManagedBanner';
import { formatCents, formatDate, } from './shopUtils';
import { isShopifyActive, shopifyAdminUrl, shopifySource, } from '../../../services/shopifySource';

const PAID_STATUSES = new Set(['paid', 'processing', 'shipped', 'delivered',],);

const ShopDashboardInner: Component = () => {
    // Recent orders (rows for the table) + the true total for the nav count.
    const [ordersData,] = createSafeResource(
        async () => {
            const res = await cms.shop.orders.list({ limit: 10, },);
            return { rows: res.data as ShopOrder[], total: res.meta?.total ?? res.data.length, };
        },
        { rows: [] as ShopOrder[], total: 0, },
    );
    const orders = () => ordersData()?.rows ?? [];

    const [productsData,] = createSafeResource(
        async () => {
            const res = await cms.shop.products.list({ limit: 100, },);
            return { rows: res.data as ShopProduct[], total: res.meta?.total ?? res.data.length, };
        },
        { rows: [] as ShopProduct[], total: 0, },
    );
    const products = () => productsData()?.rows ?? [];

    const [categoriesCount,] = createSafeResource(async () => (await cms.shop.categories.list()).length, 0,);

    const [collectionsCount,] = createSafeResource(
        async () => (await cms.shop.collections.list({ all: 'true', },)).length,
        0,
    );

    const [reviewsCount,] = createSafeResource(
        async () => {
            const res = await cms.shop.reviews.adminList({ limit: 1, },);
            return res.meta?.total ?? res.data.length;
        },
        0,
    );

    const totalSales = () =>
        orders()
            .filter((o,) => PAID_STATUSES.has(o.status,))
            .reduce((sum, o,) => sum + (o.totalCents || 0), 0,);

    const paidCount = () => orders().filter((o,) => PAID_STATUSES.has(o.status,)).length;

    // Shopify override: stats + recent orders sourced from Shopify (read-only).
    const [shopifyStats,] = createResource(
        () => isShopifyActive() ? 'shopify' : null,
        () => shopifySource.shopStats(),
    );
    const [shopifyOrders,] = createResource(
        () => isShopifyActive() ? 'shopify' : null,
        async () => (await shopifySource.listOrders(10,)).orders ?? [],
    );

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
                <Show when={!isShopifyActive()}>
                    <A href="/admin/shop/products/new" class="btn btn--primary">New Product</A>
                </Show>
            </div>

            <ShopifyManagedBanner />
            <PrintifySyncBar />

            {/* Shopify-backed lightweight dashboard (read-only) when the plugin is on. */}
            <Show when={isShopifyActive()}>
                <div class="shop-admin__main">
                    <div class="shop-admin__cards">
                        <div class="shop-admin__card stat-card">
                            <span class="stat-card__label">Products</span>
                            <span class="stat-card__value">{shopifyStats()?.productCount ?? '—'}</span>
                        </div>
                        <div class="shop-admin__card stat-card">
                            <span class="stat-card__label">Orders</span>
                            <span class="stat-card__value">{shopifyStats()?.orderCount ?? '—'}</span>
                        </div>
                        <div class="shop-admin__card stat-card">
                            <span class="stat-card__label">Recent sales</span>
                            <span class="stat-card__value">
                                {formatCents(shopifyStats()?.recentSalesCents ?? 0, shopifyStats()?.currency,)}
                            </span>
                            <Show when={shopifyStats() && !shopifyStats()!.ok}>
                                <span class="form-help-muted">Add an Admin API token to see order stats.</span>
                            </Show>
                        </div>
                    </div>

                    <div class="shop-admin__section">
                        <div class="shop-admin__section-header">
                            <h2>Recent Shopify orders</h2>
                            <Show when={shopifyAdminUrl()}>
                                <a href={`${shopifyAdminUrl()}/orders`} target="_blank" rel="noopener" class="table-link">
                                    Open in Shopify ↗
                                </a>
                            </Show>
                        </div>
                        <Show
                            when={(shopifyOrders() ?? []).length}
                            fallback={<div class="empty-state">No orders (or no Admin API token configured).</div>}
                        >
                            <div class="admin-table-container">
                                <table class="admin-table">
                                    <thead>
                                        <tr><th>Order</th><th>Date</th><th>Customer</th><th>Total</th><th>Status</th></tr>
                                    </thead>
                                    <tbody>
                                        <For each={shopifyOrders()}>
                                            {(o,) => (
                                                <tr>
                                                    <td>{o.name}</td>
                                                    <td>{formatDate(o.createdAt,)}</td>
                                                    <td>{o.customerName || o.email || '—'}</td>
                                                    <td>{formatCents(o.totalCents, o.currency,)}</td>
                                                    <td><span class="badge">{o.financialStatus || '—'}</span></td>
                                                </tr>
                                            )}
                                        </For>
                                    </tbody>
                                </table>
                            </div>
                        </Show>
                    </div>
                </div>
            </Show>

            <Show when={!isShopifyActive()}>
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
            </Show>
        </div>
    );
};

const ShopDashboard: Component = () => (
    <ShopGuard>
        <ShopDashboardInner />
    </ShopGuard>
);

export default ShopDashboard;
