import { A, } from '@solidjs/router';
import type { ShopProduct, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import SoldOutOverlay from './SoldOutOverlay';
import StarRating from './StarRating';
import { money, stockLabel, } from './shopFormat';

interface ProductCardProps {
    product: ShopProduct;
    /** appearance: card style variant ('standard' | 'minimal' | …) */
    cardStyle?: string;
    /** appearance: whether to show the star rating */
    showRatings?: boolean;
    /** appearance: show units in stock (`product.inventoryTotal`) */
    showInventory?: boolean;
    /** display currency for any price shown */
    currency?: string;
    /** optional starting price (cents). List rows carry this as
     *  `product.fromPriceCents` (min active-variant price); callers pass it
     *  through. When absent the card shows "View for price". */
    priceCents?: number | null;
    /** optional image url. List rows carry this as `product.primaryImageUrl`
     *  (position-0 image); callers pass it through. */
    image?: string | null;
}

/**
 * Storefront product card. DRY'd across the index / collection / category
 * grids. Links to the product detail page by slug. Falls back gracefully
 * when the list DTO lacks price/image (which the public list currently
 * does — price + media live on ShopProductDetail).
 */
const ProductCard: Component<ProductCardProps> = (props,) => {
    return (
        <A
            href={`/shop/${props.product.slug}`}
            class={`shop-card shop-card--${props.cardStyle || 'standard'}`}
        >
            <div class="shop-card__media">
                <Show
                    when={props.image}
                    fallback={<div class="shop-card__media-placeholder" aria-hidden="true">🛍</div>}
                >
                    <img src={props.image!} alt={props.product.title} loading="lazy" />
                </Show>
                {/* Every variant is out of stock (shown whatever the inventory-count setting). */}
                <Show when={props.product.inventoryTotal === 0}>
                    <SoldOutOverlay />
                </Show>
            </div>
            <div class="shop-card__body">
                <h3 class="shop-card__title">{props.product.title}</h3>
                <Show when={props.showRatings && props.product.ratingCount > 0}>
                    <div class="shop-card__rating">
                        <StarRating
                            value={props.product.ratingAvg}
                            count={props.product.ratingCount}
                            showCount
                        />
                    </div>
                </Show>
                {/* Price (left) + stock count (right) share one row, half each. */}
                <div class="shop-card__price-row">
                    <div class="shop-card__price">
                        <Show
                            when={props.priceCents != null}
                            fallback={<span class="shop-card__price-cta">View for price</span>}
                        >
                            <span class="shop-card__price-from">From</span> {money(props.priceCents!, props.currency,)}
                        </Show>
                    </div>
                    <Show when={props.showInventory && props.product.inventoryTotal != null}>
                        <div
                            class="shop-card__stock"
                            classList={{ 'shop-card__stock--out': !(props.product.inventoryTotal! > 0), }}
                        >
                            {stockLabel(props.product.inventoryTotal!,)}
                        </div>
                    </Show>
                </div>
            </div>
        </A>
    );
};

export default ProductCard;
