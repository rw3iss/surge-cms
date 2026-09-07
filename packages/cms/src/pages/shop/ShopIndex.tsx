import type { ShopAppearance, ShopCategory, ShopCollection, ShopProduct, ShopPublicSettings, } from '@sitesurge/types';
import { A, useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, lazy, onCleanup, onMount, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import { siteName, } from '../../stores/siteSettings';
import MerchandiseSignup from './MerchandiseSignup';
import ProductCard from './ProductCard';
import ShopStoreGuard from './ShopStoreGuard';
import { useOverridePageSettings, } from '../../hooks/useOverridePageSettings';
import DynamicPage from '../DynamicPage';
import { loadShopSettings, storeEnabled, storefrontMode, } from '../../stores/shopSettings';

const NotFoundPage = lazy(() => import('../NotFound'));
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
    let filterBarEl: HTMLDivElement | undefined;

    /**
     * Keep the sticky mobile filter pinned directly BELOW the site header.
     *
     * A fixed offset can't work: the header may be static (scrolls away),
     * sticky (always there), or sticky + auto-hide (slides out on scroll-down
     * and back on scroll-up). Guessing wrong means either a permanent gap or —
     * worse — the header covering the dropdown.
     *
     * So this reads the header's LIVE bottom edge and clamps it at zero, which
     * happens to give the right answer for all three cases with one expression:
     * a static header scrolled past reports a negative bottom (→ 0), a sticky
     * one reports its height, and an auto-hidden one reports ~0 as it slides
     * away. Written to a CSS custom property so the `top` stays in CSS.
     */
    onMount(() => {
        const header = document.querySelector('.layout > header, header.header',);
        if (!header) return;

        let frame = 0;
        const sync = () => {
            frame = 0;
            if (!filterBarEl) return;
            const bottom = Math.max(0, header.getBoundingClientRect().bottom,);
            filterBarEl.style.setProperty('--shop-filter-top', `${bottom}px`,);
        };
        // rAF-coalesced: scroll fires far more often than the browser paints,
        // and this only needs to be right once per frame.
        const schedule = () => { if (!frame) frame = requestAnimationFrame(sync,); };

        /**
         * An auto-hiding header slides in and out over a TRANSITION, so the
         * value is still moving after the scroll event that triggered it.
         * Syncing on scroll alone caught it mid-animation and then stopped,
         * leaving the bar pinned to a stale offset — i.e. underneath the
         * header, which is the exact bug this whole effect exists to avoid.
         *
         * `transitionend` gives the settled value precisely. The short trailing
         * loop is the fallback for a transition that gets interrupted (scroll
         * up then immediately down) and so never fires one. It is armed by
         * scrolling and stops ~600ms later, so it costs nothing at rest.
         */
        let settle = 0;
        let settleUntil = 0;
        const runSettle = () => {
            sync();
            if (performance.now() < settleUntil) return;
            window.clearInterval(settle,);
            settle = 0;
        };
        const armSettle = () => {
            settleUntil = performance.now() + 600;
            if (!settle) settle = window.setInterval(runSettle, 50,);
        };

        const onScroll = () => { schedule(); armSettle(); };

        sync();
        window.addEventListener('scroll', onScroll, { passive: true, },);
        window.addEventListener('resize', schedule,);
        header.addEventListener('transitionend', sync,);
        onCleanup(() => {
            if (frame) cancelAnimationFrame(frame,);
            if (settle) window.clearInterval(settle,);
            window.removeEventListener('scroll', onScroll,);
            window.removeEventListener('resize', schedule,);
            header.removeEventListener('transitionend', sync,);
        },);
    },);

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
                    <div class="shop-index__mobile-filter" ref={(el,) => { filterBarEl = el; }}>
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
    // Which storefront to render, and whether it renders at all.
    //
    // `page` mode points /shop at the operator's own CMS page. That page is
    // ordinary content, so it stays reachable even with the store CLOSED —
    // closing the store shouldn't take down a marketing page. The built-in
    // grid is the opposite: with the store closed it has nothing to sell, so
    // it 404s.
    const [ready,] = createResource(async () => {
        await loadShopSettings();
        return true;
    },);

    const usesOwnPage = () => storefrontMode() === 'page';

    return (
        <ShopStoreGuard>
            <Show when={ready()} fallback={<div class="shop-store__loading">Loading…</div>}>
                <Show
                    when={usesOwnPage() || storeEnabled()}
                    fallback={<NotFoundPage />}
                >
                    {/* 'page' renders the `shop` CMS page's own blocks;
                        DynamicPage falls back to a not-found state when no such
                        page exists, which is the "otherwise 404" case. */}
                    <Show when={usesOwnPage()} fallback={<ShopIndexInner />}>
                        <DynamicPage slugOverride="shop" />
                    </Show>
                </Show>
            </Show>
        </ShopStoreGuard>
    );
};

export default ShopIndex;
