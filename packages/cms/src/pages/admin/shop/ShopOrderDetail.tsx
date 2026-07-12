import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, Show, } from 'solid-js';
import type {
    ShopAddress,
    ShopFulfillmentStatus,
    ShopOrderDetail as OrderDetail,
    ShopOrderStatus,
} from '@sitesurge/types';
import { FormField, } from '../../../components/admin/forms';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import { getStatusBadgeClass, } from '../../../utils/badges';
import ShopGuard from './ShopGuard';
import { formatCents, formatDate, } from './shopUtils';

const ORDER_STATUSES: ShopOrderStatus[] = [
    'pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded',
];
const FULFILLMENT_STATUSES: ShopFulfillmentStatus[] = ['unfulfilled', 'partial', 'fulfilled',];

function AddressBlock(props: { title: string; address?: ShopAddress | null; },) {
    return (
        <div class="shop-order__address">
            <h3>{props.title}</h3>
            <Show when={props.address} fallback={<p class="form-help-muted">—</p>}>
                <p>
                    {props.address!.name}<br />
                    {props.address!.line1}<Show when={props.address!.line2}>, {props.address!.line2}</Show><br />
                    {props.address!.city}{props.address!.state ? `, ${props.address!.state}` : ''} {props.address!.postalCode}<br />
                    {props.address!.country}
                    <Show when={props.address!.phone}><br />{props.address!.phone}</Show>
                </p>
            </Show>
        </div>
    );
}

const ShopOrderDetailInner: Component = () => {
    const params = useParams();
    const toast = useToast();

    const [order, { mutate, },] = createResource(
        () => params.id,
        async (id,) => {
            try { return await cms.shop.orders.get(id,); } catch { return null; }
        },
    );

    const [status, setStatus,] = createSignal<ShopOrderStatus>('pending',);
    const [fulfillment, setFulfillment,] = createSignal<ShopFulfillmentStatus>('unfulfilled',);
    const [tracking, setTracking,] = createSignal('',);
    const [notes, setNotes,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);

    // sync local editable fields when the order loads / changes
    const sync = (o: OrderDetail,) => {
        setStatus(o.status,);
        setFulfillment(o.fulfillmentStatus,);
        setTracking(o.trackingNumber || '',);
        setNotes(o.notes || '',);
    };
    createEffect(() => {
        const o = order();
        if (o) sync(o,);
    },);

    const applyUpdate = async (extra?: Partial<{ status: ShopOrderStatus; notifyCustomer: boolean; }>,) => {
        const o = order();
        if (!o) return;
        setBusy(true,);
        try {
            const updated = await cms.shop.orders.update(o.id, {
                status: extra?.status ?? status(),
                fulfillmentStatus: fulfillment(),
                trackingNumber: tracking() || null,
                notes: notes() || null,
                notifyCustomer: extra?.notifyCustomer,
            },);
            mutate(updated,);
            sync(updated,);
            toast.success('Order updated.',);
        } catch {
            /* error bus */
        } finally {
            setBusy(false,);
        }
    };

    // The "Save changes" button: prompt to notify the buyer only when the
    // status is actually changing (tracking/notes/fulfillment-only saves
    // don't prompt).
    const saveChanges = () => {
        const o = order();
        if (!o) return;
        const statusChanged = status() !== o.status;
        const notifyCustomer = statusChanged
            ? confirm('Email the customer about this status change?',)
            : false;
        void applyUpdate({ notifyCustomer, },);
    };

    const refund = async () => {
        if (!confirm('Mark this order as refunded? Issue the actual refund in Stripe separately.',)) return;
        setStatus('refunded',);
        await applyUpdate({ status: 'refunded', },);
    };

    const resendReceipt = async () => {
        const o = order();
        if (!o) return;
        try {
            await cms.shop.orders.resendReceipt(o.id,);
            toast.success('Receipt resent.',);
        } catch {
            /* error bus */
        }
    };

    return (
        <div class="shop-admin shop-order">
            <Title>Order - Admin - RW</Title>
            <Show when={order()} fallback={<div class="empty-state">Loading order...</div>}>
                {(o,) => (
                        <>
                            <div class="admin-header">
                                <div>
                                    <A href="/admin/shop/orders" class="table-link">&larr; Orders</A>
                                    <h1>Order {o().orderNumber}</h1>
                                </div>
                                <span class={`badge ${getStatusBadgeClass(o().status,)}`}>{o().status}</span>
                            </div>

                            <div class="shop-order__grid">
                                <div class="shop-order__main">
                                    <h3>Items</h3>
                                    <div class="admin-table-container">
                                        <table class="admin-table">
                                            <thead>
                                                <tr>
                                                    <th>Item</th>
                                                    <th>SKU</th>
                                                    <th>Qty</th>
                                                    <th>Price</th>
                                                    <th>Subtotal</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <For each={o().items}>
                                                    {(it,) => (
                                                        <tr>
                                                            <td>
                                                                {it.title}
                                                                <Show when={it.variantTitle}>
                                                                    <span class="form-help-muted"> — {it.variantTitle}</span>
                                                                </Show>
                                                            </td>
                                                            <td class="form-help-muted">{it.sku || '—'}</td>
                                                            <td>{it.quantity}</td>
                                                            <td>{formatCents(it.unitPriceCents, o().currency,)}</td>
                                                            <td>{formatCents(it.subtotalCents, o().currency,)}</td>
                                                        </tr>
                                                    )}
                                                </For>
                                            </tbody>
                                        </table>
                                    </div>

                                    <div class="shop-order__totals">
                                        <div><span>Subtotal</span><span>{formatCents(o().subtotalCents, o().currency,)}</span></div>
                                        <div><span>Shipping</span><span>{formatCents(o().shippingCents, o().currency,)}</span></div>
                                        <div><span>Tax</span><span>{formatCents(o().taxCents, o().currency,)}</span></div>
                                        <Show when={o().discountCents > 0}>
                                            <div><span>Discount</span><span>-{formatCents(o().discountCents, o().currency,)}</span></div>
                                        </Show>
                                        <div class="shop-order__totals-grand">
                                            <span>Total</span><span>{formatCents(o().totalCents, o().currency,)}</span>
                                        </div>
                                    </div>

                                    <div class="shop-order__addresses">
                                        <AddressBlock title="Shipping" address={o().shippingAddress} />
                                        <AddressBlock title="Billing" address={o().billingAddress} />
                                    </div>
                                </div>

                                <aside class="shop-order__side">
                                    <div class="shop-order__panel">
                                        <h3>Customer</h3>
                                        <p>{o().customerName || '—'}</p>
                                        <p>
                                            <a href={`mailto:${o().customerEmail}?subject=Order ${o().orderNumber}`} class="table-link">
                                                {o().customerEmail}
                                            </a>
                                        </p>
                                        <p class="form-help-muted">Placed {formatDate(o().createdAt,)}</p>
                                    </div>

                                    <div class="shop-order__panel">
                                        <h3>Manage</h3>
                                        <FormField label="Status" inline>
                                            <select value={status()} onChange={(e,) => setStatus(e.currentTarget.value as ShopOrderStatus,)}>
                                                <For each={ORDER_STATUSES}>{(s,) => <option value={s}>{s}</option>}</For>
                                            </select>
                                        </FormField>
                                        <FormField label="Fulfillment" inline>
                                            <select value={fulfillment()} onChange={(e,) => setFulfillment(e.currentTarget.value as ShopFulfillmentStatus,)}>
                                                <For each={FULFILLMENT_STATUSES}>{(s,) => <option value={s}>{s}</option>}</For>
                                            </select>
                                        </FormField>
                                        <FormField label="Tracking number">
                                            <input type="text" value={tracking()} onInput={(e,) => setTracking(e.currentTarget.value,)} />
                                        </FormField>
                                        <FormField label="Notes">
                                            <textarea rows={3} value={notes()} onInput={(e,) => setNotes(e.currentTarget.value,)} />
                                        </FormField>
                                        <button class="btn btn--primary" onClick={saveChanges} disabled={busy()}>
                                            {busy() ? 'Saving...' : 'Save changes'}
                                        </button>
                                    </div>

                                    <div class="shop-order__panel">
                                        <h3>Actions</h3>
                                        <button class="btn btn--secondary btn--small" onClick={resendReceipt}>Resend receipt</button>
                                        <button class="btn btn--danger btn--small" onClick={refund} disabled={o().status === 'refunded'}>
                                            Refund
                                        </button>
                                    </div>
                                </aside>
                            </div>
                        </>
                )}
            </Show>
        </div>
    );
};

const ShopOrderDetail: Component = () => (
    <ShopGuard>
        <ShopOrderDetailInner />
    </ShopGuard>
);

export default ShopOrderDetail;
