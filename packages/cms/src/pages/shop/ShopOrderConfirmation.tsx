import { A, useParams, } from '@solidjs/router';
import type { ShopOrderDetail, } from '@sitesurge/types';
import { Component, createEffect, createResource, createSignal, For, onCleanup, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import ShopStoreGuard from './ShopStoreGuard';
import { money, shipBreakdown, } from './shopFormat';
import './shop.scss';

/**
 * Statuses that need no further waiting. Anything else (notably `pending`) is
 * a payment the webhook has not confirmed yet, so the page keeps checking.
 */
const SETTLED_STATUSES = new Set(['paid', 'delivered', 'shipped', 'fulfilled', 'refunded', 'cancelled', 'failed',],);

/** How often to re-check an unsettled order, and for how long before giving up. */
const POLL_MS = 4000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

const ShopOrderConfirmationInner: Component = () => {
    const params = useParams<{ number: string, }>();
    const [downloadError, setDownloadError,] = createSignal('',);

    const [order, { refetch, },] = createResource(
        () => params.number,
        async (num,) => {
            try {
                // `cache: false`: the SWR cache would otherwise serve the same
                // stale `pending` order to every poll.
                return await cms.shop.orders.getByNumber(num, { cache: false, },) as ShopOrderDetail;
            } catch {
                return null;
            }
        },
    );

    /**
     * Stripe confirms the payment out of band, so an order that was just paid
     * can still read `pending` when this page first loads — which looked to the
     * buyer like the payment had not gone through until they refreshed.
     *
     * Poll until the status settles, then stop. The timeout matters: without it
     * an order that genuinely stays pending (a failed webhook, an abandoned
     * bank redirect) would poll this endpoint forever in an open tab.
     */
    createEffect(() => {
        const o = order();
        if (!o || SETTLED_STATUSES.has(o.status,)) return;

        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (Date.now() - startedAt > POLL_TIMEOUT_MS) { clearInterval(timer,); return; }
            void refetch();  // fetcher passes cache:false, so this hits the network
        }, POLL_MS,);
        onCleanup(() => clearInterval(timer,),);
    },);

    const [shopCfg] = createResource(async () => {
        try { return await cms.shop.settings.getPublic(); } catch { return null; }
    },);
    const shipBd = (o: ShopOrderDetail,) => {
        const units = o.items.filter((i,) => !i.isDigital).reduce((s, i,) => s + i.quantity, 0,);
        return shipBreakdown(o.shippingCents, units, shopCfg()?.settings?.shipping,);
    };

    /**
     * Resolve a digital item's download.
     *
     * The failure path is shown rather than swallowed: when a product is
     * flagged digital but has no file attached the endpoint 404s, and the old
     * empty `catch` made the button look simply broken.
     */
    const download = async (token: string,) => {
        setDownloadError('',);
        try {
            const { url, } = await cms.shop.orders.downloadUrl(params.number, token,);
            if (url) { window.open(url, '_blank', 'noopener',); return; }
            setDownloadError('That download is not available yet. Please contact us and we\'ll send your file.',);
        } catch {
            setDownloadError('That download is not available yet. Please contact us and we\'ll send your file.',);
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
                                {/* Order + status on the left, receipt on the right of the SAME row. */}
                                <div class="shop-order__headline">
                                    <p class="shop-order__headline-meta">
                                        Order <strong>{o().orderNumber}</strong> — status{' '}
                                        <span class={`shop-order__status shop-order__status--${o().status}`}>
                                            {o().status}
                                        </span>
                                        <Show when={!SETTLED_STATUSES.has(o().status,)}>
                                            <span class="shop-order__status-wait">
                                                Confirming your payment…
                                            </span>
                                        </Show>
                                    </p>
                                    <a
                                        class="btn btn--secondary shop-order__receipt"
                                        href={cms.shop.orders.receiptUrl(o().orderNumber,)}
                                        target="_blank"
                                        rel="noopener"
                                    >
                                        Download receipt
                                    </a>
                                </div>
                                <Show when={o().trackingNumber}>
                                    <p class="shop-order__tracking">
                                        Tracking: {o().carrier ? `${o().carrier} · ` : ''}
                                        <Show when={o().trackingUrl} fallback={<strong>{o().trackingNumber}</strong>}>
                                            <a href={o().trackingUrl!} target="_blank" rel="noopener noreferrer">
                                                {o().trackingNumber}
                                            </a>
                                        </Show>
                                    </p>
                                </Show>
                            </header>

                            <Show when={downloadError()}>
                                <p class="shop-order__download-error">{downloadError()}</p>
                            </Show>

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

                            {/* Shipping address (left) + totals (right) on one row. */}
                            <div class="shop-order__summary-row">
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

                                <div class="shop-order__totals">
                                    <div class="shop-order__total-row">
                                        <span>Subtotal</span>
                                        <span>{money(o().subtotalCents, o().currency,)}</span>
                                    </div>
                                    <div class="shop-order__total-row">
                                        <span>Shipping{o().shippingMethod ? ` (${o().shippingMethod})` : ''}</span>
                                        <span>{money(o().shippingCents, o().currency,)}</span>
                                    </div>
                                    <Show when={shipBd(o(),)}>
                                        {(bd,) => (
                                            <>
                                                <div class="shop-order__total-row shop-order__total-sub">
                                                    <span>First item shipping</span>
                                                    <span>1 × {money(bd().firstItemCents, o().currency,)} = {money(bd().firstItemCents, o().currency,)}</span>
                                                </div>
                                                <div class="shop-order__total-row shop-order__total-sub">
                                                    <span>Additional items shipping</span>
                                                    <span>{bd().additionalUnits} × {money(bd().additionalItemCents, o().currency,)} = {money(bd().additionalItemCents * bd().additionalUnits, o().currency,)}</span>
                                                </div>
                                            </>
                                        )}
                                    </Show>
                                    <div class="shop-order__total-row">
                                        <span>Tax</span>
                                        <span>{money(o().taxCents, o().currency,)}</span>
                                    </div>
                                    <div class="shop-order__total-row shop-order__total-row--grand">
                                        <span>Total</span>
                                        <strong>{money(o().totalCents, o().currency,)}</strong>
                                    </div>
                                </div>
                            </div>

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
