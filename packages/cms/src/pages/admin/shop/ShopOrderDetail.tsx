import { A, useParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, Show, } from 'solid-js';
import type {
    ShopAddress,
    ShopFulfillmentStatus,
    ShopOrderDetail as OrderDetail,
    ShopOrderFulfilment,
    ShopOrderStatus,
} from '@sitesurge/types';
import { FormField, } from '../../../components/admin/forms';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import { getStatusBadgeClass, } from '../../../utils/badges';
import ShopGuard from './ShopGuard';
import { formatCents, formatDate, } from './shopUtils';
import ConfirmModal from '../../../components/admin/common/ConfirmModal';
import OrderTotals from '../../../components/shop/OrderTotals';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import CommitInput from '../../../components/admin/gallery/CommitInput';
import OrderTracking from '../../../components/shop/OrderTracking';
import { carrierLabel, DEFAULT_CARRIER_TRACKING_TEMPLATES, } from '@sitesurge/types';

/** Settable from the Status select. `refunded` is deliberately absent: moving
 *  an order there sends money back through Stripe, so it is the Refund
 *  button's job (with its own confirmation and permission). */
const ORDER_STATUSES: ShopOrderStatus[] = [
    'pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled',
];

/** Plain words for a supplier row status. */
const FULFILMENT_LABELS: Record<string, string> = {
    not_sent: 'Not sent',
    pending: 'Pending',
    submitting: 'Sending…',
    submitted: 'Sent',
    failed: 'Failed',
    on_hold: 'On hold',
    in_production: 'In production',
    partially_shipped: 'Partly shipped',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled by supplier',
};
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

    const [order, { mutate, refetch: refetchOrder, },] = createResource(
        () => params.id,
        async (id,) => {
            try { return await cms.shop.orders.get(id,); } catch { return null; }
        },
    );

    const [shopCfg] = createResource(async () => {
        try { return await cms.shop.settings.getPublic(); } catch { return null; }
    },);

    // Per-supplier hand-off (what the "awaiting Printify" alert counts).
    const [fulfilments, { refetch: refetchFulfilments, },] = createResource(
        () => params.id,
        async (id,): Promise<ShopOrderFulfilment[]> => {
            try { return await cms.shop.orders.fulfilments(id,); } catch { return []; }
        },
    );
    const [supplierBusy, setSupplierBusy,] = createSignal<string | null>(null,);
    const supplierAction = async (provider: string, kind: 'retry' | 'refresh',) => {
        const o = order();
        if (!o) return;
        setSupplierBusy(`${provider}:${kind}`,);
        try {
            if (kind === 'retry') {
                const r = await cms.shop.orders.retryFulfilment(o.id, provider,);
                if (r.failed.length) toast.error(`${provider}: ${r.failed[0].error}`,);
                else if (r.submitted.length) toast.success(`Sent to ${provider}.`,);
                else toast.info(`${provider} already has this order.`,);
            } else {
                const r = await cms.shop.orders.refreshFulfilment(o.id, provider,);
                if (r.conflict) toast.error(`This order is linked to a different ${provider} order (${r.conflict}).`,);
                else toast.success(r.changed ? `Updated from ${provider}.` : `No change at ${provider}.`,);
            }
            await Promise.all([refetchFulfilments(), refetchOrder(),],);
        } catch {
            /* error bus */
        } finally {
            setSupplierBusy(null,);
        }
    };

    const [status, setStatus,] = createSignal<ShopOrderStatus>('pending',);
    const [fulfillment, setFulfillment,] = createSignal<ShopFulfillmentStatus>('unfulfilled',);
    const [tracking, setTracking,] = createSignal('',);
    const [carrier, setCarrier,] = createSignal('',);
    const [trackingUrl, setTrackingUrl,] = createSignal('',);
    const [notes, setNotes,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);
    const [resending, setResending,] = createSignal(false,);
    const [refundOpen, setRefundOpen,] = createSignal(false,);

    // sync local editable fields when the order loads / changes
    const sync = (o: OrderDetail,) => {
        setStatus(o.status,);
        setFulfillment(o.fulfillmentStatus,);
        setTracking(o.trackingNumber || '',);
        setCarrier(o.carrier || '',);
        setTrackingUrl(o.trackingUrl || '',);
        setNotes(o.notes || '',);
    };
    createEffect(() => {
        const o = order();
        if (o) sync(o,);
    },);

    // Tracking is sent ONLY when an admin changed it: sending it marks the
    // order's tracking as manual, so a supplier sync stops updating it.
    const trackingChanges = (o: OrderDetail,) => {
        const out: { trackingNumber?: string | null; carrier?: string | null; trackingUrl?: string | null; } = {};
        if (tracking().trim() !== (o.trackingNumber ?? '')) out.trackingNumber = tracking().trim() || null;
        if (carrier().trim() !== (o.carrier ?? '')) out.carrier = carrier().trim() || null;
        if (trackingUrl().trim() !== (o.trackingUrl ?? '')) out.trackingUrl = trackingUrl().trim() || null;
        return out;
    };

    const applyUpdate = async (
        extra?: Partial<{ status: ShopOrderStatus; notifyCustomer: boolean; trackingManual: boolean; }>,
    ) => {
        const o = order();
        if (!o) return;
        setBusy(true,);
        try {
            const updated = await cms.shop.orders.update(o.id, {
                status: extra?.status ?? status(),
                fulfillmentStatus: fulfillment(),
                ...trackingChanges(o,),
                ...(extra?.trackingManual !== undefined ? { trackingManual: extra.trackingManual, } : {}),
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

    // The server refunds through Stripe when the order moves to `refunded`
    // (and treats "already refunded in Stripe" as done) — the copy says so.
    const confirmRefund = async () => {
        await applyUpdate({ status: 'refunded', },);
        setRefundOpen(false,);
    };

    const resendReceipt = async () => {
        const o = order();
        if (!o || resending()) return;
        setResending(true,);
        try {
            await cms.shop.orders.resendReceipt(o.id,);
            toast.success('Receipt resent.',);
        } catch {
            /* error bus */
        } finally {
            setResending(false,);
        }
    };

    return (
        <div class="shop-admin shop-order">
            <AdminTitle>Order</AdminTitle>
            <Show when={!order.loading || order.latest} fallback={<div class="empty-state">Loading order...</div>}>
            <Show
                when={order()}
                fallback={
                    <div class="empty-state">
                        <p>Order not found.</p>
                        <A href="/admin/shop/orders" class="table-link">&larr; Back to orders</A>
                    </div>
                }
            >
                {(o,) => (
                        <>
                            <div class="admin-header">
                                <div>
                                    <A href="/admin/shop/orders" class="table-link">&larr; Orders</A>
                                    <h1>Order {o().orderNumber}</h1>
                                </div>
                                <div class="admin-header__actions">
                                    <span class={`badge shop-order__status-badge ${getStatusBadgeClass(o().status,)}`}>{o().status}</span>
                                    <button type="button" class="ui-button ui-button--primary" onClick={saveChanges} disabled={busy()}>
                                        {busy() ? 'Saving...' : 'Save changes'}
                                    </button>
                                </div>
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

                                    <OrderTotals order={o()} shipping={shopCfg()?.settings?.shipping} variant="admin" />

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

                                    <div class="shop-order__panel shop-order__manage">
                                        <h3>Manage</h3>
                                        <div class="admin-form-row">
                                            <FormField label="Status">
                                                <select
                                                    value={status()}
                                                    disabled={o().status === 'refunded'}
                                                    onChange={(e,) => setStatus(e.currentTarget.value as ShopOrderStatus,)}
                                                >
                                                    <For each={ORDER_STATUSES}>{(s,) => <option value={s}>{s}</option>}</For>
                                                    <Show when={o().status === 'refunded'}>
                                                        <option value="refunded">refunded</option>
                                                    </Show>
                                                </select>
                                            </FormField>
                                            <FormField label="Fulfillment">
                                                <select value={fulfillment()} onChange={(e,) => setFulfillment(e.currentTarget.value as ShopFulfillmentStatus,)}>
                                                    <For each={FULFILLMENT_STATUSES}>{(s,) => <option value={s}>{s}</option>}</For>
                                                </select>
                                            </FormField>
                                        </div>
                                        <FormField label="Notes" class="form-field--block">
                                            <textarea rows={3} value={notes()} onInput={(e,) => setNotes(e.currentTarget.value,)} />
                                        </FormField>
                                    </div>

                                    <div class="shop-order__panel shop-order__tracking-panel">
                                        <h3>Tracking</h3>
                                        <Show
                                            when={(o().shipments ?? []).length}
                                            fallback={<p class="form-help-muted">No tracking yet.</p>}
                                        >
                                            <OrderTracking order={o()} showSource />
                                        </Show>
                                        <FormField
                                            label="Carrier"
                                            class="form-field--block"
                                            hint={carrier().trim() && carrierLabel(carrier(),) !== carrier().trim()
                                                ? `Shown as “${carrierLabel(carrier(),)}”`
                                                : undefined}
                                        >
                                            <CommitInput value={carrier()} onCommit={setCarrier} list="shop-order-carriers" placeholder="e.g. USPS" />
                                        </FormField>
                                        <datalist id="shop-order-carriers">
                                            <For each={DEFAULT_CARRIER_TRACKING_TEMPLATES}>
                                                {(t,) => <option value={t.carrier}>{carrierLabel(t.carrier,)}</option>}
                                            </For>
                                        </datalist>
                                        <FormField label="Tracking number" class="form-field--block">
                                            <CommitInput value={tracking()} onCommit={setTracking} />
                                        </FormField>
                                        <FormField
                                            label="Tracking URL"
                                            class="form-field--block"
                                            hint="Empty = the supplier's link, else the carrier template from Shop Settings → Order tracking."
                                        >
                                            <CommitInput value={trackingUrl()} onCommit={setTrackingUrl} type="url" placeholder="https://…" />
                                        </FormField>
                                        <Show
                                            when={o().trackingManual}
                                            fallback={<p class="form-help-muted">Editing these marks them as manual, so a supplier sync won't change them.</p>}
                                        >
                                            <p class="form-help-muted">Entered by hand — a supplier sync won't change these.</p>
                                            <button
                                                type="button"
                                                class="ui-button ui-button--secondary ui-button--sm"
                                                disabled={busy()}
                                                onClick={() => void applyUpdate({ trackingManual: false, },)}
                                            >
                                                Let the supplier sync update tracking
                                            </button>
                                        </Show>
                                    </div>

                                    <div class="shop-order__panel">
                                        <h3>Actions</h3>
                                        <div class="shop-order__actions">
                                            <button class="ui-button ui-button--secondary ui-button--sm" onClick={resendReceipt} disabled={resending()}>
                                                {resending() ? 'Sending…' : 'Resend receipt'}
                                            </button>
                                            <button
                                                class="ui-button ui-button--danger ui-button--sm"
                                                onClick={() => setRefundOpen(true,)}
                                                disabled={busy() || o().status === 'refunded'}
                                            >
                                                Refund
                                            </button>
                                        </div>
                                    </div>

                                    <Show when={(fulfilments() ?? []).length}>
                                        <div class="shop-order__panel shop-order__fulfilments">
                                            <h3>Suppliers</h3>
                                            <For each={fulfilments()}>
                                                {(f,) => (
                                                    <div class="shop-order__fulfilment">
                                                        <div class="shop-order__fulfilment-head">
                                                            <strong>{f.provider}</strong>
                                                            <span class={`badge ${getStatusBadgeClass(f.status === 'failed' || f.status === 'cancelled' ? 'failed' : f.status,)}`}>
                                                                {FULFILMENT_LABELS[f.status] ?? f.status}
                                                            </span>
                                                        </div>
                                                        <Show when={f.externalOrderId}>
                                                            <p class="form-help-muted">
                                                                Supplier order{' '}
                                                                <Show when={f.externalUrl} fallback={<code>{f.externalOrderId}</code>}>
                                                                    <a href={f.externalUrl!} target="_blank" rel="noopener" class="table-link">
                                                                        <code>{f.externalOrderId}</code>
                                                                    </a>
                                                                </Show>
                                                                <Show when={f.externalStatus}> · {f.externalStatus}</Show>
                                                            </p>
                                                        </Show>
                                                        <Show when={f.lastError}>
                                                            <p class="shop-order__fulfilment-error">{f.lastError}</p>
                                                        </Show>
                                                        <p class="form-help-muted">
                                                            {f.attempts} attempt{f.attempts === 1 ? '' : 's'}
                                                            <Show when={f.submittedAt}> · sent {formatDate(f.submittedAt!,)}</Show>
                                                            <Show when={f.lastSyncedAt}> · synced {formatDate(f.lastSyncedAt!,)}</Show>
                                                        </p>
                                                        <div class="shop-order__actions">
                                                            <Show when={!f.externalOrderId}>
                                                                <button
                                                                    type="button"
                                                                    class="ui-button ui-button--secondary ui-button--sm"
                                                                    disabled={supplierBusy() !== null}
                                                                    onClick={() => void supplierAction(f.provider, 'retry',)}
                                                                >
                                                                    {supplierBusy() === `${f.provider}:retry` ? 'Sending…' : 'Retry submission'}
                                                                </button>
                                                            </Show>
                                                            <Show when={f.externalOrderId}>
                                                                <button
                                                                    type="button"
                                                                    class="ui-button ui-button--secondary ui-button--sm"
                                                                    disabled={supplierBusy() !== null}
                                                                    onClick={() => void supplierAction(f.provider, 'refresh',)}
                                                                >
                                                                    {supplierBusy() === `${f.provider}:refresh` ? 'Refreshing…' : 'Refresh from supplier'}
                                                                </button>
                                                            </Show>
                                                        </div>
                                                    </div>
                                                )}
                                            </For>
                                        </div>
                                    </Show>
                                </aside>
                            </div>

                            <ConfirmModal
                                open={refundOpen()}
                                title="Refund this order?"
                                message={`Refund the full amount (${formatCents(o().totalCents, o().currency,)}) to the customer's card through Stripe? This cannot be undone.`}
                                confirmLabel="Refund"
                                busyLabel="Refunding…"
                                loading={busy()}
                                danger
                                onConfirm={() => void confirmRefund()}
                                onCancel={() => setRefundOpen(false,)}
                            />
                        </>
                )}
            </Show>
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
