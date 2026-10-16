/**
 * Public lightbox over a list of gallery items: ←/→/Esc, swipe, the media
 * full size (videos in our player via MediaVideo), title / caption / credits,
 * a counter and a link to the item's page. Full screen at every size.
 *
 * `thumbStrip`: a row of every item's THUMBNAIL (lazy) along the bottom, in
 * list order, the open item highlighted and kept centred. Desktop pages it
 * with ‹ › buttons; touch scrolls it natively (scroll-snap). Clicking a
 * thumbnail opens that item.
 */
import type { GalleryItem, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, on, onCleanup, onMount, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import MediaVideo from '../blocks/media/MediaVideo';
import { tileSrc, } from './GalleryTile';

export interface GalleryLightboxProps {
    items: GalleryItem[];
    index: number;
    onClose: () => void;
    /** Show a link to the item's page (default true). */
    showPageLink?: boolean;
    /** Thumbnail strip of every item along the bottom. */
    thumbStrip?: boolean;
}

const GalleryLightbox: Component<GalleryLightboxProps> = (props,) => {
    const [i, setI,] = createSignal(Math.max(0, Math.min(props.index, props.items.length - 1,),),);
    const item = () => props.items[i()];
    const count = () => props.items.length;
    const go = (d: number,) => setI((n,) => (n + d + count()) % count(),);
    let closeBtn: HTMLButtonElement | undefined;
    let track: HTMLDivElement | undefined;
    let touchX = 0;
    const strip = () => Boolean(props.thumbStrip,) && count() > 1;

    /** Centre the open item's thumbnail in the strip (horizontal only — never scrolls the page). */
    const centreActive = (smooth: boolean,) => {
        const el = track?.querySelector<HTMLElement>(`[data-index="${i()}"]`,);
        if (!track || !el) return;
        track.scrollTo({ left: el.offsetLeft - (track.clientWidth - el.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto', },);
    };
    createEffect(on(i, () => { if (strip()) requestAnimationFrame(() => centreActive(true,),); }, { defer: true, },),);
    /** Page the strip by most of its visible width. */
    const pageStrip = (dir: 1 | -1,) => track?.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: 'smooth', },);

    const onKey = (e: KeyboardEvent,) => {
        if (e.key === 'Escape') { e.preventDefault(); props.onClose(); }
        else if (e.key === 'ArrowRight' && count() > 1) { e.preventDefault(); go(1,); }
        else if (e.key === 'ArrowLeft' && count() > 1) { e.preventDefault(); go(-1,); }
    };
    onMount(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', onKey,);
        closeBtn?.focus();
        if (strip()) requestAnimationFrame(() => centreActive(false,),);
        onCleanup(() => {
            document.body.style.overflow = prev;
            document.removeEventListener('keydown', onKey,);
        },);
    },);

    return (
        <Portal>
            <div
                class="gallery-lightbox"
                classList={{ 'gallery-lightbox--strip': strip(), }}
                role="dialog"
                aria-modal="true"
                aria-label={item()?.title || 'Gallery'}
                onClick={(e,) => { if (e.target === e.currentTarget) props.onClose(); }}
                onTouchStart={(e,) => { touchX = e.touches[0]?.clientX ?? 0; }}
                onTouchEnd={(e,) => {
                    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX;
                    if (Math.abs(dx,) > 50 && count() > 1) go(dx < 0 ? 1 : -1,);
                }}
            >
                <button ref={closeBtn} type="button" class="gallery-lightbox__close" aria-label="Close" onClick={() => props.onClose()}>×</button>
                <Show when={count() > 1}>
                    <button type="button" class="gallery-lightbox__nav gallery-lightbox__nav--prev" aria-label="Previous" onClick={() => go(-1,)}>‹</button>
                    <button type="button" class="gallery-lightbox__nav gallery-lightbox__nav--next" aria-label="Next" onClick={() => go(1,)}>›</button>
                </Show>
                <Show when={item()}>
                    {(it,) => (
                        <figure class="gallery-lightbox__figure">
                            <div class="gallery-lightbox__stage">
                                <Show
                                    when={it().media?.type === 'video'}
                                    fallback={<img src={it().media?.url} alt={it().media?.alt || it().title || ''} />}
                                >
                                    {/* Keyed by id so moving to another video remounts the player. */}
                                    <Show when={it().media!.id} keyed>
                                        {(id,) => <MediaVideo mediaId={id} autoplay fallbackSrc={it().media?.url} class="gallery-lightbox__video" />}
                                    </Show>
                                </Show>
                            </div>
                            <figcaption class="gallery-lightbox__meta">
                                <div>
                                    <Show when={it().title}><strong class="gallery-lightbox__title">{it().title}</strong></Show>
                                    <Show when={it().caption}><p class="gallery-lightbox__caption">{it().caption}</p></Show>
                                    <Show when={it().media?.credits}><p class="gallery-lightbox__credits">{it().media!.credits}</p></Show>
                                </div>
                                <div class="gallery-lightbox__aside">
                                    <Show when={count() > 1}><span class="gallery-lightbox__count">{i() + 1} / {count()}</span></Show>
                                    <Show when={props.showPageLink !== false && it().url}>
                                        <a class="gallery-lightbox__link" href={it().url}>
                                            {it().commentCount ? `Comments (${it().commentCount})` : 'Open'}
                                        </a>
                                    </Show>
                                </div>
                            </figcaption>
                        </figure>
                    )}
                </Show>
                <Show when={strip()}>
                    {/* Touch here scrolls the strip; it must not also count as a swipe between items. */}
                    <div class="gallery-lightbox__strip" onTouchStart={(e,) => e.stopPropagation()} onTouchEnd={(e,) => e.stopPropagation()}>
                        <button type="button" class="gallery-lightbox__strip-page" aria-label="Previous thumbnails" onClick={() => pageStrip(-1,)}>‹</button>
                        <div ref={track} class="gallery-lightbox__strip-track" role="list" aria-label="All items">
                            <For each={props.items}>
                                {(t, n,) => (
                                    <button
                                        type="button"
                                        role="listitem"
                                        data-index={n()}
                                        class="gallery-lightbox__thumb"
                                        classList={{ 'is-active': n() === i(), 'is-video': t.media?.type === 'video', }}
                                        aria-label={t.title || `Item ${n() + 1}`}
                                        aria-current={n() === i() ? 'true' : undefined}
                                        onClick={() => setI(n(),)}
                                    >
                                        <Show when={tileSrc(t,)} fallback={<span class="gallery-lightbox__thumb-blank" aria-hidden="true">▶</span>}>
                                            <img src={tileSrc(t,)} alt="" loading="lazy" decoding="async" />
                                        </Show>
                                    </button>
                                )}
                            </For>
                        </div>
                        <button type="button" class="gallery-lightbox__strip-page" aria-label="Next thumbnails" onClick={() => pageStrip(1,)}>›</button>
                    </div>
                </Show>
            </div>
        </Portal>
    );
};

export default GalleryLightbox;
