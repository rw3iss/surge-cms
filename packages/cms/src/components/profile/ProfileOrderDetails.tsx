/**
 * Profile → Orders: one order's items (with a Download button per digital
 * item) and its totals, loaded when the buyer opens the row.
 *
 * The list rows carry no items, so the detail comes from `GET /shop/orders/:id`
 * — the owner's view, which includes each digital item's download token. The
 * totals use the shared `OrderTotals` (the same rows as the confirmation page,
 * the admin and the emails).
 */
import type { ShopOrderDetail, ShopSettingsPublicResponse, } from '@sitesurge/types';
import { formatCurrency, } from '@sitesurge/types';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { useToast, } from '../common/toast';
import OrderTotals from '../shop/OrderTotals';

const ProfileOrderDetails: Component<{
    orderId: string;
    /** Public shop settings (shipping breakdown for the totals); shared by every row. */
    shopSettings?: ShopSettingsPublicResponse | null;
}> = (props,) => {
    const toast = useToast();
    const [order,] = createResource(
        () => props.orderId,
        async (id,): Promise<ShopOrderDetail | null> => {
            try {
                return await cms.shop.orders.get(id,);
            } catch {
                return null;
            }
        },
    );

    const [downloading, setDownloading,] = createSignal<string | null>(null,);
    const download = async (orderNumber: string, token: string, itemId: string,) => {
        setDownloading(itemId,);
        try {
            const { url, } = await cms.shop.orders.downloadUrl(orderNumber, token,);
            window.location.assign(url,);
        } catch {
            toast.error('That download is not available. Contact us with your order number.',);
        } finally {
            setDownloading(null,);
        }
    };

    return (
        <div class="profile__order-details">
            <Show when={!order.loading} fallback={<p class="profile__muted">Loading…</p>}>
                <Show when={order()} fallback={<p class="profile__muted">This order could not be loaded.</p>}>
                    {(o,) => (
                        <>
                            <ul class="profile__order-items">
                                <For each={o().items}>
                                    {(item,) => (
                                        <li class="profile__order-item">
                                            <div class="profile__order-item-info">
                                                <span class="profile__order-item-title">{item.title}</span>
                                                <Show when={item.variantTitle}>
                                                    <span class="profile__order-item-sub">{item.variantTitle}</span>
                                                </Show>
                                                <span class="profile__order-item-sub">Qty: {item.quantity}</span>
                                            </div>
                                            <div class="profile__order-item-end">
                                                <span>{formatCurrency(item.subtotalCents, o().currency,)}</span>
                                                <Show when={item.isDigital && item.downloadToken}>
                                                    <button
                                                        type="button"
                                                        class="profile__order-download"
                                                        disabled={downloading() === item.id}
                                                        onClick={() => void download(o().orderNumber, item.downloadToken!, item.id,)}
                                                    >
                                                        {downloading() === item.id ? 'Preparing…' : 'Download'}
                                                    </button>
                                                </Show>
                                            </div>
                                        </li>
                                    )}
                                </For>
                            </ul>
                            <OrderTotals order={o()} shipping={props.shopSettings?.settings?.shipping} variant="store" />
                        </>
                    )}
                </Show>
            </Show>
        </div>
    );
};

export default ProfileOrderDetails;
