import type { ShopAppearance, ShopCategory, ShopCollection, ShopProduct, ShopPublicSettings, } from '@sitesurge/types';
import { A, useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, onMount, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import { siteName, } from '../../stores/siteSettings';
import MerchandiseSignup from './MerchandiseSignup';
import ProductCard from './ProductCard';
import ShopStoreGuard from './ShopStoreGuard';
import { useOverridePageSettings, } from '../../hooks/useOverridePageSettings';
import DynamicPage from '../DynamicPage';
import PageCustomCss from '../../components/common/PageCustomCss';
import { money, } from './shopFormat';
import { isShopifyActive, shopifySource, } from '../../services/shopifySource';
import './shop.scss';

const PAGE_SIZE = 24;

interface StorefrontConfig {
    settings: ShopPublicSettings;
    appearance: ShopAppearance;
}

const ShopIndexInner: Component = () => {
    const [searchParams, setSearchParams,] = useSearchParams<{ collection?: string, category?: string, }>();
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

    // Categories + published collections for the filter sidebar (built-in shop
    // only; Shopify has its own routing). Each carries a `productCount` (active
    // products); the sidebar hides empty items and empty sections. Empty both →
    // the sidebar isn't rendered.
    const [collections] = createResource<ShopCollection[]>(async () => {
        if (isShopifyActive()) return [];
        try {
            return await cms.shop.collections.list() as ShopCollection[];
        } catch {
            return [];
        }
    },);

    const [categories] = createResource<ShopCategory[]>(async () => {
        if (isShopifyActive()) return [];
        try {
            return await cms.shop.categories.list() as ShopCategory[];
        } catch {
            return [];
        }
    },);

    /** The active collection slug from ?collection=…, or '' for "All". */
    const activeCollection = () => searchParams.collection || '';
    /** The active category slug from ?category=…, or '' for "All". */
    const activeCategory = () => searchParams.category || '';

    /**
     * The mobile filter's current value, encoding which of the three kinds of
     * selection is live. Prefixed rather than bare slugs because a collection
     * and a category are allowed to share one.
     */
    const mobileFilterValue = () =>
        activeCollection() ? `collection:${activeCollection()}`
            : activeCategory() ? `category:${activeCategory()}`
            : '';

    let mainEl: HTMLDivElement | undefined;

    /** Apply a mobile-dropdown choice, mirroring what the sidebar links do. */
    const onMobileFilterChange = (value: string,) => {
        const [kind, ...rest] = value.split(':',);
        const slug = rest.join(':',);
        if (kind === 'collection') setSearchParams({ collection: slug, category: undefined, },);
        else if (kind === 'category') setSearchParams({ category: slug, collection: undefined, },);
        else setSearchParams({ collection: undefined, category: undefined, },);

        // The dropdown is sticky, so after switching the visitor is usually
        // somewhere down the old list. Put them at the top of the new one —
        // `start` on the products column, which sits just below the sticky bar.
        requestAnimationFrame(() => mainEl?.scrollIntoView({ behavior: 'smooth', block: 'start', },),);
    };

    // Sidebar sections: only items that actually have (active) products, and only
    // shown at all when the section is non-empty.
    const visibleCategories = () => (categories() ?? []).filter((c,) => (c.productCount ?? 0) > 0);
    const visibleCollections = () => (collections() ?? []).filter((c,) => (c.productCount ?? 0) > 0);
    const hasSidebar = () => visibleCategories().length > 0 || visibleCollections().length > 0;

    const appearance = (): ShopAppearance =>
        config()?.appearance ?? { gridColumns: 3, showRatings: true, cardStyle: 'standard', };
    const currency = () => config()?.settings.currency || 'USD';
    const freeShipThreshold = () => config()?.settings.shipping?.freeThresholdCents ?? 0;

    // Collection / category views return the whole set at once — no "load more".
    const hasMore = () =>
        !activeCollection() && !activeCategory()
        && (isShopifyActive() ? shopifyHasMore() : products().length < total());

    const load = async (pageNum: number, append = false,) => {
        if (append) setLoadingMore(true,);
        else setLoading(true,);
        try {
            // Collection / category filter (built-in): fetch that set's products,
            // then narrow by the search box client-side.
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
            if (activeCategory() && !isShopifyActive()) {
                const res = await cms.shop.categories.getBySlug(activeCategory(),);
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

    // Reload whenever the active collection/category changes (route ?collection=
    // / ?category=).
    createEffect(() => {
        activeCollection();
        activeCategory();
        void load(1,);
    },);

    const onSearch = (e: Event,) => {
        e.preventDefault();
        void load(1,);
    };

    const gridStyle = () => ({
        '--shop-grid-columns': String(appearance().gridColumns || 3,),
    });

    // Inherit presentation from the `shop` CMS page when one exists: header
    // style/position and background. The storefront still renders itself — this
    // only honours the settings an operator put on that page.
    const overrides = useOverridePageSettings('shop',);

    // The background is published to `.layout` by the hook, not painted here —
    // a wrapper inside the max-width column cannot cover the gutters.

    return (
        <div class="shop-store shop-index page-wrapper">
            {/* The `shop` page's overrides apply to the BUILT-IN storefront too,
                which is the point: it is the only way to restyle markup this
                component owns without adding a setting per element. */}
            <PageCustomCss css={overrides.customCss()} />
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

            {/* Masthead: the heading sits in a column the width of the filters
                sidebar, and the signup tout occupies the products column beside
                it — so both line up with the grid below rather than floating on
                their own measure. Mirrors `__body`'s flex exactly; when the
                sidebar isn't rendered the heading gives up its fixed width, the
                same way the product column widens.

                The tout only renders when the operator enabled it AND assigned
                a mailing list — the server decides that, so the storefront
                can't offer a signup with nowhere to go. */}
            <div
                class="shop-index__masthead"
                classList={{ 'shop-index__masthead--full': !hasSidebar(), }}
            >
                <header class="page-header shop-store__header">
                    <h1>Shop</h1>
                </header>
                <Show when={config()?.settings.merchandiseSignupEnabled}>
                    <MerchandiseSignup />
                </Show>
            </div>

            <div class="shop-index__body">
                {/* Filters column: Categories + Collections. Each section shows
                    only when it has items (products); the whole aside is hidden
                    when neither does. */}
                {/* Mobile filter. A NATIVE select with optgroups rather than a
                    bespoke menu: the OS picker is what a phone user expects,
                    optgroup labels give non-selectable section headers for
                    free, and it stays keyboard- and screen-reader-usable. CSS
                    shows this or the sidebar, never both. */}
                <Show when={hasSidebar()}>
                    <div class="shop-index__mobile-filter">
                        <select
                            aria-label="Filter products"
                            value={mobileFilterValue()}
                            onChange={(e,) => onMobileFilterChange(e.currentTarget.value,)}
                        >
                            <option value="">All Products</option>
                            <Show when={visibleCollections().length > 0}>
                                <optgroup label="Collections">
                                    <For each={visibleCollections()}>
                                        {(c,) => (
                                            <option value={`collection:${c.slug}`}>
                                                {c.title} ({c.productCount})
                                            </option>
                                        )}
                                    </For>
                                </optgroup>
                            </Show>
                            <Show when={visibleCategories().length > 0}>
                                <optgroup label="Categories">
                                    <For each={visibleCategories()}>
                                        {(c,) => (
                                            <option value={`category:${c.slug}`}>
                                                {c.name} ({c.productCount})
                                            </option>
                                        )}
                                    </For>
                                </optgroup>
                            </Show>
                        </select>
                    </div>
                </Show>

                <Show when={hasSidebar()}>
                    <aside class="shop-index__sidebar" aria-label="Product filters">
                        <A
                            href="/shop"
                            class={`shop-index__filter shop-index__filter--all ${
                                (!activeCollection() && !activeCategory()) ? 'is-active' : ''
                            }`}
                        >
                            All Products
                        </A>

                        <Show when={visibleCollections().length > 0}>
                            <div class="shop-index__filter-group">
                                <h2 class="shop-index__filter-heading">Collections</h2>
                                <For each={visibleCollections()}>
                                    {(c,) => (
                                        <A
                                            href={`/shop?collection=${encodeURIComponent(c.slug,)}`}
                                            class={`shop-index__filter ${activeCollection() === c.slug ? 'is-active' : ''}`}
                                        >
                                            <span>{c.title}</span>
                                            <span class="shop-index__filter-count">({c.productCount})</span>
                                        </A>
                                    )}
                                </For>
                            </div>
                        </Show>

                        <Show when={visibleCategories().length > 0}>
                            <div class="shop-index__filter-group">
                                <h2 class="shop-index__filter-heading">Categories</h2>
                                <For each={visibleCategories()}>
                                    {(c,) => (
                                        <A
                                            href={`/shop?category=${encodeURIComponent(c.slug,)}`}
                                            class={`shop-index__filter ${activeCategory() === c.slug ? 'is-active' : ''}`}
                                        >
                                            <span>{c.name}</span>
                                            <span class="shop-index__filter-count">({c.productCount})</span>
                                        </A>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </aside>
                </Show>

                <div class="shop-index__main" ref={(el,) => { mainEl = el; }}>
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

const ShopIndex: Component = () => {
    // Which storefront to render. Resolved from public shop settings; the
    // built-in grid is assumed until they load, so the storefront never blanks
    // while waiting.
    const [mode, setMode,] = createSignal<'builtin' | 'page'>('builtin',);
    onMount(async () => {
        try {
            const cfg = await cms.shop.settings.getPublic();
            const m = (cfg?.settings as { storefrontMode?: string; } | undefined)?.storefrontMode;
            if (m === 'page') setMode('page',);
        } catch {
            /* keep the built-in grid */
        }
    },);

    return (
        <ShopStoreGuard>
            {/* 'page' renders the `shop` CMS page's own blocks. DynamicPage
                falls back to a not-found state if no such page exists, which is
                why the setting's help text says the built-in grid is the safe
                choice. Product pages, cart and checkout are unaffected. */}
            <Show when={mode() === 'page'} fallback={<ShopIndexInner />}>
                <DynamicPage slugOverride="shop" />
            </Show>
        </ShopStoreGuard>
    );
};

export default ShopIndex;
