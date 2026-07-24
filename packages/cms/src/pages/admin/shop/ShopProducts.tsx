import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createEffect, createSignal, For, Show, } from 'solid-js';
import type { ShopProduct, } from '@sitesurge/types';
import Pagination from '../../../components/admin/common/Pagination';
import { usePaginatedList, } from '../../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../../hooks/useSearchFilter';
import { cms, } from '../../../services/cmsClient';
import { getStatusBadgeClass, } from '../../../utils/badges';
import { money, } from '../../shop/shopFormat';
import PrintifySyncBar from './PrintifySyncBar';
import ShopGuard from './ShopGuard';
import ShopifyManagedBanner from './ShopifyManagedBanner';
import { createResource, } from 'solid-js';
import { isShopifyActive, shopifyAdminUrl, shopifySource, } from '../../../services/shopifySource';

const ShopProductsInner: Component = () => {
    const { searchInput, handleSearchInput, searchParams, setSearchParams, } = useSearchFilter();

    const list = usePaginatedList<ShopProduct>({
        fetch: (p,) => cms.shop.products.list(p,),
        initialLimit: 20,
        params: () => ({
            status: searchParams.status,
            search: searchParams.search,
        }),
    },);

    createEffect(() => {
        searchParams.status;
        searchParams.search;
        list.resetPage();
    },);

    // Bulk selection is managed locally because useBulkActions only maps to
    // the top-level entity modules — the shop products bulk lives at the
    // nested cms.shop.products.bulk, which we call directly here.
    const [selected, setSelected,] = createSignal<Set<string>>(new Set<string>(),);
    const isSelected = (id: string,) => selected().has(id,);
    const toggle = (id: string,) => {
        const next = new Set(selected(),);
        if (next.has(id,)) next.delete(id,);
        else next.add(id,);
        setSelected(next,);
    };
    const clear = () => setSelected(new Set<string>(),);
    const allSelected = () => {
        const items = list.items();
        return items.length > 0 && items.every((p,) => selected().has(p.id,));
    };
    const toggleAll = () => {
        if (allSelected()) clear();
        else setSelected(new Set(list.items().map((p,) => p.id,),),);
    };

    const runBulk = async (action: 'delete' | 'status', value?: string,) => {
        const ids = Array.from(selected(),);
        if (!ids.length) return;
        const msg = action === 'delete'
            ? `Delete ${ids.length} product(s)?`
            : `Set status of ${ids.length} product(s) to "${value}"?`;
        if (!confirm(msg,)) return;
        try {
            await cms.shop.products.bulk({ ids, action, value, },);
            clear();
            list.refetch();
        } catch {
            /* error bus surfaces the toast */
        }
    };

    return (
        <div class="shop-admin">
            <Title>Shop Products - Admin - RW</Title>
            <div class="admin-header">
                <h1>Products</h1>
                <A href="/admin/shop/products/new" class="btn btn--primary">New Product</A>
            </div>
            <PrintifySyncBar onSynced={() => list.refetch()} />
            <div class="admin-filter-bar">
                <input
                    class="admin-filter-bar__search"
                    type="text"
                    placeholder="Search products..."
                    value={searchInput()}
                    onInput={(e,) => handleSearchInput(e.currentTarget.value,)}
                />
                <select
                    class="admin-filter-bar__select"
                    value={searchParams.status || ''}
                    onChange={(e,) => setSearchParams({ status: e.currentTarget.value || undefined, },)}
                >
                    <option value="">All</option>
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                </select>
            </div>
            <Show when={selected().size > 0}>
                <div class="admin-list-page__bulk-bar">
                    <span class="admin-list-page__bulk-count">{selected().size} selected</span>
                    <button class="btn btn--small btn--secondary" onClick={() => runBulk('status', 'active',)}>
                        Activate
                    </button>
                    <button class="btn btn--small btn--secondary" onClick={() => runBulk('status', 'archived',)}>
                        Archive
                    </button>
                    <button class="btn btn--small btn--danger" onClick={() => runBulk('delete',)}>
                        Delete
                    </button>
                    <button class="btn btn--small btn--ghost" onClick={clear}>Clear</button>
                </div>
            </Show>
            <Show when={!list.loading()} fallback={<div class="empty-state">Loading...</div>}>
                <Show
                    when={list.items().length}
                    fallback={<div class="empty-state">No products found.</div>}
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '40px', }}>
                                        <input type="checkbox" checked={allSelected()} onChange={toggleAll} />
                                    </th>
                                    <th>Title</th>
                                    <th>Price</th>
                                    <th>Status</th>
                                    <th>Rating</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={list.items()}>
                                    {(p,) => (
                                        <tr>
                                            <td onClick={(e,) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected(p.id,)}
                                                    onChange={() => toggle(p.id,)}
                                                />
                                            </td>
                                            <td>
                                                <A href={`/admin/shop/products/${p.id}`} class="table-link">
                                                    {p.title}
                                                </A>
                                            </td>
                                            <td>
                                                <Show
                                                    when={p.fromPriceCents != null}
                                                    fallback={<span class="form-help-muted">—</span>}
                                                >
                                                    {money(p.fromPriceCents!,)}
                                                </Show>
                                            </td>
                                            <td>
                                                <span class={`badge ${getStatusBadgeClass(p.status,)}`}>
                                                    {p.status}
                                                </span>
                                            </td>
                                            <td>
                                                <Show when={p.ratingCount > 0} fallback={<span class="form-help-muted">—</span>}>
                                                    {p.ratingAvg.toFixed(1,)} ({p.ratingCount})
                                                </Show>
                                            </td>
                                            <td>
                                                <A
                                                    href={`/admin/shop/products/${p.id}`}
                                                    class="btn btn--small btn--secondary"
                                                >
                                                    Edit
                                                </A>
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

/** Read-only Shopify product list (override). Products live in Shopify; rows
 *  link to the public storefront page (which renders Shopify data) + Shopify admin. */
const ShopifyProductsInner: Component = () => {
    const [data,] = createResource(async () => {
        const r = await shopifySource.listProducts({ limit: 100, },);
        return r?.ok ? r.products : [];
    },);

    return (
        <div class="shop-admin">
            <Title>Shop Products - Admin - RW</Title>
            <div class="admin-header">
                <h1>Products</h1>
                <Show when={shopifyAdminUrl()}>
                    <a href={`${shopifyAdminUrl()}/products`} target="_blank" rel="noopener" class="btn btn--secondary">
                        Manage in Shopify ↗
                    </a>
                </Show>
            </div>
            <ShopifyManagedBanner note="Products are managed in Shopify. This list is read-only." />
            <Show when={!data.loading} fallback={<div class="empty-state">Loading…</div>}>
                <Show when={(data() ?? []).length} fallback={<div class="empty-state">No products found in Shopify.</div>}>
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr><th>Title</th><th>From price</th><th>Actions</th></tr>
                            </thead>
                            <tbody>
                                <For each={data()}>
                                    {(p,) => (
                                        <tr>
                                            <td><A href={`/shop/${p.slug}`} class="table-link">{p.title}</A></td>
                                            <td>
                                                <Show when={p.fromPriceCents != null} fallback={<span class="form-help-muted">—</span>}>
                                                    {money(p.fromPriceCents!,)}
                                                </Show>
                                            </td>
                                            <td>
                                                <A href={`/shop/${p.slug}`} class="btn btn--small btn--secondary">View</A>
                                            </td>
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

const ShopProducts: Component = () => (
    <ShopGuard>
        <Show when={isShopifyActive()} fallback={<ShopProductsInner />}>
            <ShopifyProductsInner />
        </Show>
    </ShopGuard>
);

export default ShopProducts;
