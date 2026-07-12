import { A, useParams, } from '@solidjs/router';
import type { ShopOrderDetail, } from '@sitesurge/types';
import { Component, createResource, For, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import ShopStoreGuard from './ShopStoreGuard';
import { money, } from './shopFormat';
import './shop.scss';

const ShopOrderConfirmationInner: Component = () => {
    const params = useParams<{ number: string, }>();

    const [order] = createResource(
        () => params.number,
        async (num,) => {
            try {
                return await cms.shop.orders.getByNumber(num,) as ShopOrderDetail;
            } catch {
                return null;
            }
        },
    );

    const download = async (token: string,) => {
        try {
            const { url, } = await cms.shop.orders.downloadUrl(params.number, token,);
            if (url) window.open(url, '_blank', 'noopener',);
        } catch {
            /* ignore */
        }
    };

    return (
        <div class="shop-store shop-order page-wrapper">
            <SeoHead title="Order confirmation" type="website" />
            <Show when={!order.loading} fallback={<div class="shop-store__loading">Loading…</div>}>
                <Show
                    when={order()}
                    fallback={
                        <div class="shop-store__not-found">
                            <h1>Order not found</h1>
                            <A href="/shop" class="btn btn--primary">Back to shop</A>
                        </div>
                    }
                >
                    {(o,) => (
                        <>
                            <header class="page-header shop-store__header">
                                <h1>Thank you!</h1>
                                <p>
                                    Order <strong>{o().orderNumber}</strong> — status{' '}
                                    <span class={`shop-order__status shop-order__status--${o().status}`}>{o().status}</span>
                                </p>
                            </header>

                            <div class="shop-order__items">
                                <For each={o().items}>
                                    {(item,) => (
                                        <div class="shop-order__item">
                                            <div class="shop-order__item-info">
                                                <span class="shop-order__item-title">{item.title}</span>
                                                <Show when={item.variantTitle}>
                                                    <span class="shop-order__item-variant">{item.variantTitle}</span>
                                                </Show>
                                                <span class="shop-order__item-qty">Qty: {item.quantity}</span>
                                                <Show when={item.isDigital && item.downloadToken && (o().status === 'paid' || o().status === 'delivered')}>
                                                    <button
                                                        type="button"
                                                        class="shop-order__download"
                                                        onClick={() => download(item.downloadToken!,)}
                                                    >
                                                        Download
                                                    </button>
                                                </Show>
                                            </div>
                                            <span class="shop-order__item-price">{money(item.subtotalCents, o().currency,)}</span>
                                        </div>
                                    )}
                                </For>
                            </div>

                            <div class="shop-order__totals">
                                <div class="shop-order__total-row">
                                    <span>Subtotal</span>
                                    <span>{money(o().subtotalCents, o().currency,)}</span>
                                </div>
                                <div class="shop-order__total-row">
                                    <span>Shipping</span>
                                    <span>{money(o().shippingCents, o().currency,)}</span>
                                </div>
                                <div class="shop-order__total-row">
                                    <span>Tax</span>
                                    <span>{money(o().taxCents, o().currency,)}</span>
                                </div>
                                <div class="shop-order__total-row shop-order__total-row--grand">
                                    <span>Total</span>
                                    <strong>{money(o().totalCents, o().currency,)}</strong>
                                </div>
                            </div>

                            <Show when={o().shippingAddress}>
                                {(addr,) => (
                                    <div class="shop-order__address">
                                        <h2>Shipping to</h2>
                                        <p>
                                            <Show when={addr().name}>{addr().name}<br /></Show>
                                            <Show when={addr().line1}>{addr().line1}<br /></Show>
                                            <Show when={addr().line2}>{addr().line2}<br /></Show>
                                            <Show when={addr().city || addr().state || addr().postalCode}>
                                                {[addr().city, addr().state, addr().postalCode,].filter(Boolean,).join(', ',)}<br />
                                            </Show>
                                            <Show when={addr().country}>{addr().country}</Show>
                                        </p>
                                    </div>
                                )}
                            </Show>

                            <A href="/shop" class="btn btn--secondary">Continue shopping</A>
                        </>
                    )}
                </Show>
            </Show>
        </div>
    );
};

const ShopOrderConfirmation: Component = () => (
    <ShopStoreGuard>
        <ShopOrderConfirmationInner />
    </ShopStoreGuard>
);

export default ShopOrderConfirmation;
