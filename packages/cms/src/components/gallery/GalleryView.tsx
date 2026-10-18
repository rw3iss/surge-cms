/**
 * ONE view for a list of gallery items, used by the /gallery page, the Gallery
 * content block and `{{gallery(...)}}`. Settings are GalleryBlockSettings
 * (desktop + mobile layout options — mobile ≤768px falls back to desktop per
 * key; see galleryLayout.resolveLayout).
 *
 * Layouts:
 *   grid      fixed `columns`, else auto-fill at `thumbSize` px; `rows` pages it
 *   masonry   `columns` stacks, each item in the shortest (same placement as
 *             email); no columns → CSS multi-column flow at itemWidth / thumbSize
 *   row       horizontal track: itemsPerPage, scrollBy, gap, arrows, dots, autoplay
 *   column    vertical list; `rows` (or itemsPerPage) per page with paging
 *   carousel  one-up slides (a row with one per page)
 *   stage     the selected item large, a thumbnail strip below
 * Click: lightbox (default), the item's page, or nothing.
 *
 * Alignment: inside a block the view reads the block's Horizontal Alignment
 * (`--block-h-align`), else its Text Align (`--block-align-items`), else
 * centre, as `--gv-justify` — it places a column of fixed-width items, a grid
 * narrower than the block, an unpaged row, and the stage picture. Titles /
 * captions inherit the block's text-align. `itemWidth` → `--gv-item-width`
 * (column / stage tile width; grid track cap; row slide width).
 */
import { type GalleryItem, galleryItemRadius, galleryMasonryColumns, } from '@sitesurge/types';
import { Component, createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch, } from 'solid-js';
import MediaVideo from '../blocks/media/MediaVideo';
import {
    activePage, aspectRatio, type GalleryViewSettings, gridTemplateColumns, masonryPlan, masonryTileAspect, nextStart, pageStarts, prevStart, resolveLayout,
} from './galleryLayout';
import GalleryLightbox from './GalleryLightbox';
import GalleryTile from './GalleryTile';
import { useIsMobile, } from './useIsMobile';
import './GalleryView.scss';

export type { GalleryViewSettings, };

export interface GalleryViewProps {
    items: GalleryItem[];
    settings: GalleryViewSettings;
    /** Grid min column width (px) when no `columns` is set. Default 220. */
    thumbSize?: number;
    hoverZoom?: boolean;
    videoBadge?: boolean;
    class?: string;
    /** Shown when there are no items. */
    empty?: string;
}

const GalleryView: Component<GalleryViewProps> = (props,) => {
    let root: HTMLDivElement | undefined;
    const isMobile = useIsMobile(() => root,);
    const L = createMemo(() => resolveLayout(props.settings.desktop, props.settings.mobile, isMobile(),),);
    const items = () => props.items.filter((i,) => i.media,);
    const count = () => items().length;
    const open = () => props.settings.open ?? 'lightbox';
    const loop = () => props.settings.loop !== false;

    const [lightbox, setLightbox,] = createSignal<number | null>(null,);
    const tileProps = (item: GalleryItem, index: number,) => ({
        item,
        aspect: aspectRatio(L().aspect,),
        fit: L().fit,
        height: L().itemHeight,
        showTitle: Boolean(props.settings.showTitles,),
        showCaption: Boolean(props.settings.showCaptions,),
        videoBadge: props.videoBadge,
        href: open() === 'page' ? item.url : null,
        onOpen: open() === 'lightbox' ? () => setLightbox(index,) : undefined,
    });

    // ─── Masonry: items at their natural aspect (no box height / fixed aspect) ───
    const masonry = () => masonryPlan(L().columns, L().itemWidth, props.thumbSize ?? 220,);
    const masonryStacks = () => {
        const m = masonry();
        return m.kind === 'stacks' ? galleryMasonryColumns(items(), m.columns,) : [];
    };
    const masonryTile = (item: GalleryItem, index: number,) => (
        <GalleryTile
            {...tileProps(item, index,)}
            // '' (not undefined): Solid's prop merge skips `undefined`, so the
            // block's own aspect (e.g. square) from tileProps would win and
            // every tile became a cropped square. '' = natural height when the
            // media's size is unknown (many library images store none).
            aspect={masonryTileAspect(item.media,) ?? ''}
            fit="cover"
            height={null}
            class="gallery-view__masonry-item"
        />
    );

    // ─── Paging (row / carousel / column / paged grid / stage) ───
    const isRowLike = () => L().layout === 'row' || L().layout === 'carousel';
    /** Items per page for the current layout. */
    const perPage = () => {
        const l = L();
        if (l.layout === 'carousel') return 1;
        if (l.layout === 'row') return Math.min(count() || 1, l.itemsPerPage,);
        if (l.layout === 'column') return l.rows ?? l.itemsPerPage;
        if (l.layout === 'grid' && l.rows && l.columns) return l.rows * l.columns;
        return count() || 1;
    };
    const step = () => {
        const l = L();
        if (l.layout === 'carousel') return 1;
        if (l.layout === 'row') return l.scrollBy;
        return perPage(); // grid/column page by whole pages
    };
    const paged = () => count() > perPage() && L().layout !== 'masonry' && L().layout !== 'stage';
    const [start, setStart,] = createSignal(0,);
    createEffect(() => {
        // Keep in range when the layout / breakpoint changes.
        const max = Math.max(0, count() - perPage(),);
        if (start() > max) setStart(max,);
    },);
    const starts = () => pageStarts(count(), perPage(), step(),);
    const next = () => setStart(nextStart(start(), step(), count(), perPage(), loop(),),);
    const prev = () => setStart(prevStart(start(), step(), count(), perPage(), loop(),),);

    // Stage: the selected item.
    const [selected, setSelected,] = createSignal(0,);
    createEffect(() => {
        if (selected() >= count()) setSelected(0,);
    },);

    // Autoplay (row / carousel / column / stage), paused on hover and while the lightbox is open.
    const [hover, setHover,] = createSignal(false,);
    createEffect(() => {
        const on = props.settings.autoplay && count() > 1 && lightbox() === null
            && (paged() || L().layout === 'stage') && !(props.settings.pauseOnHover !== false && hover());
        if (!on) return;
        const ms = Math.max(1, Number(props.settings.autoplayInterval,) || 5,) * 1000;
        const t = setInterval(() => {
            if (L().layout === 'stage') setSelected((s,) => (s + 1) % count(),);
            else next();
        }, ms,);
        onCleanup(() => clearInterval(t,),);
    },);

    // Swipe on row-like tracks.
    let touchX = 0;
    const onTouchStart = (e: TouchEvent,) => { touchX = e.touches[0]?.clientX ?? 0; };
    const onTouchEnd = (e: TouchEvent,) => {
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX;
        if (Math.abs(dx,) > 40) (dx < 0 ? next : prev)();
    };

    const rootStyle = () => {
        const s: Record<string, string> = { '--gv-gap': L().gap, };
        // Item radius (empty = the site radius; `0` = square) → `--item-radius`,
        // read by the tiles (`--gv-radius`) and the stage's picture / video.
        const r = galleryItemRadius(props.settings,);
        if (r) s['--item-radius'] = r;
        if (L().itemWidth) s['--gv-item-width'] = L().itemWidth!;
        return s;
    };

    // Row track geometry: each item (100% - (n-1)·gap)/n wide (or a fixed itemWidth); translate by start.
    const itemBasis = () => L().itemWidth || `calc((100% - (${perPage()} - 1) * var(--gv-gap)) / ${perPage()})`;
    const trackTransform = () => {
        if (L().itemWidth) return `translateX(calc(-${start()} * (${L().itemWidth} + var(--gv-gap))))`;
        return `translateX(calc(-${start()} * ((100% - (${perPage()} - 1) * var(--gv-gap)) / ${perPage()} + var(--gv-gap))))`;
    };

    const arrows = () => (
        <Show when={paged() && props.settings.showArrows !== false}>
            <button type="button" class="gallery-view__arrow gallery-view__arrow--prev" aria-label="Previous" onClick={prev}>‹</button>
            <button type="button" class="gallery-view__arrow gallery-view__arrow--next" aria-label="Next" onClick={next}>›</button>
        </Show>
    );
    const dots = () => (
        <Show when={paged() && props.settings.showDots !== false && starts().length > 1}>
            <div class="gallery-view__dots" role="tablist">
                <For each={starts()}>
                    {(s, i,) => (
                        <button
                            type="button"
                            class="gallery-view__dot"
                            classList={{ 'is-active': activePage(starts(), start(),) === i(), }}
                            aria-label={`Page ${i() + 1}`}
                            onClick={() => setStart(s,)}
                        />
                    )}
                </For>
            </div>
        </Show>
    );
    /** Items on the current page (slice-paged layouts). */
    const pageItems = () => (paged() ? items().slice(start(), start() + perPage(),) : items());

    return (
        <div
            ref={root}
            class={`gallery-view gallery-view--${L().layout}${props.hoverZoom ? ' gallery-view--zoom' : ''}${props.class ? ` ${props.class}` : ''}`}
            style={rootStyle()}
            onMouseEnter={() => setHover(true,)}
            onMouseLeave={() => setHover(false,)}
        >
            <Show when={count() > 0} fallback={props.empty ? <p class="gallery-view__empty">{props.empty}</p> : null}>
                <Switch>
                    <Match when={isRowLike()}>
                        <div class="gallery-view__viewport" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                            <div class="gallery-view__track" classList={{ 'gallery-view__track--static': !paged(), }} style={{ transform: trackTransform(), }}>
                                <For each={items()}>
                                    {(item, i,) => (
                                        <div class="gallery-view__slide" style={{ flex: `0 0 ${itemBasis()}`, }}>
                                            <GalleryTile {...tileProps(item, i(),)} />
                                        </div>
                                    )}
                                </For>
                            </div>
                            {arrows()}
                        </div>
                        {dots()}
                    </Match>
                    <Match when={L().layout === 'stage'}>
                        <Show when={items()[selected()]}>
                            {(cur,) => (
                                <div
                                    class="gallery-view__stage"
                                    style={L().itemHeight ? { '--gv-stage-height': L().itemHeight!, '--block-max-height': L().itemHeight!, } : undefined}
                                >
                                    <Show
                                        when={cur().media?.type === 'video'}
                                        fallback={
                                            <button
                                                type="button"
                                                class="gallery-view__stage-hit"
                                                classList={{ 'gallery-view__stage-hit--contain': L().fit === 'contain', }}
                                                disabled={open() !== 'lightbox'}
                                                onClick={() => open() === 'lightbox' && setLightbox(selected(),)}
                                            >
                                                <img
                                                    src={cur().media?.url}
                                                    alt={cur().media?.alt || cur().title || ''}
                                                    class={L().fit === 'contain' ? 'gallery-view__stage-img--contain' : undefined}
                                                    style={{ 'object-fit': L().fit, }}
                                                />
                                            </button>
                                        }
                                    >
                                        <Show when={cur().media!.id} keyed>
                                            {(id,) => <MediaVideo mediaId={id} fallbackSrc={cur().media?.url} />}
                                        </Show>
                                    </Show>
                                    <Show when={(props.settings.showTitles && cur().title) || (props.settings.showCaptions && cur().caption)}>
                                        <div class="gallery-view__stage-meta">
                                            <Show when={props.settings.showTitles && cur().title}><strong>{cur().title}</strong></Show>
                                            <Show when={props.settings.showCaptions && cur().caption}><span>{cur().caption}</span></Show>
                                            <Show when={open() === 'page'}><a href={cur().url}>Open</a></Show>
                                        </div>
                                    </Show>
                                </div>
                            )}
                        </Show>
                        <div class="gallery-view__strip">
                            <For each={items()}>
                                {(item, i,) => (
                                    <button
                                        type="button"
                                        class="gallery-view__thumb"
                                        classList={{ 'is-active': selected() === i(), }}
                                        aria-label={item.title || `Item ${i() + 1}`}
                                        onClick={() => setSelected(i(),)}
                                    >
                                        <GalleryTile item={item} aspect="1 / 1" fit="cover" videoBadge={props.videoBadge} />
                                    </button>
                                )}
                            </For>
                        </div>
                    </Match>
                    <Match when={L().layout === 'masonry'}>
                        <Show
                            when={masonry().kind === 'stacks'}
                            fallback={
                                <div class="gallery-view__masonry" style={{ 'column-width': (masonry() as { columnWidth: string; }).columnWidth, }}>
                                    <For each={items()}>{(item, i,) => masonryTile(item, i(),)}</For>
                                </div>
                            }
                        >
                            <div class="gallery-view__masonry-stacks">
                                <For each={masonryStacks()}>
                                    {(stack,) => (
                                        <div class="gallery-view__masonry-col">
                                            <For each={stack}>{(index,) => masonryTile(items()[index]!, index,)}</For>
                                        </div>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </Match>
                    <Match when={L().layout === 'column'}>
                        <div class="gallery-view__column">
                            <For each={pageItems()}>
                                {(item,) => <GalleryTile {...tileProps(item, items().indexOf(item,),)} />}
                            </For>
                        </div>
                        <Show when={paged()}>
                            <div class="gallery-view__pager">
                                <Show when={props.settings.showArrows !== false}>
                                    <button type="button" class="gallery-view__page-btn" aria-label="Previous" onClick={prev}>↑</button>
                                </Show>
                                {dots()}
                                <Show when={props.settings.showArrows !== false}>
                                    <button type="button" class="gallery-view__page-btn" aria-label="Next" onClick={next}>↓</button>
                                </Show>
                            </div>
                        </Show>
                    </Match>
                    <Match when={true}>
                        <div
                            class="gallery-view__grid"
                            style={{
                                'grid-template-columns': gridTemplateColumns(L().columns, L().itemWidth, props.thumbSize ?? 220,),
                            }}
                        >
                            <For each={pageItems()}>
                                {(item,) => <GalleryTile {...tileProps(item, items().indexOf(item,),)} />}
                            </For>
                        </div>
                        <Show when={paged()}>
                            <div class="gallery-view__pager">
                                <Show when={props.settings.showArrows !== false}>
                                    <button type="button" class="gallery-view__page-btn" aria-label="Previous" onClick={prev}>‹</button>
                                </Show>
                                {dots()}
                                <Show when={props.settings.showArrows !== false}>
                                    <button type="button" class="gallery-view__page-btn" aria-label="Next" onClick={next}>›</button>
                                </Show>
                            </div>
                        </Show>
                    </Match>
                </Switch>
            </Show>
            <Show when={lightbox() !== null}>
                <GalleryLightbox items={items()} index={lightbox()!} thumbStrip={Boolean(props.settings.thumbStrip,)} onClose={() => setLightbox(null,)} />
            </Show>
        </div>
    );
};

export default GalleryView;
