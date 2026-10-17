/**
 * An order's parcels: "<Carrier> · <number>" linked to its tracking page (new
 * tab), with shipped / delivered dates. Reads the server-resolved
 * `order.shipments`; an order read without it (older API) falls back to the
 * order-level columns via the same shared rule (`resolveOrderShipments`).
 *
 * Used by the admin order detail + list, the storefront confirmation page and
 * the profile order history.
 */
import { type Component, For, Show, } from 'solid-js';
import { resolveOrderShipments, shipmentText, type ShopOrder, type ShopOrderShipment, } from '@sitesurge/types';
import './OrderTracking.scss';

export function orderShipmentsOf(order: ShopOrder,): ShopOrderShipment[] {
    return order.shipments ?? resolveOrderShipments(order, [],);
}

const fmt = (iso: string,): string =>
    new Date(iso,).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', },);

export interface OrderTrackingProps {
    order: ShopOrder;
    /** One short line per parcel, no dates (tables, lists). */
    compact?: boolean;
    /** Mark parcels an admin typed by hand (admin only). */
    showSource?: boolean;
    /** Text before the list (e.g. "Tracking"). Hidden in compact mode. */
    label?: string;
    class?: string;
}

const OrderTracking: Component<OrderTrackingProps> = (props,) => {
    const shipments = () => orderShipmentsOf(props.order,);
    return (
        <Show when={shipments().length}>
            <div class={`order-tracking${props.compact ? ' order-tracking--compact' : ''} ${props.class ?? ''}`}>
                <Show when={props.label && !props.compact}>
                    <span class="order-tracking__label">{props.label}</span>
                </Show>
                <ul class="order-tracking__list">
                    <For each={shipments()}>
                        {(s,) => (
                            <li class="order-tracking__item">
                                <Show
                                    when={s.url}
                                    fallback={<span class="order-tracking__text">{shipmentText(s,)}</span>}
                                >
                                    <a
                                        class="order-tracking__link"
                                        href={s.url!}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={props.compact ? `Track with ${s.carrierLabel ?? 'the carrier'}` : undefined}
                                        onClick={(e,) => e.stopPropagation()}
                                    >
                                        {shipmentText(s,)}
                                    </a>
                                </Show>
                                <Show when={props.showSource && s.source === 'manual'}>
                                    <span class="order-tracking__badge">manual</span>
                                </Show>
                                <Show when={!props.compact && (s.shippedAt || s.deliveredAt)}>
                                    <span class="order-tracking__dates">
                                        {[
                                            s.shippedAt ? `Shipped ${fmt(s.shippedAt,)}` : '',
                                            s.deliveredAt ? `Delivered ${fmt(s.deliveredAt,)}` : '',
                                        ].filter(Boolean,).join(' · ',)}
                                    </span>
                                </Show>
                            </li>
                        )}
                    </For>
                </ul>
            </div>
        </Show>
    );
};

export default OrderTracking;
