import type { HeroCarouselOptions, HeroItem, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, on, onCleanup, Show, } from 'solid-js';
import { TEXT_ALIGN, toFlexAlign, } from '../../utils/cssAlign';
import './HeroCarousel.scss';

export interface HeroCarouselProps {
    items: HeroItem[];
    options: HeroCarouselOptions;
    height?: string;
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

    const itemCount = () => props.items.length;
    const hasMultiple = () => itemCount() > 1;

    const resolvedHeight = () => {
        if (props.height) return props.height;
        if (props.options.customHeight && props.options.height) return props.options.height;
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

        let target = index;
        if (props.options.repeat) {
            target = ((index % count) + count) % count;
        } else {
            target = Math.max(0, Math.min(count - 1, index,),);
        }

        setIsTransitioning(true,);
        setCurrentIndex(target,);
        setTimeout(() => setIsTransitioning(false,), 500,);
    };

    const goNext = () => goTo(currentIndex() + 1,);
    const goPrev = () => goTo(currentIndex() - 1,);

    // ─── Auto-scroll ───

    const startAutoScroll = () => {
        stopAutoScroll();
        if (!props.options.autoScroll || !hasMultiple()) return;
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
        () => [props.options.autoScroll, props.options.autoScrollInterval, props.options.repeat, props.items.length,],
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
            const isActive = currentIndex() === index;
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
            class={`hero-carousel ${props.previewMode ? 'hero-carousel--preview' : ''}`}
            style={{
                height: resolvedHeight(),
                ...alignVars(),
                ...(props.options.applyGutter && props.gutterWidth ? {
                    'padding-left': props.gutterWidth,
                    'padding-right': props.gutterWidth,
                } : {}),
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
                <div
                    ref={trackRef}
                    class="hero-carousel__track"
                    style={{
                        transform: `translateX(-${currentIndex() * 100}%)`,
                        transition: isTransitioning() ? 'transform 0.5s ease-in-out' : 'none',
                    }}
                >
                    <For each={props.items}>
                        {(item, index,) => (
                            <div
                                class="hero-carousel__slide"
                                // No backdrop → the block-style color fills the
                                // slide container directly.
                                style={props.itemBackground && !hasBackdrop(item)
                                    ? { background: props.itemBackground, }
                                    : undefined}
                            >
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
                            </div>
                        )}
                    </For>
                </div>

                {/* Navigation arrows */}
                <Show when={hasMultiple()}>
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

                    {/* Dots */}
                    <div class="hero-carousel__dots">
                        <For each={props.items}>
                            {(_, i,) => (
                                <button
                                    class={`hero-carousel__dot ${
                                        currentIndex() === i() ? 'hero-carousel__dot--active' : ''
                                    }`}
                                    onClick={() => goTo(i(),)}
                                    aria-label={`Go to slide ${i() + 1}`}
                                />
                            )}
                        </For>
                    </div>
                </Show>
            </Show>
        </div>
    );
};

export default HeroCarousel;
