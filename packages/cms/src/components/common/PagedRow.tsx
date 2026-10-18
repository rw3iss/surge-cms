/**
 * A horizontal, paged track of any items — arrows, dots and swipe — for lists
 * that are not gallery items (the Events block's `row` layout today).
 *
 * Paging uses the SAME pure helpers as the gallery's row layout
 * (`gallery/galleryLayout`: `nextStart` / `prevStart` / `pageStarts` /
 * `activePage`), so the two step, snap to the last full page and wrap the same
 * way. GalleryView keeps its own markup (tiles, lightbox, autoplay); this
 * component only owns the track.
 *
 * Geometry: each slide is `(100% - (n-1)·gap) / n` wide (or a fixed
 * `itemWidth`), and the track translates by the start index.
 */
import { createEffect, createSignal, For, type JSX, Show, } from 'solid-js';
import { activePage, nextStart, pageStarts, prevStart, } from '../gallery/galleryLayout';
import './PagedRow.scss';

export interface PagedRowProps<T,> {
    items: T[];
    /** Visible items at once (≥ 1). */
    perPage: number;
    /** Items advanced per arrow / swipe. Default 1. */
    step?: number;
    /** CSS length between items. Default 16px. */
    gap?: string;
    /** A fixed width per item instead of fitting `perPage`. */
    itemWidth?: string | null;
    /** Wrap at the ends. Default true. */
    loop?: boolean;
    showArrows?: boolean;
    showDots?: boolean;
    class?: string;
    children: (item: T, index: number,) => JSX.Element;
}

export function PagedRow<T,>(props: PagedRowProps<T>,): JSX.Element {
    const count = () => props.items.length;
    const perPage = () => Math.max(1, Math.min(count() || 1, Math.round(props.perPage,) || 1,),);
    const step = () => Math.max(1, Math.round(props.step ?? 1,),);
    const loop = () => props.loop !== false;
    const paged = () => count() > perPage();
    const [start, setStart,] = createSignal(0,);
    createEffect(() => {
        const max = Math.max(0, count() - perPage(),);
        if (start() > max) setStart(max,);
    },);
    const starts = () => pageStarts(count(), perPage(), step(),);
    const next = () => setStart(nextStart(start(), step(), count(), perPage(), loop(),),);
    const prev = () => setStart(prevStart(start(), step(), count(), perPage(), loop(),),);

    let touchX = 0;
    const onTouchStart = (e: TouchEvent,) => { touchX = e.touches[0]?.clientX ?? 0; };
    const onTouchEnd = (e: TouchEvent,) => {
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX;
        if (paged() && Math.abs(dx,) > 40) (dx < 0 ? next : prev)();
    };

    const basis = () => props.itemWidth || `calc((100% - (${perPage()} - 1) * var(--pr-gap)) / ${perPage()})`;
    const transform = () => {
        if (!paged()) return undefined;
        if (props.itemWidth) return `translateX(calc(-${start()} * (${props.itemWidth} + var(--pr-gap))))`;
        return `translateX(calc(-${start()} * ((100% - (${perPage()} - 1) * var(--pr-gap)) / ${perPage()} + var(--pr-gap))))`;
    };

    return (
        <div class={`paged-row${props.class ? ` ${props.class}` : ''}`} style={{ '--pr-gap': props.gap || '16px', }}>
            <div class="paged-row__viewport" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                <div class="paged-row__track" style={{ transform: transform(), }}>
                    <For each={props.items}>
                        {(item, i,) => (
                            <div
                                class="paged-row__slide"
                                style={{ flex: `0 0 ${basis()}`, }}
                                aria-hidden={paged() && (i() < start() || i() >= start() + perPage()) ? 'true' : undefined}
                            >
                                {props.children(item, i(),)}
                            </div>
                        )}
                    </For>
                </div>
                <Show when={paged() && props.showArrows !== false}>
                    <button type="button" class="paged-row__arrow paged-row__arrow--prev" aria-label="Previous" onClick={prev}>‹</button>
                    <button type="button" class="paged-row__arrow paged-row__arrow--next" aria-label="Next" onClick={next}>›</button>
                </Show>
            </div>
            <Show when={paged() && props.showDots !== false && starts().length > 1}>
                <div class="paged-row__dots" role="tablist">
                    <For each={starts()}>
                        {(s, i,) => (
                            <button
                                type="button"
                                class="paged-row__dot"
                                classList={{ 'is-active': activePage(starts(), start(),) === i(), }}
                                aria-label={`Page ${i() + 1}`}
                                onClick={() => setStart(s,)}
                            />
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
}

