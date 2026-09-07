/**
 * Image block — multi-image with per-image link, caption and maximise.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, } from '@sitesurge/types';
import { Component, For, Show, createEffect, createSignal, onCleanup, } from 'solid-js';
import { Portal, } from 'solid-js/web';

interface PublicImageItem {
    id: string;
    url: string;
    alt?: string;
    caption?: string;
    link?: string;
    allowMaximize?: boolean;
}

export function resolvePublicImages(block: Block,): PublicImageItem[] {
    const s = (block.settings || {}) as Record<string, any>;
    if (Array.isArray(s.images,) && s.images.length > 0) {
        return s.images.map((img: any,) => ({
            id: img.id,
            url: img.url || '',
            alt: img.alt,
            caption: img.caption,
            link: img.link,
            allowMaximize: img.allowMaximize === true,
        }),).filter(i => i.url);
    }
    const legacyUrl = block.content || (s.url as string) || '';
    if (!legacyUrl) return [];
    return [{
        id: 'legacy',
        url: legacyUrl,
        alt: (s.alt as string) || block.title || '',
        caption: s.caption as string | undefined,
        allowMaximize: s.allowMaximize === true,
    },];
}

export const ImageBlock: Component<{ block: Block; }> = (props,) => {
    const items = () => resolvePublicImages(props.block,);
    const s = () => (props.block.settings || {}) as Record<string, any>;
    const direction = () => (s().direction as string) || 'horizontal';
    const itemMinWidth = () => (s().itemMinWidth as string) || undefined;
    const itemMaxWidth = () => (s().itemMaxWidth as string) || undefined;
    const itemMinHeight = () => (s().itemMinHeight as string) || undefined;
    const itemMaxHeight = () => (s().itemMaxHeight as string) || undefined;
    // Per-block spacing between multiple images.
    const gap = () => (s().gap as string) || undefined;
    // Cross-axis alignment of the images within the flex container: for a row
    // this aligns them vertically, for a column horizontally. Stored as
    // start|center|end (valid `align-items` keywords); defaults to start.
    const align = () => (s().align as string) || 'start';

    // Legacy single-image alignment / maxWidth fields stay supported for
    // pages that haven't been re-edited since the multi-image upgrade.
    const alignment = () => s().alignment as string || 'left';
    const legacyMaxW = () => {
        const v = s().maxWidth;
        if (!v) return undefined;
        return typeof v === 'number' ? `${v}px` : String(v,);
    };
    const legacyMaxH = () => {
        const v = s().maxHeight;
        if (!v) return undefined;
        return typeof v === 'number' ? `${v}px` : String(v,);
    };
    const imgMargin = () =>
        alignment() === 'center' ?
            '0 auto' :
            alignment() === 'right' ?
            '0 0 0 auto' :
            undefined;

    const isMulti = () => items().length > 1 || Array.isArray(s().images,);
    const allowMaximizeAny = () => items().some(i => i.allowMaximize === true,);

    /** Currently-maximized image url; null when modal closed. */
    const [maximizedUrl, setMaximizedUrl,] = createSignal<string | null>(null,);

    createEffect(() => {
        if (!maximizedUrl()) return;
        const onKey = (e: KeyboardEvent,) => {
            if (e.key === 'Escape') setMaximizedUrl(null,);
        };
        document.addEventListener('keydown', onKey,);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        onCleanup(() => {
            document.removeEventListener('keydown', onKey,);
            document.body.style.overflow = prevOverflow;
        },);
    },);

    /** Container layout depends on multi vs single. Multi uses flex and
     *  flows naturally with the block style's gap; single keeps the
     *  legacy margin-based alignment behavior so old pages render
     *  identically until they're re-edited. */
    const containerStyle = (): Record<string, string | undefined> => {
        if (!isMulti()) return {};
        return {
            display: 'flex',
            'flex-direction': direction() === 'vertical' ? 'column' : 'row',
            'flex-wrap': 'wrap',
            'align-items': align(),
            gap: gap(),
        };
    };

    return (
        <div class="image-block image-block--multi" style={containerStyle()}>
            <For each={items()}>
                {(item,) => {
                    const itemStyle = (): Record<string, string | undefined> => {
                        if (isMulti()) {
                            return {
                                'min-width': itemMinWidth(),
                                'max-width': itemMaxWidth(),
                                'min-height': itemMinHeight(),
                                'max-height': itemMaxHeight(),
                                flex: '0 1 auto',
                            };
                        }
                        // Single-image legacy path.
                        return {
                            'max-width': legacyMaxW() || '100%',
                            'max-height': legacyMaxH(),
                            display: 'block',
                            margin: imgMargin(),
                        };
                    };

                    const onImgClick = item.allowMaximize ?
                        () => setMaximizedUrl(item.url,) :
                        undefined;

                    const imgEl = () => (
                        <img
                            src={item.url}
                            alt={item.alt || ''}
                            class={`image-block__img ${item.allowMaximize ? 'image-block__img--maximizable' : ''}`}
                            loading="lazy"
                            style={{
                                ...itemStyle(),
                                cursor: item.allowMaximize ? 'zoom-in' : undefined,
                                'object-fit': isMulti() ? 'cover' : undefined,
                                width: isMulti() ? '100%' : undefined,
                                height: isMulti() && itemMinHeight() ? '100%' : undefined,
                            }}
                            onClick={onImgClick}
                        />
                    );

                    return (
                        <div
                            class="image-block__item"
                            data-image-id={item.id}
                            style={isMulti() ? itemStyle() : undefined}
                        >
                            <Show
                                when={item.link}
                                fallback={imgEl()}
                            >
                                <a href={item.link} target="_blank" rel="noopener noreferrer">
                                    {imgEl()}
                                </a>
                            </Show>
                            <Show when={item.caption}>
                                <p class="image-block__caption">{item.caption}</p>
                            </Show>
                        </div>
                    );
                }}
            </For>

            {/* Maximize modal — shared across all images in the block. */}
            <Show when={allowMaximizeAny() && maximizedUrl()}>
                <Portal>
                    <div
                        class="image-block-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Image preview"
                        onClick={(e,) => {
                            if (e.target === e.currentTarget) setMaximizedUrl(null,);
                        }}
                    >
                        <button
                            type="button"
                            class="image-block-modal__close"
                            onClick={() => setMaximizedUrl(null,)}
                            aria-label="Close"
                        >
                            ×
                        </button>
                        <a
                            href={maximizedUrl()!}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="image-block-modal__link"
                            onClick={(e,) => e.stopPropagation()}
                            title="Open original in a new tab"
                        >
                            <img
                                src={maximizedUrl()!}
                                alt=""
                                class="image-block-modal__img"
                            />
                        </a>
                    </div>
                </Portal>
            </Show>
        </div>
    );
};
