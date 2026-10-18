import { A, useParams, useSearchParams, } from '@solidjs/router';
import NotFoundPage from '../NotFound';
import type { ShopOrderDetail, } from '@sitesurge/types';
import { Component, createEffect, createResource, createSignal, For, onCleanup, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import ShopStoreGuard from './ShopStoreGuard';
import { money, } from './shopFormat';
import OrderTotals from '../../components/shop/OrderTotals';
import { useToast, } from '../../components/common/toast';
import OrderTracking from '../../components/shop/OrderTracking';
import './shop.scss';

/**
 * Statuses that need no further waiting. Anything else (notably `pending`) is
 * a payment the webhook has not confirmed yet, so the page keeps checking.
 */
const SETTLED_STATUSES = new Set(['paid', 'delivered', 'shipped', 'fulfilled', 'refunded', 'cancelled', 'failed',],);

/** Buyer-facing words for an order status. */
const STATUS_LABELS: Record<string, string> = {
    pending: 'Awaiting payment',
    paid: 'Confirmed',
    processing: 'Being prepared',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
    failed: 'Payment failed',
};

/** How often to re-check an unsettled order, and for how long before giving up. */
const POLL_MS = 4000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

const ShopOrderConfirmationInner: Component = () => {
    const params = useParams<{ number: string, }>();
    const [search,] = useSearchParams<{ k?: string; }>();
    const toast = useToast();
    // The access key from the post-checkout redirect / the confirmation email:
    // without it the page shows status, items and tracking, but not the
    // buyer's details or their downloads.
    const accessKey = () => (typeof search.k === 'string' ? search.k : undefined);

    const [order, { refetch, },] = createResource(
        () => params.number,
        async (num,) => {
            try {
                // `cache: false`: the SWR cache would otherwise serve the same
                // stale `pending` order to every poll.
                return await cms.shop.orders.getByNumber(num, { cache: false, }, accessKey(),) as ShopOrderDetail;
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

    const [downloading, setDownloading,] = createSignal<string | null>(null,);
    const download = async (o: ShopOrderDetail, token: string, itemId: string,) => {
        setDownloading(itemId,);
        try {
            const { url, } = await cms.shop.orders.downloadUrl(o.orderNumber, token,);
            window.location.assign(url,);
        } catch {
            toast.error('That download is not available. Contact us with your order number.',);
        } finally {
            setDownloading(null,);
        }
    };

    return (
        <div class="shop-store shop-order page-wrapper">
            <SeoHead title="Order confirmation" type="website" />
            {/* Gate on the FIRST load only: each poll's refetch sets `loading`,
                and gating on it replaced the whole page with "Loading…" every 4 s. */}
            <Show when={order.state !== 'pending' && order.state !== 'unresolved'} fallback={<div class="shop-store__loading">Loading…</div>}>
                <Show
                    when={order.latest}
                    fallback={
                        <NotFoundPage title="Order not found" message="Check the order number from your confirmation email." link={{ href: "/shop", label: "Back to the shop", }} />
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
                                            {STATUS_LABELS[o().status] ?? o().status}
                                        </span>
                                        <Show when={!SETTLED_STATUSES.has(o().status,)}>
                                            <span class="shop-order__status-wait">
                                                Confirming your payment…
                                            </span>
                                        </Show>
                                    </p>
                                    <a
                                        class="btn btn--secondary shop-order__receipt"
                                        href={cms.shop.orders.receiptUrl(o().orderNumber, accessKey(),)}
                                        target="_blank"
                                        rel="noopener"
                                    >
                                        Download receipt
                                    </a>
                                </div>
                                <OrderTracking order={o()} label="Tracking" class="shop-order__tracking" />
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
                                            </div>
                                            <span class="shop-order__item-price">{money(item.subtotalCents, o().currency,)}</span>
                                            <Show when={item.isDigital && item.downloadToken}>
                                                <button
                                                    type="button"
                                                    class="shop-order__download"
                                                    disabled={downloading() === item.id}
                                                    onClick={() => void download(o(), item.downloadToken!, item.id,)}
                                                >
                                                    {downloading() === item.id ? 'Preparing…' : 'Download'}
                                                </button>
                                            </Show>
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

                                <OrderTotals order={o()} shipping={shopCfg()?.settings?.shipping} variant="store" />
                            </div>

                            <Show when={o().items.some((i,) => i.isDigital,) && !o().items.some((i,) => i.downloadToken,)}>
                                <p class="shop-order__download-hint">
                                    Your downloads are on the order link in your confirmation email.
                                </p>
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
