import type { ShopAppearance, ShopCollection, ShopProduct, ShopPublicSettings, } from '@sitesurge/types';
import { A, useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import { siteName, } from '../../stores/siteSettings';
import ProductCard from './ProductCard';
import ShopStoreGuard from './ShopStoreGuard';
import { money, } from './shopFormat';
import { isShopifyActive, shopifySource, } from '../../services/shopifySource';
import './shop.scss';

const PAGE_SIZE = 24;

interface StorefrontConfig {
    settings: ShopPublicSettings;
    appearance: ShopAppearance;
}

const ShopIndexInner: Component = () => {
    const [searchParams] = useSearchParams<{ collection?: string, }>();
    const [products, setProducts,] = createSignal<ShopProduct[]>([],);
    const [total, setTotal,] = createSignal(0,);
    const [page, setPage,] = createSignal(1,);
    const [search, setSearch,] = createSignal('',);
    const [loading, setLoading,] = createSignal(true,);
    const [loadingMore, setLoadingMore,] = createSignal(false,);
    // Shopify override uses cursor pagination (not page/total).
    const [cursor, setCursor,] = createSignal<string | undefined>(undefined,);
    const [shopifyHasMore, setShopifyHasMore,] = createSignal(false,);

    const [config] = createResource<StorefrontConfig | null>(async () => {
        try {
            return await cms.shop.settings.getPublic();
        } catch {
            return null;
        }
    },);

    // Published collections for the filter sidebar (built-in shop only; Shopify
    // has its own collection routing). Empty → the sidebar isn't rendered.
    const [collections] = createResource<ShopCollection[]>(async () => {
        if (isShopifyActive()) return [];
        try {
            return await cms.shop.collections.list() as ShopCollection[];
        } catch {
            return [];
        }
    },);

    /** The active collection slug from ?collection=…, or '' for "All". */
    const activeCollection = () => searchParams.collection || '';

    const appearance = (): ShopAppearance =>
        config()?.appearance ?? { gridColumns: 3, showRatings: true, cardStyle: 'standard', };
    const currency = () => config()?.settings.currency || 'USD';
    const freeShipThreshold = () => config()?.settings.shipping?.freeThresholdCents ?? 0;

    // Collection view returns the whole collection at once — no "load more".
    const hasMore = () =>
        !activeCollection() && (isShopifyActive() ? shopifyHasMore() : products().length < total());

    const load = async (pageNum: number, append = false,) => {
        if (append) setLoadingMore(true,);
        else setLoading(true,);
        try {
            // Collection filter (built-in): fetch the collection's products, then
            // narrow by the search box client-side.
            if (activeCollection() && !isShopifyActive()) {
                const res = await cms.shop.collections.getBySlug(activeCollection(),);
                let items = res?.products ?? [];
                const q = search().trim().toLowerCase();
                if (q) items = items.filter((p,) => p.title.toLowerCase().includes(q,),);
                setProducts(items,);
                setTotal(items.length,);
                setPage(1,);
                return;
            }
            if (isShopifyActive()) {
                // Shopify: cursor-based. A fresh load (append=false) resets the cursor.
                const res = await shopifySource.listProducts({
                    limit: PAGE_SIZE,
                    cursor: append ? cursor() : undefined,
                    search: search() || undefined,
                },);
                const items = res?.ok ? res.products : [];
                setProducts((prev,) => append ? [...prev, ...items,] : items,);
                setCursor(res?.pageInfo?.endCursor,);
                setShopifyHasMore(Boolean(res?.pageInfo?.hasNextPage),);
                setPage(pageNum,);
                return;
            }
            const { data, meta, } = await cms.shop.products.listPublic({
                page: pageNum,
                limit: PAGE_SIZE,
                search: search() || undefined,
            },);
            const items = data ?? [];
            setProducts((prev,) => append ? [...prev, ...items,] : items,);
            setTotal(meta?.total || 0,);
            setPage(pageNum,);
        } catch {
            /* non-critical read; cms.onError bus surfaces failures */
        } finally {
            setLoading(false,);
            setLoadingMore(false,);
        }
    };

    // Reload whenever the active collection changes (route ?collection=… ).
    createEffect(() => {
        activeCollection();
        void load(1,);
    },);

    const onSearch = (e: Event,) => {
        e.preventDefault();
        void load(1,);
    };

    const gridStyle = () => ({
        '--shop-grid-columns': String(appearance().gridColumns || 3,),
    });

    return (
        <div class="shop-store shop-index page-wrapper">
            <SeoHead
                title="Shop"
                description={`Browse products from ${siteName()}.`}
                canonical={`${window.location.origin}/shop`}
                type="website"
            />

            <Show when={freeShipThreshold() > 0}>
                <div class="shop-index__free-ship">
                    🚚 Free shipping on orders over {money(freeShipThreshold(), currency(),)}
                </div>
            </Show>

            <header class="page-header shop-store__header">
                <h1>Shop</h1>
            </header>

            <div class="shop-index__body">
                {/* Collections filter column — only when collections exist. */}
                <Show when={(collections() ?? []).length > 0}>
                    <aside class="shop-index__collections" aria-label="Collections">
                        <A
                            href="/shop"
                            class={`shop-index__collection ${!activeCollection() ? 'is-active' : ''}`}
                        >
                            All
                        </A>
                        <For each={collections()}>
                            {(c,) => (
                                <A
                                    href={`/shop?collection=${encodeURIComponent(c.slug,)}`}
                                    class={`shop-index__collection ${activeCollection() === c.slug ? 'is-active' : ''}`}
                                >
                                    {c.title}
                                </A>
                            )}
                        </For>
                    </aside>
                </Show>

                <div class="shop-index__main">
                    <form class="shop-index__search" onSubmit={onSearch}>
                        <input
                            type="search"
                            placeholder="Search products…"
                            value={search()}
                            onInput={(e,) => setSearch(e.currentTarget.value,)}
                        />
                        <button type="submit" class="btn btn--secondary">Search</button>
                    </form>

                    <Show when={!loading()} fallback={<div class="shop-store__loading">Loading products…</div>}>
                        <Show
                            when={products().length > 0}
                            fallback={<div class="empty-state">No products found.</div>}
                        >
                            <div class="shop-grid" style={gridStyle()}>
                                <For each={products()}>
                                    {(product,) => (
                                        <ProductCard
                                            product={product}
                                            cardStyle={appearance().cardStyle}
                                            showRatings={appearance().showRatings}
                                            currency={currency()}
                                            priceCents={product.fromPriceCents}
                                            image={product.primaryImageUrl}
                                        />
                                    )}
                                </For>
                            </div>

                            <Show when={hasMore()}>
                                <div class="shop-store__load-more">
                                    <button
                                        class="btn btn--secondary"
                                        disabled={loadingMore()}
                                        onClick={() => load(page() + 1, true,)}
                                    >
                                        {loadingMore() ? 'Loading…' : 'Load More'}
                                    </button>
                                </div>
                            </Show>
                        </Show>
                    </Show>
                </div>
            </div>
        </div>
    );
};

const ShopIndex: Component = () => (
    <ShopStoreGuard>
        <ShopIndexInner />
    </ShopStoreGuard>
);

export default ShopIndex;
