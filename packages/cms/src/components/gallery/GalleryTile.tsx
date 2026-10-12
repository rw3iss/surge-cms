/** One gallery item as a tile: image (lazy) or video poster + play badge, optional title/caption. */
import type { GalleryItem, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';

export interface GalleryTileProps {
    item: GalleryItem;
    aspect?: string;
    fit?: 'cover' | 'contain';
    height?: string | null;
    showTitle?: boolean;
    showCaption?: boolean;
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
    const media = () => (
        <div
            class="gallery-tile__media"
            style={{ 'aspect-ratio': props.height ? undefined : props.aspect, height: props.height ?? undefined, }}
        >
            <Show when={tileSrc(props.item,)} fallback={<div class="gallery-tile__placeholder" aria-hidden="true">{isVideo() ? '▶' : ''}</div>}>
                <img
                    src={tileSrc(props.item,)}
                    alt={alt()}
                    loading="lazy"
                    decoding="async"
                    style={{ 'object-fit': props.fit ?? 'cover', }}
                    class={!props.aspect && !props.height ? 'gallery-tile__img--natural' : undefined}
                />
            </Show>
            <Show when={isVideo() && props.videoBadge !== false}>
                <span class="gallery-tile__play" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                </span>
            </Show>
        </div>
    );
    const caption = () => (
        <Show when={(props.showTitle && props.item.title) || (props.showCaption && props.item.caption)}>
            <figcaption class="gallery-tile__caption">
                <Show when={props.showTitle && props.item.title}><strong class="gallery-tile__title">{props.item.title}</strong></Show>
                <Show when={props.showCaption && props.item.caption}><span class="gallery-tile__text">{props.item.caption}</span></Show>
            </figcaption>
        </Show>
    );
    return (
        <figure class={`gallery-tile${isVideo() ? ' gallery-tile--video' : ''}${props.class ? ` ${props.class}` : ''}`}>
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
            {caption()}
        </figure>
    );
};

export default GalleryTile;
