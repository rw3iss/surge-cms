/**
 * Public lightbox over a list of gallery items: ←/→/Esc, swipe, the media
 * full size (videos in our player via MediaVideo), title / caption / credits,
 * a counter and a link to the item's page.
 */
import type { GalleryItem, } from '@sitesurge/types';
import { Component, createSignal, onCleanup, onMount, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import MediaVideo from '../blocks/media/MediaVideo';

export interface GalleryLightboxProps {
    items: GalleryItem[];
    index: number;
    onClose: () => void;
    /** Show a link to the item's page (default true). */
    showPageLink?: boolean;
}

const GalleryLightbox: Component<GalleryLightboxProps> = (props,) => {
    const [i, setI,] = createSignal(Math.max(0, Math.min(props.index, props.items.length - 1,),),);
    const item = () => props.items[i()];
    const count = () => props.items.length;
    const go = (d: number,) => setI((n,) => (n + d + count()) % count(),);
    let closeBtn: HTMLButtonElement | undefined;
    let touchX = 0;

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
        onCleanup(() => {
            document.body.style.overflow = prev;
            document.removeEventListener('keydown', onKey,);
        },);
    },);

    return (
        <Portal>
            <div
                class="gallery-lightbox"
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
            </div>
        </Portal>
    );
};

export default GalleryLightbox;
