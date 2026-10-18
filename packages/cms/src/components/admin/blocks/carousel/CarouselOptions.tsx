/**
 * Carousel options panel (desktop + mobile ≤768px) — split out of
 * HeroContentEditor.tsx.
 */
import type { HeroCarouselOptions, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import Tooltip from '../../common/Tooltip';
import Toggle from '../../common/Toggle';
import { isValidHeight, } from './heroItemUtils';

export interface CarouselOptionsProps {
    options: HeroCarouselOptions;
    onChange: (patch: Partial<HeroCarouselOptions>,) => void;
    itemCount: number;
    /** Hide the Save button (block mode: the block's own save applies). */
    hideSave?: boolean;
    canSave: boolean;
    saving: boolean;
    onSave: () => void;
}

const CarouselOptions: Component<CarouselOptionsProps> = (props,) => (
    <>
        {/* ─── Carousel Options ─── */}
        <div class="hero-options">
            <h3 class="hero-options__title">Carousel Options</h3>
            <div class="hero-options__row">
                <Show when={!props.hideSave}>
                    <button
                        class="ui-button ui-button--primary ui-button--sm"
                        disabled={!props.canSave || props.saving}
                        onClick={props.onSave}
                    >
                        {props.saving ? 'Saving...' : 'Save Carousel'}
                    </button>
                </Show>
                {/* Auto-scroll */}
                <div class="hero-options__group">
                    <Toggle
                        checked={props.options.autoScroll}
                        disabled={props.itemCount <= 1}
                        onChange={(next,) => props.onChange({ autoScroll: next, },)}
                        ariaLabel="Auto-scroll"
                    />
                    <span class="hero-options__label">Auto-scroll</span>
                    <Show when={props.options.autoScroll}>
                        <input
                            type="number"
                            class="input input--sm input--inline-number"
                            min={500}
                            step={500}
                            value={props.options.autoScrollInterval}
                            onChange={(e,) => {
                                const val = parseInt(e.currentTarget.value,);
                                if (!isNaN(val,) && val >= 500) {
                                    props.onChange({ autoScrollInterval: val, },);
                                }
                            }}
                        />
                        <span class="hero-options__unit">ms</span>
                    </Show>
                </div>

                {/* Repeat */}
                <div class="hero-options__group">
                    <Toggle
                        checked={props.options.repeat}
                        disabled={props.itemCount <= 1}
                        onChange={(next,) => props.onChange({ repeat: next, },)}
                        ariaLabel="Repeat"
                    />
                    <span class="hero-options__label">Repeat</span>
                </div>

                {/* Custom height */}
                <div class="hero-options__group">
                    <Toggle
                        checked={props.options.customHeight}
                        onChange={(next,) => props.onChange({ customHeight: next, },)}
                        ariaLabel="Custom height"
                    />
                    <span class="hero-options__label">Custom height</span>
                    <Show when={props.options.customHeight}>
                        <input
                            type="text"
                            class={`input input--sm input--inline-text ${
                                !isValidHeight(props.options.height || '',) ? 'input--error' : ''
                            }`}
                            placeholder="50vh"
                            value={props.options.height || ''}
                            onChange={(e,) => props.onChange({ height: e.currentTarget.value, },)}
                        />
                    </Show>
                    <Tooltip
                        header="Height Values"
                        content={
                            <div>
                                <p>
                                    <code>px</code> — Fixed pixel height (e.g.{' '}
                                    <code>600px</code>). Stays the same size on all screens.
                                </p>
                                <p>
                                    <code>vh</code> — Percentage of viewport height (e.g. <code>50vh</code>{' '}
                                    = half the screen). Scales with the browser window height.
                                </p>
                                <p>
                                    <code>vw</code> — Percentage of viewport width (e.g.{' '}
                                    <code>30vw</code>). Scales with the browser window width — useful for
                                    maintaining aspect ratio.
                                </p>
                                <p>
                                    <code>%</code> — Percentage of the parent container (e.g.{' '}
                                    <code>50%</code>). Relative to the element the hero sits inside.
                                </p>
                            </div>
                        }
                    />
                </div>

                {/* Apply gutter */}
                <div class="hero-options__group">
                    <Toggle
                        checked={props.options.applyGutter || false}
                        onChange={(next,) => props.onChange({ applyGutter: next, },)}
                        ariaLabel="Apply Site Gutter"
                    />
                    <span class="hero-options__label">Apply Site Gutter</span>
                </div>

                {/* Items per page */}
                <div class="hero-options__group">
                    <span class="hero-options__label">Items per page</span>
                    <input
                        type="number"
                        class="input input--sm input--inline-number"
                        min={1}
                        step={1}
                        value={props.options.itemsPerPage ?? 1}
                        onChange={(e,) => {
                            const v = parseInt(e.currentTarget.value,);
                            props.onChange({ itemsPerPage: !isNaN(v,) && v >= 1 ? v : 1, },);
                        }}
                    />
                    <Tooltip
                        header="Items per page"
                        content={<p>How many carousel items are visible at once (default 1). Higher values show a multi-item row that still pages through the rest.</p>}
                    />
                </div>

                {/* Scroll by */}
                <div class="hero-options__group">
                    <span class="hero-options__label">Scroll by</span>
                    <input
                        type="number"
                        class="input input--sm input--inline-number"
                        min={1}
                        step={1}
                        value={props.options.scrollBy ?? 1}
                        onChange={(e,) => {
                            const v = parseInt(e.currentTarget.value,);
                            props.onChange({ scrollBy: !isNaN(v,) && v >= 1 ? v : 1, },);
                        }}
                    />
                    <Tooltip
                        header="Scroll by"
                        content={<p>How many items to advance when paging left/right (default 1). Set it equal to “Items per page” to move a whole screenful at a time.</p>}
                    />
                </div>

                {/* Padding (arrow gutter + dot space) */}
                <div class="hero-options__group">
                    <span class="hero-options__label">Padding</span>
                    <input
                        type="text"
                        class="input input--sm input--inline-text"
                        placeholder="e.g. 0 64px 40px"
                        value={props.options.sidePadding || ''}
                        onChange={(e,) => props.onChange({ sidePadding: e.currentTarget.value.trim() || undefined, },)}
                    />
                    <Tooltip
                        header="Padding"
                        content={<p>Any CSS padding. <b>One value</b> (e.g. <code>64px</code>) insets the sides so the nav arrows sit in the gutter beside the items. <b>Multiple values</b> (e.g. <code>0 64px 40px</code> = top / sides / bottom) pad the whole carousel — use the <b>bottom</b> value to push the items up so the dots have room and don't sit over the cards.</p>}
                    />
                </div>

                {/* Item gap */}
                <div class="hero-options__group">
                    <span class="hero-options__label">Item gap</span>
                    <input
                        type="text"
                        class="input input--sm input--inline-text"
                        placeholder="e.g. 1rem"
                        value={props.options.itemGap || ''}
                        onChange={(e,) => props.onChange({ itemGap: e.currentTarget.value.trim() || undefined, },)}
                    />
                    <Tooltip
                        header="Item gap"
                        content={<p>Gap between visible items (any CSS length, e.g. <code>1rem</code>).</p>}
                    />
                </div>

                {/* Show dots */}
                <div class="hero-options__group">
                    <Toggle
                        checked={props.options.showDots !== false}
                        onChange={(next,) => props.onChange({ showDots: next, },)}
                        ariaLabel="Show navigation dots"
                    />
                    <span class="hero-options__label">Show navigation dots</span>
                    <Tooltip
                        header="Navigation dots"
                        content={<p>Show the pager dots under the carousel. Turn off to hide the dots entirely.</p>}
                    />
                </div>

                {/* Dot color */}
                <Show when={props.options.showDots !== false}>
                    <div class="hero-options__group">
                        <span class="hero-options__label">Dot color</span>
                        <input
                            type="color"
                            class="input input--sm input--color"
                            value={props.options.dotColor || '#ffffff'}
                            onInput={(e,) => props.onChange({ dotColor: e.currentTarget.value, },)}
                            aria-label="Dot color"
                        />
                        <input
                            type="text"
                            class="input input--sm input--inline-text"
                            placeholder="#ffffff"
                            value={props.options.dotColor || ''}
                            onChange={(e,) => props.onChange({ dotColor: e.currentTarget.value.trim() || undefined, },)}
                        />
                        <Tooltip
                            header="Dot color"
                            content={<p>Color of the pager dots (any CSS color — hex, <code>rgb()</code>, or a name). Defaults to white; set a darker color so the dots show on a light background.</p>}
                        />
                    </div>
                </Show>
            </div>

            {/* ─── Mobile overrides (≤768px) ─── */}
            <h4 class="hero-options__subtitle">Mobile (≤768px)</h4>
            <div class="hero-options__row">
                {/* Render-as-list toggle: when on, the paging-related mobile
                    options below no longer apply and are hidden. */}
                <div class="hero-options__group">
                    <Toggle
                        checked={props.options.listOnMobile || false}
                        onChange={(next,) => props.onChange({ listOnMobile: next, },)}
                        ariaLabel="Render as list on mobile"
                    />
                    <span class="hero-options__label">Render as list on mobile</span>
                    <Tooltip
                        header="Render as list on mobile"
                        content={<p>On phones (≤768px), stack the items as a plain vertical list instead of a swipeable carousel. Items-per-page, scroll-by and side-padding (mobile) don't apply then.</p>}
                    />
                </div>

                <Show when={!props.options.listOnMobile}>
                <div class="hero-options__group">
                    <span class="hero-options__label">Items per page</span>
                    <input
                        type="number"
                        class="input input--sm input--inline-number"
                        min={1}
                        step={1}
                        placeholder="inherit"
                        value={props.options.itemsPerPageMobile ?? ''}
                        onChange={(e,) => {
                            const raw = e.currentTarget.value;
                            const v = parseInt(raw,);
                            props.onChange({ itemsPerPageMobile: raw === '' || isNaN(v,) ? undefined : Math.max(1, v,), },);
                        }}
                    />
                    <Tooltip header="Items per page (mobile)" content={<p>Visible items at once on a phone (≤768px). Blank = same as desktop.</p>} />
                </div>
                <div class="hero-options__group">
                    <span class="hero-options__label">Scroll by</span>
                    <input
                        type="number"
                        class="input input--sm input--inline-number"
                        min={1}
                        step={1}
                        placeholder="inherit"
                        value={props.options.scrollByMobile ?? ''}
                        onChange={(e,) => {
                            const raw = e.currentTarget.value;
                            const v = parseInt(raw,);
                            props.onChange({ scrollByMobile: raw === '' || isNaN(v,) ? undefined : Math.max(1, v,), },);
                        }}
                    />
                    <Tooltip header="Scroll by (mobile)" content={<p>Items advanced per page on a phone. Blank = same as desktop.</p>} />
                </div>
                <div class="hero-options__group">
                    <span class="hero-options__label">Padding</span>
                    <input
                        type="text"
                        class="input input--sm input--inline-text"
                        placeholder="inherit"
                        value={props.options.sidePaddingMobile || ''}
                        onChange={(e,) => props.onChange({ sidePaddingMobile: e.currentTarget.value.trim() || undefined, },)}
                    />
                    <Tooltip header="Padding (mobile)" content={<p>Carousel padding on a phone — one value insets the sides, multiple values (e.g. <code>0 30px 40px</code>) pad the whole carousel (bottom = dot space). Blank = same as desktop.</p>} />
                </div>
                </Show>
                <div class="hero-options__group">
                    <span class="hero-options__label">Item gap</span>
                    <input
                        type="text"
                        class="input input--sm input--inline-text"
                        placeholder="inherit"
                        value={props.options.itemGapMobile || ''}
                        onChange={(e,) => props.onChange({ itemGapMobile: e.currentTarget.value.trim() || undefined, },)}
                    />
                    <Tooltip header="Item gap (mobile)" content={<p>Gap between items on a phone (any CSS length). Blank = same as desktop.</p>} />
                </div>
            </div>
        </div>
    </>
);

export default CarouselOptions;
