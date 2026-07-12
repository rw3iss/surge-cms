import { useParams, } from '@solidjs/router';
import type { ShopAppearance, ShopCollection, ShopProduct, ShopPublicSettings, } from '@sitesurge/types';
import { Component, createResource, For, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import ProductCard from './ProductCard';
import ShopStoreGuard from './ShopStoreGuard';
import './shop.scss';

interface Config {
    settings: ShopPublicSettings;
    appearance: ShopAppearance;
}

const ShopCollectionInner: Component = () => {
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
                return await cms.shop.collections.getBySlug(slug,);
            } catch {
                return null;
            }
        },
    );

    const appearance = (): ShopAppearance =>
        config()?.appearance ?? { gridColumns: 3, showRatings: true, cardStyle: 'standard', };
    const currency = () => config()?.settings.currency || 'USD';
    const collection = (): ShopCollection | undefined => result()?.collection;
    const products = (): ShopProduct[] => result()?.products ?? [];

    const gridStyle = () => ({ '--shop-grid-columns': String(appearance().gridColumns || 3,), });

    return (
        <div class="shop-store shop-collection page-wrapper">
            <Show when={!result.loading} fallback={<div class="shop-store__loading">Loading…</div>}>
                <Show
                    when={collection()}
                    fallback={
                        <div class="shop-store__not-found">
                            <h1>Collection not found</h1>
                        </div>
                    }
                >
                    {(c,) => (
                        <>
                            <SeoHead
                                title={c().title}
                                description={c().description || `${c().title} collection`}
                                canonical={`${window.location.origin}/shop/collections/${c().slug}`}
                                type="website"
                            />
                            <header class="page-header shop-store__header">
                                <h1>{c().title}</h1>
                                <Show when={c().description}>
                                    <p>{c().description}</p>
                                </Show>
                            </header>
                            <Show
                                when={products().length > 0}
                                fallback={<div class="shop-store__empty">No products in this collection.</div>}
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

const ShopCollectionPage: Component = () => (
    <ShopStoreGuard>
        <ShopCollectionInner />
    </ShopStoreGuard>
);

export default ShopCollectionPage;
