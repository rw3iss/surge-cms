import { A, } from '@solidjs/router';
import type { ShopProduct, } from '@rw/cms-shared';
import { Component, Show, } from 'solid-js';
import StarRating from './StarRating';
import { money, } from './shopFormat';

interface ProductCardProps {
    product: ShopProduct;
    /** appearance: card style variant ('standard' | 'minimal' | …) */
    cardStyle?: string;
    /** appearance: whether to show the star rating */
    showRatings?: boolean;
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
                <div class="shop-card__price">
                    <Show
                        when={props.priceCents != null}
                        fallback={<span class="shop-card__price-cta">View for price</span>}
                    >
                        <span class="shop-card__price-from">From</span> {money(props.priceCents!, props.currency,)}
                    </Show>
                </div>
            </div>
        </A>
    );
};

export default ProductCard;
