import { A, useNavigate, } from '@solidjs/router';
import { Component, For, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cartItems, cartSubtotal, removeFromCart, updateQty, } from '../../stores/shopCart';
import ShopStoreGuard from './ShopStoreGuard';
import { money, } from './shopFormat';
import './shop.scss';

const ShopCartInner: Component = () => {
    const navigate = useNavigate();

    return (
        <div class="shop-store shop-cart page-wrapper">
            <SeoHead title="Cart" canonical={`${window.location.origin}/shop/cart`} type="website" />
            <header class="page-header shop-store__header">
                <h1>Your Cart</h1>
            </header>

            <Show
                when={cartItems().length > 0}
                fallback={
                    <div class="shop-store__empty">
                        <p>Your cart is empty.</p>
                        <A href="/shop" class="btn btn--primary">Continue shopping</A>
                    </div>
                }
            >
                <div class="shop-cart__lines">
                    <For each={cartItems()}>
                        {(line,) => (
                            <div class="shop-cart__line">
                                <div class="shop-cart__line-media">
                                    <Show
                                        when={line.image}
                                        fallback={<div class="shop-cart__line-placeholder" aria-hidden="true">🛍</div>}
                                    >
                                        <img src={line.image!} alt={line.title} />
                                    </Show>
                                </div>
                                <div class="shop-cart__line-info">
                                    <A href={`/shop/${line.slug}`} class="shop-cart__line-title">{line.title}</A>
                                    <Show when={line.variantTitle}>
                                        <span class="shop-cart__line-variant">{line.variantTitle}</span>
                                    </Show>
                                    <span class="shop-cart__line-price">{money(line.priceCents,)}</span>
                                </div>
                                <div class="shop-cart__line-qty">
                                    <button
                                        type="button"
                                        onClick={() => updateQty(line.variantId, line.qty - 1,)}
                                        aria-label="Decrease quantity"
                                    >
                                        −
                                    </button>
                                    <input
                                        type="number"
                                        min="1"
                                        value={line.qty}
                                        onChange={(e,) => updateQty(line.variantId, parseInt(e.currentTarget.value, 10,) || 1,)}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => updateQty(line.variantId, line.qty + 1,)}
                                        aria-label="Increase quantity"
                                    >
                                        +
                                    </button>
                                </div>
                                <div class="shop-cart__line-subtotal">
                                    {money(line.priceCents * line.qty,)}
                                </div>
                                <button
                                    type="button"
                                    class="shop-cart__line-remove"
                                    onClick={() => removeFromCart(line.variantId,)}
                                    aria-label="Remove item"
                                >
                                    ✕
                                </button>
                            </div>
                        )}
                    </For>
                </div>

                <div class="shop-cart__footer">
                    <div class="shop-cart__subtotal">
                        <span>Subtotal</span>
                        <strong>{money(cartSubtotal(),)}</strong>
                    </div>
                    <p class="shop-cart__note">Shipping and taxes calculated at checkout.</p>
                    <button
                        type="button"
                        class="btn btn--primary shop-cart__checkout"
                        onClick={() => navigate('/shop/checkout',)}
                    >
                        Proceed to Checkout
                    </button>
                </div>
            </Show>
        </div>
    );
};

const ShopCart: Component = () => (
    <ShopStoreGuard>
        <ShopCartInner />
    </ShopStoreGuard>
);

export default ShopCart;
