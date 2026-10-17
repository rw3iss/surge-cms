/**
 * Shop Settings → Shipping → Order tracking: carrier → tracking-page URL
 * templates (`{number}` is replaced) + whether the supplier's own link wins.
 *
 * The list starts as the built-in defaults (`DEFAULT_CARRIER_TRACKING_TEMPLATES`)
 * and is stored only once edited. Rows render with `<Index>` and are patched in
 * place in the parent store, so editing one never remounts the list (focus stays).
 */
import { type Component, Index, Show, } from 'solid-js';
import type { SetStoreFunction, } from 'solid-js/store';
import {
    carrierLabel,
    DEFAULT_CARRIER_TRACKING_TEMPLATES,
    fillTrackingTemplate,
    type ShopSettings,
} from '@sitesurge/types';
import { FormField, } from '../../../components/admin/forms';
import Toggle from '../../../components/admin/common/Toggle';
import CommitInput from '../../../components/admin/gallery/CommitInput';

const defaults = () => DEFAULT_CARRIER_TRACKING_TEMPLATES.map((t,) => ({ ...t, }));

const OrderTrackingSettings: Component<{
    settings: ShopSettings;
    setSettings: SetStoreFunction<ShopSettings>;
}> = (props,) => {
    const rows = () => props.settings.tracking?.carriers ?? DEFAULT_CARRIER_TRACKING_TEMPLATES;
    const isDefault = () => props.settings.tracking?.carriers === undefined;

    /** The first edit copies the defaults into the store, then patches in place. */
    const ensureRows = () => {
        if (!props.settings.tracking) props.setSettings('tracking', { carriers: defaults(), },);
        else if (!props.settings.tracking.carriers) props.setSettings('tracking', 'carriers', defaults(),);
    };
    const setField = (i: number, field: 'carrier' | 'urlTemplate', v: string,) => {
        ensureRows();
        props.setSettings('tracking', 'carriers', i, field, v.trim(),);
    };
    const remove = (i: number,) => {
        ensureRows();
        props.setSettings('tracking', 'carriers', (list,) => (list ?? []).filter((_, j,) => j !== i),);
    };
    const add = () => {
        ensureRows();
        props.setSettings('tracking', 'carriers', (list,) => [...(list ?? []), { carrier: '', urlTemplate: 'https://', },],);
    };
    const reset = () => {
        if (!props.settings.tracking) return;
        props.setSettings('tracking', 'carriers', undefined,);
    };

    return (
        <section class="admin-section shop-tracking-settings">
            <header class="admin-section__header">
                <h2>Order tracking</h2>
                <p class="form-help-muted">
                    How tracking links are built on order pages, receipts and emails. A link an admin
                    types on an order always wins.
                </p>
            </header>

            <Toggle
                label="Use the supplier's tracking link when it has one"
                hint="Off = always build the link from the carrier templates below."
                checked={props.settings.tracking?.useSupplierLinks !== false}
                onChange={(v,) => props.setSettings('tracking', (t,) => ({ ...(t ?? {}), useSupplierLinks: v, }),)}
            />

            <FormField
                label="Carrier link templates"
                hint="{number} is replaced by the tracking number. A carrier matches its own code or the longest code it starts with (DHL_eCommerce_Expedited → DHL_ECOMMERCE)."
            >
                <div class="shop-tracking-settings__rows">
                    <Index each={rows()}>
                        {(row, i,) => (
                            <div class="shop-tracking-settings__row">
                                <div class="shop-tracking-settings__carrier">
                                    <CommitInput
                                        value={row().carrier}
                                        onCommit={(v,) => setField(i, 'carrier', v,)}
                                        placeholder="CARRIER"
                                    />
                                    <span class="form-help-muted">{carrierLabel(row().carrier,) ?? '—'}</span>
                                </div>
                                <div class="shop-tracking-settings__template">
                                    <CommitInput
                                        value={row().urlTemplate}
                                        onCommit={(v,) => setField(i, 'urlTemplate', v,)}
                                        type="url"
                                        placeholder="https://carrier.example/track?n={number}"
                                    />
                                    <span class="form-help-muted">
                                        {fillTrackingTemplate(row().urlTemplate, '1Z999AA10123456784',) ?? ''}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    class="ui-button ui-button--ghost ui-button--sm"
                                    aria-label={`Remove ${row().carrier || 'carrier'}`}
                                    onClick={() => remove(i,)}
                                >
                                    ×
                                </button>
                            </div>
                        )}
                    </Index>
                    <Show when={!rows().length}>
                        <p class="form-help-muted">No templates — links come only from suppliers and manual entries.</p>
                    </Show>
                </div>
            </FormField>
            <div class="shop-tracking-settings__actions">
                <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={add}>+ Add carrier</button>
                <Show when={!isDefault()}>
                    <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={reset}>
                        Reset to built-in defaults
                    </button>
                </Show>
            </div>
        </section>
    );
};

export default OrderTrackingSettings;
