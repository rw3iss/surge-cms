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
    const [orders,] = createResource(async () => {
        try {
            const res = await cms.shop.orders.list({ limit: 10, },);
            return res.data as ShopOrder[];
        } catch {
            return [] as ShopOrder[];
        }
    },);

    const [products,] = createResource(async () => {
        try {
            const res = await cms.shop.products.list({ limit: 100, },);
            return res.data as ShopProduct[];
        } catch {
            return [] as ShopProduct[];
        }
    },);

    const totalSales = () => {
        const list = orders() || [];
        const cents = list
            .filter((o,) => PAID_STATUSES.has(o.status,))
            .reduce((sum, o,) => sum + (o.totalCents || 0), 0,);
        return cents;
    };

    const paidCount = () => (orders() || []).filter((o,) => PAID_STATUSES.has(o.status,)).length;

    return (
        <div class="shop-admin">
            <Title>Shop - Admin - RW</Title>
            <div class="admin-header">
                <h1>Shop</h1>
                <A href="/admin/shop/products/new" class="btn btn--primary">New Product</A>
            </div>

            <div class="shop-admin__cards">
                <div class="shop-admin__card stat-card">
                    <span class="stat-card__label">Recent paid sales</span>
                    <span class="stat-card__value">{formatCents(totalSales(),)}</span>
                    <span class="form-help-muted">{paidCount()} of last {(orders() || []).length} orders</span>
                </div>
                <div class="shop-admin__card stat-card">
                    <span class="stat-card__label">Products</span>
                    <span class="stat-card__value">{(products() || []).length}</span>
                    <A href="/admin/shop/products" class="table-link">Manage products</A>
                </div>
                <div class="shop-admin__card stat-card">
                    <span class="stat-card__label">Quick links</span>
                    <div class="shop-admin__quick-links">
                        <A href="/admin/shop/orders" class="table-link">Orders</A>
                        <A href="/admin/shop/categories" class="table-link">Categories</A>
                        <A href="/admin/shop/collections" class="table-link">Collections</A>
                        <A href="/admin/shop/reviews" class="table-link">Reviews</A>
                        <A href="/admin/shop/settings" class="table-link">Settings</A>
                    </div>
                </div>
            </div>

            <div class="shop-admin__section">
                <div class="shop-admin__section-header">
                    <h2>Recent orders</h2>
                    <A href="/admin/shop/orders" class="table-link">View all</A>
                </div>
                <Show
                    when={(orders() || []).length}
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
                    when={(products() || []).length}
                    fallback={<div class="empty-state">No products yet.</div>}
                >
                    <p class="form-help-muted">
                        Inventory per variant is shown on each product; open a product to adjust stock.
                    </p>
                </Show>
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
