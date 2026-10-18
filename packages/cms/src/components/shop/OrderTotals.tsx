import { orderTotalsLines, type OrderTotalsInput, type OrderTotalsShipping, } from '@sitesurge/types';
import { type Component, For, } from 'solid-js';

/**
 * An order's totals — subtotal, shipping (+ first / additional breakdown),
 * tax, discount, total — from the ONE shared definition (`orderTotalsLines`),
 * so the admin order page, the storefront confirmation and the profile order
 * history can no longer disagree (the storefront used to drop Discount).
 *
 * `variant` only picks the class names each surface already styles.
 */
const OrderTotals: Component<{
    order: OrderTotalsInput;
    shipping?: OrderTotalsShipping | null;
    variant?: 'store' | 'admin';
    class?: string;
}> = (props,) => {
    const lines = () => orderTotalsLines(props.order, props.shipping,);
    const rowClass = (l: ReturnType<typeof lines>[number],) => {
        if (props.variant === 'admin') {
            return l.grand ? 'shop-order__totals-grand' : l.sub ? 'shop-order__totals-sub' : '';
        }
        return ['shop-order__total-row', l.sub ? 'shop-order__total-sub' : '', l.grand ? 'shop-order__total-row--grand' : '',]
            .filter(Boolean,).join(' ',);
    };
    return (
        <div class={['shop-order__totals', props.class,].filter(Boolean,).join(' ',)}>
            <For each={lines()}>
                {(l,) => (
                    <div class={rowClass(l,) || undefined}>
                        <span>{l.label}</span>
                        {l.grand && props.variant !== 'admin' ? <strong>{l.value}</strong> : <span>{l.value}</span>}
                    </div>
                )}
            </For>
        </div>
    );
};

export default OrderTotals;
