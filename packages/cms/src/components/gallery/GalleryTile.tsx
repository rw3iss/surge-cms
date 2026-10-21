/**
 * One gallery item as a tile: image (lazy) or video poster + play badge, optional title/caption.
 * Fit: cover = the box, cropped; contain = the whole picture centred in the box;
 * hug = the tile hugs its media (`tileFrame`), placed by the view's alignment.
 * Title + caption: below (default) or above the picture, or ON it (top / bottom).
 */
import type { GalleryFit, GalleryItem, GalleryTitleAlign, GalleryTitlePosition, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import { mediaAspectOf, tileFrame, } from './galleryLayout';

export interface GalleryTileProps {
    item: GalleryItem;
    aspect?: string;
    fit?: GalleryFit;
    height?: string | null;
    showTitle?: boolean;
    showCaption?: boolean;
    /** Where the title + caption go (default below). */
    titlePosition?: GalleryTitlePosition;
    /** Title + caption alignment; unset = inherit (the block's Text Align). */
    titleAlign?: GalleryTitleAlign;
    videoBadge?: boolean;
    /** `lightbox`/`none` → a button-less figure the parent handles; `page` → a link to item.url. */
    href?: string | null;
    onOpen?: () => void;
    class?: string;
}

export const tileSrc = (item: GalleryItem,): string =>
    item.media ? (item.media.type === 'video' ? (item.media.thumbnailUrl || '') : (item.media.thumbnailUrl || item.media.url)) : '';

const GalleryTile: Component<GalleryTileProps> = (props,) => {
    const m = () => props.item.media;
    const isVideo = () => m()?.type === 'video';
    const alt = () => m()?.alt || props.item.title || '';
    // Fit = contain hugs the media (its own aspect, inside the limits) — no
    // letterbox fill, the item radius on the visible picture. Cover = the box.
    const frame = () => tileFrame(props.fit, props.aspect, props.height, mediaAspectOf(m(),),);
    const boxStyle = () => {
        const f = frame();
        if (f.kind === 'hug') return { width: f.width, 'aspect-ratio': f.aspectRatio, };
        if (f.kind === 'natural') return {};
        return { 'aspect-ratio': props.height ? undefined : props.aspect, height: props.height ?? undefined, };
    };
    const position = () => props.titlePosition ?? 'below';
    const overlay = () => position() === 'overlay-top' || position() === 'overlay-bottom';
    const hasText = () => Boolean((props.showTitle && props.item.title) || (props.showCaption && props.item.caption),);
    const textLines = () => (
        <>
            <Show when={props.showTitle && props.item.title}><strong class="gallery-tile__title">{props.item.title}</strong></Show>
            <Show when={props.showCaption && props.item.caption}><span class="gallery-tile__text">{props.item.caption}</span></Show>
        </>
    );
    const textStyle = () => (props.titleAlign ? { 'text-align': props.titleAlign, } : undefined);
    const natural = () => frame().kind === 'natural' || (frame().kind === 'box' && !props.aspect && !props.height);
    const media = () => (
        <div class="gallery-tile__media" style={boxStyle()}>
            <Show when={tileSrc(props.item,)} fallback={<div class="gallery-tile__placeholder" aria-hidden="true">{isVideo() ? '▶' : ''}</div>}>
                <img
                    src={tileSrc(props.item,)}
                    alt={alt()}
                    loading="lazy"
                    decoding="async"
                    style={(() => {
                        const f = frame();
                        if (f.kind === 'natural') return { 'max-height': f.maxHeight, };
                        return { 'object-fit': f.kind === 'hug' || props.fit !== 'contain' ? 'cover' : 'contain', } as const;
                    })()}
                    class={natural() ? 'gallery-tile__img--natural' : undefined}
                />
            </Show>
            <Show when={isVideo() && props.videoBadge !== false}>
                <span class="gallery-tile__play" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                </span>
            </Show>
            {/* ON the picture: inside the media box (the hit area), over a gradient. */}
            <Show when={overlay() && hasText()}>
                <div
                    class={`gallery-tile__caption gallery-tile__caption--overlay gallery-tile__caption--${position() === 'overlay-top' ? 'top' : 'bottom'}`}
                    style={textStyle()}
                >
                    {textLines()}
                </div>
            </Show>
        </div>
    );
    const caption = () => (
        <Show when={!overlay() && hasText()}>
            <figcaption class={`gallery-tile__caption gallery-tile__caption--${position()}`} style={textStyle()}>{textLines()}</figcaption>
        </Show>
    );
    return (
        <figure
            class={`gallery-tile${isVideo() ? ' gallery-tile--video' : ''}${frame().kind !== 'box' ? ' gallery-tile--hug' : ''}${props.fit === 'contain' ? ' gallery-tile--contain' : ''}${props.class ? ` ${props.class}` : ''}`}
        >
            <Show when={position() === 'above'}>{caption()}</Show>
            <Show
                when={props.href}
                fallback={
                    <Show when={props.onOpen} fallback={media()}>
                        <button type="button" class="gallery-tile__hit" aria-label={`Open ${alt() || 'item'}`} onClick={() => props.onOpen?.()}>
                            {media()}
                        </button>
                    </Show>
                }
            >
                <a class="gallery-tile__hit" href={props.href!} aria-label={alt() || 'Open item'}>{media()}</a>
            </Show>
            <Show when={position() !== 'above'}>{caption()}</Show>
        </figure>
    );
};

export default GalleryTile;
