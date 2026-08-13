import type { HeroCarouselOptions, HeroItem, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, type JSX, on, onCleanup, onMount, Show, } from 'solid-js';
import { TEXT_ALIGN, toFlexAlign, } from '../../utils/cssAlign';
import { previewBreakpoint, } from '../../stores/previewBreakpoint';
import './HeroCarousel.scss';

/** A slide is either a media/posts item (media backdrop + text overlay) or an
 *  entity item carrying a pre-rendered `contentNode` (its content-block template
 *  rendered with the entity bound), which fills the whole slide. */
export type HeroSlide = HeroItem & { contentNode?: JSX.Element; };

export interface HeroCarouselProps {
    items: HeroSlide[];
    options: HeroCarouselOptions;
    height?: string;
    /** Min-height for the carousel container (from the block style), so a
     *  height:100% carousel that fills a stretched group slot still has a floor. */
    minHeight?: string;
    previewMode?: boolean;
    gutterWidth?: string;
    /** Horizontal alignment from the block style (`textAlign`). Overrides the
     *  default centered overlay so slide content honors the block's setting. */
    align?: string;
    /** Vertical alignment from the block style (`verticalAlign`). */
    valign?: string;
    /** Padding from the block style, applied to the slide *content* (the text
     *  overlay) only — the background media stays full-bleed. */
    contentPadding?: string;
    /** Margin from the block style, applied to the slide *content*. */
    contentMargin?: string;
    /** Background color/gradient from the carousel block style, applied per
     *  slide: a slide WITH a media backdrop gets it as a readability overlay on
     *  top of the media; a slide with NO backdrop gets it as its own container
     *  background. (Mirrors the regular block color/image/overlay rules.) */
    itemBackground?: string;
}

/** A slide has a visual backdrop when it carries an image or video media URL —
 *  in that case the item background renders as an overlay on top of it. */
function hasBackdrop(item: HeroItem,): boolean {
    return Boolean(item.mediaUrl) && (item.mediaType === 'image' || item.mediaType === 'video');
}

const DEFAULT_HEIGHT = '50vh';

// Block-style alignment is emitted as CSS vars the SCSS reads (with a `center`
// fallback), so an unset block style keeps the original centered overlay. The
// keyword→flexbox mapping lives in utils/cssAlign (shared with the renderers).

/** Format a post's ISO date for the slide meta row. */
function formatMetaDate(iso: string,): string {
    const d = new Date(iso,);
    if (Number.isNaN(d.getTime(),)) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', },);
}

// Heading sizes are CONTAINER-responsive: `cqi` = 1% of the carousel's
// inline (width) size (the `.hero-carousel` sets container-type:inline-size),
// so titles scale with the actual slide/post area — shrinking in a narrow
// block or on small screens — clamped to a sensible min/max. This keeps a
// long post title from overflowing the slide.
const HEADER_SIZES: Record<string, string> = {
    h1: 'clamp(1.6rem, 7cqi, 4rem)',
    h2: 'clamp(1.5rem, 6.2cqi, 3.5rem)',
    h3: 'clamp(1.4rem, 5.4cqi, 3rem)',
    h4: 'clamp(1.3rem, 4.8cqi, 2.6rem)',
    h5: 'clamp(1.2rem, 4.2cqi, 2.2rem)',
    h6: 'clamp(1.05rem, 3.6cqi, 1.9rem)',
};

const SUBHEADER_SIZES: Record<string, string> = {
    h1: 'clamp(1.1rem, 4cqi, 2.4rem)',
    h2: 'clamp(1.05rem, 3.6cqi, 2.1rem)',
    h3: 'clamp(1rem, 3.2cqi, 1.9rem)',
    h4: 'clamp(0.95rem, 2.8cqi, 1.7rem)',
    h5: 'clamp(0.9rem, 2.4cqi, 1.5rem)',
    h6: 'clamp(0.85rem, 2cqi, 1.3rem)',
};

/** Renders text with the configured heading size applied via inline font-size */
function HeadingText(
    props: { size: string; color: string; children: any; class?: string; variant?: 'header' | 'subheader'; },
) {
    const sizeMap = () => props.variant === 'subheader' ? SUBHEADER_SIZES : HEADER_SIZES;
    const fontSize = () => sizeMap()[props.size] || sizeMap().h1;
    return (
        <span
            class={props.class}
            style={{
                color: props.color,
                'font-size': fontSize(),
                'font-weight': '700',
                display: 'block',
                margin: 0,
            }}
        >
            {props.children}
        </span>
    );
}

const HeroCarousel: Component<HeroCarouselProps> = (props,) => {
    const [currentIndex, setCurrentIndex,] = createSignal(0,);
    const [isTransitioning, setIsTransitioning,] = createSignal(false,);
    const [isPaused, setIsPaused,] = createSignal(false,);
    let containerRef: HTMLDivElement | undefined;
    let trackRef: HTMLDivElement | undefined;
    let autoScrollTimer: ReturnType<typeof setInterval> | undefined;

    // Touch/swipe state
    let touchStartX = 0;
    let touchDeltaX = 0;

    // Track viewport-mobile (≤768px) so the mobile option overrides apply.
    // Initialized synchronously (client) to avoid a desktop→mobile flash, then
    // kept live on resize/rotation.
    const MOBILE_MQ = '(max-width: 768px)';
    const [viewportMobile, setViewportMobile,] = createSignal(
        typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ,).matches,
    );
    // The carousel's own rendered width — used ONLY to detect the admin's mobile
    // PREVIEW (which caps the container width but doesn't fire real @media), never
    // on the public site (a narrow desktop column would falsely read as mobile).
    const [containerWidth, setContainerWidth,] = createSignal(0,);
    onMount(() => {
        if (typeof window !== 'undefined') {
            const mq = window.matchMedia(MOBILE_MQ,);
            const update = () => setViewportMobile(mq.matches,);
            update();
            mq.addEventListener('change', update,);
            onCleanup(() => mq.removeEventListener('change', update,),);
        }
        if (containerRef && typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver((entries,) => {
                for (const e of entries) setContainerWidth(e.contentRect.width,);
            },);
            ro.observe(containerRef,);
            onCleanup(() => ro.disconnect(),);
        }
    },);
    // Mobile = the real viewport is narrow, OR the admin is simulating a
    // breakpoint AND the (capped) carousel width is ≤768px. On the public site
    // `previewBreakpoint()` is always '' so only the viewport matters.
    const isMobile = () =>
        viewportMobile() || (previewBreakpoint() !== '' && containerWidth() > 0 && containerWidth() <= 768);
    // Render items as a plain vertical list (no track/arrows/dots) on mobile.
    const isListMode = () => Boolean(props.options.listOnMobile,) && isMobile();
    /** Pick the mobile override when on a narrow viewport AND it's set (numbers:
     *  truthy; strings: non-empty), else the desktop value. */
    const pick = <T,>(mobile: T | undefined, base: T | undefined,): T | undefined =>
        isMobile() && mobile != null && (mobile as unknown) !== '' ? mobile : base;

    const itemCount = () => props.items.length;
    // How many items are visible at once, and how many to advance per page.
    // perPage is capped at the item count so a 2-item carousel set to "show 3"
    // just shows 2. maxIndex is the last valid START index (so the final page is
    // full — you can't scroll past the last screenful).
    const perPage = () =>
        Math.max(1, Math.min(itemCount() || 1, pick(props.options.itemsPerPageMobile, props.options.itemsPerPage,) || 1,),);
    const step = () => Math.max(1, pick(props.options.scrollByMobile, props.options.scrollBy,) || 1,);
    const maxIndex = () => Math.max(0, itemCount() - perPage(),);
    const hasMultiple = () => itemCount() > perPage();
    // Gap between visible items (any CSS length). Feeds both the flex `gap` and
    // the per-item translate distance `(100% + gap) / perPage`.
    const gap = () => pick(props.options.itemGapMobile, props.options.itemGap,) || '0px';
    // Carousel padding. A SINGLE value insets the sides only (the arrow gutter —
    // legacy behavior). MULTIPLE values are a full CSS `padding` (e.g.
    // `0 90px 40px` = top/sides/bottom) applied to the carousel box, so the
    // BOTTOM value reserves space UNDER the slides where the dots sit — they no
    // longer overlap the item cards.
    const sidePadding = () => pick(props.options.sidePaddingMobile, props.options.sidePadding,) || null;
    const isMultiPad = () => { const s = sidePadding(); return !!s && /\s/.test(s.trim(),); };
    /** Left/right component of the padding — centers the nav arrows in the gutter. */
    const sidePadInline = () => {
        const s = sidePadding();
        if (!s) return '0px';
        const parts = s.trim().split(/\s+/,);
        return parts.length === 1 ? parts[0] : parts[1]; // 2/3-val → horizontal; 4-val → right
    };
    /** Single-value horizontal inset (+ optional site gutter) — legacy path. */
    const padInline = () => {
        const gut = props.options.applyGutter && props.gutterWidth ? props.gutterWidth : null;
        const side = isMultiPad() ? null : sidePadding();
        if (gut && side) return `calc(${gut} + ${side})`;
        return side || gut || undefined;
    };

    // If the visible-count changes (e.g. a desktop→mobile resize reduces the
    // number of pages) and leaves the current index past the last page, snap it
    // back in-bounds so the track doesn't rest on empty space.
    createEffect(() => {
        const max = maxIndex();
        if (currentIndex() > max) setCurrentIndex(max,);
    },);

    // Height precedence: the explicit "Custom Height" content setting wins, then
    // the block's style.height (passed as `height`), then the built-in default.
    const resolvedHeight = () => {
        if (props.options.customHeight && props.options.height) return props.options.height;
        if (props.height) return props.height;
        return DEFAULT_HEIGHT;
    };

    /** CSS custom properties that push the block-style alignment into the
     *  slide overlay. Only set the vars the block actually specifies so an
     *  unstyled carousel keeps the default centered layout. */
    const alignVars = () => {
        const v: Record<string, string> = {};
        const a = props.align;
        if (a) {
            v['--hero-content-align'] = toFlexAlign(a,);
            v['--hero-text-align'] = TEXT_ALIGN[a] ?? 'center';
        }
        const va = props.valign;
        if (va) v['--hero-valign'] = toFlexAlign(va,);
        // Block-style padding pushes the text content inward; the background
        // media ignores it (it lives on a separate, un-padded layer).
        if (props.contentPadding) v['--hero-content-padding'] = props.contentPadding;
        if (props.contentMargin) v['--hero-content-margin'] = props.contentMargin;
        return v;
    };

    // ─── Navigation ───

    const goTo = (index: number,) => {
        if (isTransitioning()) return;
        const count = itemCount();
        if (count === 0) return;

        const max = maxIndex();
        let target: number;
        if (props.options.repeat) {
            // Wrap by PAGE: past the last full page → back to the start, and vice
            // versa (so the last screenful is always full for multi-item views).
            target = index > max ? 0 : index < 0 ? max : index;
        } else {
            target = Math.max(0, Math.min(max, index,),);
        }

        setIsTransitioning(true,);
        setCurrentIndex(target,);
        setTimeout(() => setIsTransitioning(false,), 500,);
    };

    // Advance/retreat by a page, but SNAP to the last/first page before wrapping,
    // so a partial final page (e.g. 11 items, 3 per page → items 9–10) is always
    // reachable instead of being skipped straight to the wrap.
    const goNext = () => {
        const cur = currentIndex(), max = maxIndex();
        if (cur >= max) goTo(props.options.repeat ? 0 : max,);
        else goTo(Math.min(cur + step(), max,),);
    };
    const goPrev = () => {
        const cur = currentIndex(), max = maxIndex();
        if (cur <= 0) goTo(props.options.repeat ? max : 0,);
        else goTo(Math.max(cur - step(), 0,),);
    };

    /** Page start indices for the dots (0, step, 2·step, …) plus the snapped last
     *  page (maxIndex) when the final step doesn't land on it, so every item is
     *  reachable via a dot. */
    const pages = () => {
        const starts: number[] = [];
        const s = step(), max = maxIndex();
        for (let i = 0; i <= max; i += s) starts.push(i,);
        if (starts.length === 0) starts.push(0,);
        else if (starts[starts.length - 1] < max) starts.push(max,);
        return starts;
    };

    // ─── Auto-scroll ───

    const startAutoScroll = () => {
        stopAutoScroll();
        if (!props.options.autoScroll || !hasMultiple() || isListMode()) return;
        const interval = props.options.autoScrollInterval || 3000;
        autoScrollTimer = setInterval(() => {
            if (!isPaused()) goNext();
        }, interval,);
    };

    const stopAutoScroll = () => {
        if (autoScrollTimer) {
            clearInterval(autoScrollTimer,);
            autoScrollTimer = undefined;
        }
    };

    createEffect(on(
        () => [props.options.autoScroll, props.options.autoScrollInterval, props.options.repeat, props.items.length, isListMode(),],
        () => {
            startAutoScroll();
        },
    ),);

    onCleanup(() => stopAutoScroll());

    // ─── Touch support ───

    const handleTouchStart = (e: TouchEvent,) => {
        touchStartX = e.touches[0].clientX;
        touchDeltaX = 0;
    };

    const handleTouchMove = (e: TouchEvent,) => {
        touchDeltaX = e.touches[0].clientX - touchStartX;
    };

    const handleTouchEnd = () => {
        if (Math.abs(touchDeltaX,) > 50) {
            if (touchDeltaX < 0) goNext();
            else goPrev();
        }
        touchDeltaX = 0;
    };

    // ─── Video management ───

    const handleVideoRef = (el: HTMLVideoElement, item: HeroItem, index: number,) => {
        createEffect(() => {
            // A video is "active" when its slide is within the visible window.
            const isActive = index >= currentIndex() && index < currentIndex() + perPage();
            if (isActive && item.autoplay) {
                el.play().catch(() => {},);
            } else {
                el.pause();
            }
        },);
    };

    // ─── Render ───

    return (
        <div
            ref={containerRef}
            class="hero-carousel"
            classList={{
                'hero-carousel--preview': Boolean(props.previewMode,),
                'hero-carousel--list': isListMode(),
            }}
            style={{
                // List mode: the container grows to fit the stacked items.
                height: isListMode() ? 'auto' : resolvedHeight(),
                ...(props.minHeight && !isListMode() ? { 'min-height': props.minHeight, } : {}),
                // Slides read these to size to 1/N of the track width, minus gaps.
                '--hero-per-page': String(perPage(),),
                '--hero-gap': gap(),
                // Arrows center within this side gutter (see .scss).
                '--hero-side-padding': sidePadInline(),
                ...alignVars(),
                // No arrow gutter / padding in list mode. A multi-value padding
                // applies as a full `padding` (bottom reserves dot space); a
                // single value keeps the legacy side-only inset (+ gutter).
                ...(isListMode() ? {} : (
                    isMultiPad()
                        ? { padding: sidePadding()!, }
                        : (padInline() ? { 'padding-left': padInline(), 'padding-right': padInline(), } : {})
                )),
            }}
            onMouseEnter={() => setIsPaused(true,)}
            onMouseLeave={() => setIsPaused(false,)}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            <Show when={itemCount() === 0}>
                <div class="hero-carousel__empty">No hero content configured</div>
            </Show>

            <Show when={itemCount() > 0}>
                {/* Viewport clips the track at the CONTENT box (inside the side
                    padding) so items don't peek into the arrow gutters. */}
                <div class="hero-carousel__viewport">
                <div
                    ref={trackRef}
                    class="hero-carousel__track"
                    style={{
                        // Advance by `(100% + gap) / perPage` per item so a gap
                        // between items doesn't drift the paging (see .scss basis).
                        // List mode stacks the items (column) with no translate.
                        transform: isListMode()
                            ? 'none'
                            : `translateX(calc(-1 * ${currentIndex()} * (100% + ${gap()}) / ${perPage()}))`,
                        transition: isTransitioning() && !isListMode() ? 'transform 0.5s ease-in-out' : 'none',
                    }}
                >
                    <For each={props.items}>
                        {(item, index,) => (
                            <div
                                class="hero-carousel__slide"
                                classList={{ 'hero-carousel__slide--entity': Boolean(item.contentNode), }}
                                // No backdrop → the block-style color fills the
                                // slide container directly.
                                style={props.itemBackground && !hasBackdrop(item)
                                    ? { background: props.itemBackground, }
                                    : undefined}
                            >
                                <Show when={item.contentNode} fallback={
                                    <>
                                {/* Background media */}
                                <div class="hero-carousel__media">
                                    <Show when={item.mediaType === 'image'}>
                                        <img
                                            src={item.mediaUrl}
                                            alt=""
                                            class="hero-carousel__media-element"
                                            style={{ 'object-fit': item.objectFit || 'cover', }}
                                            loading="lazy"
                                        />
                                    </Show>
                                    <Show when={item.mediaType === 'video'}>
                                        <video
                                            ref={(el,) => handleVideoRef(el, item, index(),)}
                                            src={item.mediaUrl}
                                            class="hero-carousel__media-element"
                                            style={{ 'object-fit': item.objectFit || 'cover', }}
                                            muted
                                            loop
                                            playsinline
                                        />
                                    </Show>
                                </div>

                                {/* Block-style color as a readability overlay on
                                    top of the media backdrop (only when both a
                                    backdrop and a color are present). */}
                                <Show when={props.itemBackground && hasBackdrop(item)}>
                                    <div
                                        class="hero-carousel__bg-overlay"
                                        style={{ background: props.itemBackground, }}
                                        aria-hidden="true"
                                    />
                                </Show>

                                {/* Text overlay */}
                                <div class="hero-carousel__overlay">
                                    <div class="hero-carousel__content">
                                        <Show when={item.header?.text}>
                                            <HeadingText
                                                size={item.header!.size || 'h1'}
                                                color={item.header!.color || '#ffffff'}
                                                class="hero-carousel__header"
                                            >
                                                {item.header!.text}
                                            </HeadingText>
                                        </Show>
                                        <Show when={item.subheader?.text}>
                                            <HeadingText
                                                size={item.subheader!.size || 'h3'}
                                                color={item.subheader!.color || '#ffffff'}
                                                class="hero-carousel__subheader"
                                                variant="subheader"
                                            >
                                                {item.subheader!.text}
                                            </HeadingText>
                                        </Show>
                                        {/* Posts show-fields. Meta line (author +
                                            date(s)) sits directly below the title,
                                            above the excerpt; tags go below, smaller. */}
                                        <Show
                                            when={item.postMeta?.author
                                                || item.postMeta?.dateCreated
                                                || item.postMeta?.dateUpdated}
                                        >
                                            <div class="hero-carousel__meta">
                                                <Show when={item.postMeta!.author}>
                                                    <span class="hero-carousel__meta-author">{item.postMeta!.author}</span>
                                                </Show>
                                                <Show when={item.postMeta!.dateCreated}>
                                                    <span class="hero-carousel__meta-date">
                                                        {formatMetaDate(item.postMeta!.dateCreated!,)}
                                                    </span>
                                                </Show>
                                                <Show when={item.postMeta!.dateUpdated}>
                                                    <span class="hero-carousel__meta-date hero-carousel__meta-date--updated">
                                                        Updated {formatMetaDate(item.postMeta!.dateUpdated!,)}
                                                    </span>
                                                </Show>
                                            </div>
                                        </Show>
                                        <Show when={item.postMeta?.excerpt}>
                                            <p class="hero-carousel__excerpt">{item.postMeta!.excerpt}</p>
                                        </Show>
                                        <Show when={item.postMeta?.tags?.length}>
                                            <div class="hero-carousel__tags">
                                                <For each={item.postMeta!.tags}>
                                                    {(t,) => <span class="hero-carousel__tag">#{t}</span>}
                                                </For>
                                            </div>
                                        </Show>
                                        <Show when={item.action?.label}>
                                            <a
                                                href={item.action!.url}
                                                target={item.action!.openInNewTab ? '_blank' : '_self'}
                                                rel={item.action!.openInNewTab ? 'noopener noreferrer' : undefined}
                                                class={`hero-carousel__action-btn hero-carousel__action-btn--${
                                                    item.action!.size || 'small'
                                                }`}
                                            >
                                                {item.action!.label}
                                            </a>
                                        </Show>
                                    </div>
                                </div>
                                    </>
                                }>
                                    {/* Entity item: its content-block template,
                                        rendered with the entity bound, fills the slide. */}
                                    <div class="hero-carousel__entity">{item.contentNode}</div>
                                </Show>
                            </div>
                        )}
                    </For>
                </div>
                </div>

                {/* Navigation arrows + dots — hidden in list mode (no paging). */}
                <Show when={hasMultiple() && !isListMode()}>
                    <button
                        class="hero-carousel__arrow hero-carousel__arrow--prev"
                        onClick={goPrev}
                        aria-label="Previous"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                    <button class="hero-carousel__arrow hero-carousel__arrow--next" onClick={goNext} aria-label="Next">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="9 6 15 12 9 18" />
                        </svg>
                    </button>

                    {/* Dots — one per PAGE (a screenful of `perPage` items),
                        active when the current index falls in that page's span.
                        Hidden entirely when `showDots` is false; color driven by
                        `dotColor` via the `--carousel-dot-color` custom property. */}
                    <Show when={props.options.showDots !== false}>
                        <div
                            class="hero-carousel__dots"
                            style={props.options.dotColor
                                ? { '--carousel-dot-color': props.options.dotColor, }
                                : undefined}
                        >
                            <For each={pages()}>
                                {(start, i,) => {
                                    // Active over [thisStart, nextStart) so a snapped final
                                    // page (which can overlap the previous one) doesn't
                                    // light up two dots at once.
                                    const nextStart = () => pages()[i() + 1] ?? itemCount();
                                    return (
                                        <button
                                            class={`hero-carousel__dot ${
                                                currentIndex() >= start && currentIndex() < nextStart()
                                                    ? 'hero-carousel__dot--active'
                                                    : ''
                                            }`}
                                            onClick={() => goTo(start,)}
                                            aria-label={`Go to page ${i() + 1}`}
                                        />
                                    );
                                }}
                            </For>
                        </div>
                    </Show>
                </Show>
            </Show>
        </div>
    );
};

export default HeroCarousel;
