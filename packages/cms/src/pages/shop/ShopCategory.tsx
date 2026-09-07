import { useParams, } from '@solidjs/router';
import type { ShopAppearance, ShopCategory, ShopProduct, ShopPublicSettings, } from '@sitesurge/types';
import { Component, createResource, For, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import ProductCard from './ProductCard';
import ShopStoreGuard from './ShopStoreGuard';
import { isShopifyActive, shopifySource, } from '../../services/shopifySource';
import './shop.scss';

interface Config {
    settings: ShopPublicSettings;
    appearance: ShopAppearance;
}

const ShopCategoryInner: Component = () => {
    const params = useParams();

    const [config] = createResource<Config | null>(async () => {
        try {
            return await cms.shop.settings.getPublic();
        } catch {
            return null;
        }
    },);

    const [result] = createResource(
        () => params.slug,
        async (slug,) => {
            try {
                if (isShopifyActive()) {
                    // Shopify has no "categories" — treat the slug as a collection handle.
                    const r = await shopifySource.getCollection(slug,);
                    if (!r?.ok || !r.collection) return null;
                    const c = r.collection;
                    const category: ShopCategory = {
                        id: c.id, name: c.title, slug: c.slug, parentId: null,
                        description: c.description ?? null, imageId: null, position: c.position,
                        createdAt: c.createdAt, updatedAt: c.updatedAt,
                    };
                    return { category, products: r.products, };
                }
                return await cms.shop.categories.getBySlug(slug,);
            } catch {
                return null;
            }
        },
    );

    const appearance = (): ShopAppearance =>
        config()?.appearance ?? { gridColumns: 3, showRatings: true, cardStyle: 'standard', };
    const currency = () => config()?.settings.currency || 'USD';
    const category = (): ShopCategory | undefined => result()?.category;
    const products = (): ShopProduct[] => result()?.products ?? [];

    const gridStyle = () => ({ '--shop-grid-columns': String(appearance().gridColumns || 3,), });

    return (
        <div class="shop-store shop-category page-wrapper">
            <Show when={!result.loading} fallback={<div class="shop-store__loading">Loading…</div>}>
                <Show
                    when={category()}
                    fallback={
                        <div class="shop-store__not-found">
                            <h1>Category not found</h1>
                        </div>
                    }
                >
                    {(c,) => (
                        <>
                            <SeoHead
                                title={c().name}
                                description={c().description || `${c().name} products`}
                                canonical={`${window.location.origin}/shop/categories/${c().slug}`}
                                type="website"
                            />
                            <header class="page-header shop-store__header">
                                <h1>{c().name}</h1>
                                <Show when={c().description}>
                                    <p>{c().description}</p>
                                </Show>
                            </header>
                            <Show
                                when={products().length > 0}
                                fallback={<div class="shop-store__empty">No products in this category.</div>}
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
                            </Show>
                        </>
                    )}
                </Show>
            </Show>
        </div>
    );
};

const ShopCategoryPage: Component = () => (
    <ShopStoreGuard requireStoreEnabled>
        <ShopCategoryInner />
    </ShopStoreGuard>
);

export default ShopCategoryPage;
