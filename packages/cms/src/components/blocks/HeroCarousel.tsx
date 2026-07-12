import type { HeroCarouselOptions, HeroItem, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, Match, on, onCleanup, Show, Switch, } from 'solid-js';
import './HeroCarousel.scss';

export interface HeroCarouselProps {
    items: HeroItem[];
    options: HeroCarouselOptions;
    height?: string;
    previewMode?: boolean;
    gutterWidth?: string;
}

const DEFAULT_HEIGHT = '50vh';

/** Map heading size to a CSS custom property value (rem) so we control sizing directly */
const HEADER_SIZES: Record<string, string> = {
    h1: '5.5rem', // 88px
    h2: '4.875rem', // 78px
    h3: '4.25rem', // 68px
    h4: '3.625rem', // 58px
    h5: '3rem', // 48px
    h6: '2.375rem', // 38px
};

const SUBHEADER_SIZES: Record<string, string> = {
    h1: '3.25rem', // 52px
    h2: '2.875rem', // 46px
    h3: '2.5rem', // 40px
    h4: '2.125rem', // 34px
    h5: '1.75rem', // 28px
    h6: '1.375rem', // 22px
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
                            <div class="hero-carousel__slide">
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
