import type { Component, } from 'solid-js';

/**
 * "SOLD OUT!" stamp laid over a product image. The parent must be the
 * positioning context (`position: relative`). Styles are GLOBAL
 * (`.sold-out-overlay` in styles/global.scss) so entity/component templates can
 * use the same markup in Custom HTML:
 * `<div class="sold-out-overlay"><span>SOLD OUT!</span></div>`.
 */
const SoldOutOverlay: Component<{ label?: string; }> = (props,) => (
    <div class="sold-out-overlay" role="img" aria-label="Sold out">
        <span>{props.label ?? 'SOLD OUT!'}</span>
    </div>
);

export default SoldOutOverlay;
