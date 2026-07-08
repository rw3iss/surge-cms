import type { ShopAppearance, ShopProduct, ShopPublicSettings, } from '@rw/cms-shared';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import { siteName, } from '../../stores/siteSettings';
import ProductCard from './ProductCard';
import ShopStoreGuard from './ShopStoreGuard';
import './shop.scss';

const PAGE_SIZE = 24;

interface StorefrontConfig {
    settings: ShopPublicSettings;
    appearance: ShopAppearance;
}

const ShopIndexInner: Component = () => {
    const [products, setProducts,] = createSignal<ShopProduct[]>([],);
    const [total, setTotal,] = createSignal(0,);
    const [page, setPage,] = createSignal(1,);
    const [search, setSearch,] = createSignal('',);
    const [loading, setLoading,] = createSignal(true,);
    const [loadingMore, setLoadingMore,] = createSignal(false,);

    const [config] = createResource<StorefrontConfig | null>(async () => {
        try {
            return await cms.shop.settings.getPublic();
        } catch {
            return null;
        }
    },);

    const appearance = (): ShopAppearance =>
        config()?.appearance ?? { gridColumns: 3, showRatings: true, cardStyle: 'standard', };
    const currency = () => config()?.settings.currency || 'USD';

    const hasMore = () => products().length < total();

    const load = async (pageNum: number, append = false,) => {
        if (append) setLoadingMore(true,);
        else setLoading(true,);
        try {
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

    void load(1,);

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

            <header class="page-header shop-store__header">
                <h1>Shop</h1>
                <form class="shop-index__search" onSubmit={onSearch}>
                    <input
                        type="search"
                        placeholder="Search products…"
                        value={search()}
                        onInput={(e,) => setSearch(e.currentTarget.value,)}
                    />
                    <button type="submit" class="btn btn--secondary">Search</button>
                </form>
            </header>

            <Show when={!loading()} fallback={<div class="shop-store__loading">Loading products…</div>}>
                <Show
                    when={products().length > 0}
                    fallback={<div class="shop-store__empty">No products found.</div>}
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
    );
};

const ShopIndex: Component = () => (
    <ShopStoreGuard>
        <ShopIndexInner />
    </ShopStoreGuard>
);

export default ShopIndex;
