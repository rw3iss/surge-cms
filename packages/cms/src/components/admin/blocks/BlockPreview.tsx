import { Component, onCleanup, onMount, Show, } from 'solid-js';
import { BlockRenderer, } from '../../blocks/BlockRenderer';
import { BlockStyleService, } from '../../../services/blockStyles';
import { previewBreakpoint, } from '../../../stores/previewBreakpoint';
import type { BlockData, } from './ContentBlock';

interface BlockPreviewProps {
    block: BlockData;
}

/**
 * Renders admin BlockData using the public BlockRenderer so the admin
 * preview looks identical to the live site. Resolves style template
 * references to actual style objects.
 */
const BlockPreview: Component<BlockPreviewProps> = (props,) => {
    let guardRef: HTMLDivElement | undefined;

    // While authoring, neutralize clicks that originate inside the rendered
    // preview content. A Custom HTML block (or any block) may contain links,
    // buttons, or forms that would otherwise navigate, open a new tab, submit,
    // or run inline handlers when the operator clicks the preview. Handling
    // this in the capture phase + stopPropagation also keeps the click from
    // reaching the block's select/toggle handler, so a block is selected via
    // its hover bar instead. The empty-state placeholder is exempted so a
    // brand-new block can still be selected by clicking it.
    const silenceContentClick = (e: MouseEvent,) => {
        if ((e.target as HTMLElement).closest('.block-preview__empty',)) return;
        e.preventDefault();
        e.stopPropagation();
    };
    onMount(() => guardRef?.addEventListener('click', silenceContentClick, true,));
    onCleanup(() => guardRef?.removeEventListener('click', silenceContentClick, true,));

    const renderBlock = () => {
        const { title, content, __styleRef: _drop, ...rest } = props.block.data || {};

        // Resolve style from styleRef or data.__styleRef (shared resolver).
        const resolvedStyle = BlockStyleService.resolve(props.block,);

        // Simulate the active "Preview breakpoint" by merging that breakpoint's
        // overrides over the base style — so BlockPreview-rendered blocks
        // (carousel, image, …) reflect the responsive changes in the editor, not
        // just on the live site (the device preview only caps width, so real
        // @media queries don't fire here).
        const pbp = previewBreakpoint();
        const ov = pbp ? (resolvedStyle as Record<string, any> | undefined)?.breakpoints?.[pbp] : undefined;
        const effectiveStyle = ov && Object.keys(ov,).length ? { ...resolvedStyle, ...ov, } : resolvedStyle;

        return {
            id: props.block.id,
            pageId: '',
            type: props.block.type,
            title: title || null,
            content: content || null,
            settings: rest,
            order: props.block.sort_order || 0,
            isVisible: true,
            style: effectiveStyle,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    };

    const isEmpty = () => {
        // Spacer blocks are never "empty" — they render at their height
        if (props.block.type === 'spacer') return false;
        // Post-list is also never "empty" — it always queries posts,
        // even with default settings. Showing the picker placeholder
        // here would be misleading.
        if (props.block.type === 'post_list') return false;
        const d = props.block.data || {};
        // Hero is "empty" only when none of its visual fields are set —
        // title or subtitle alone is enough to render meaningfully.
        if (props.block.type === 'hero') {
            return !d.title && !d.subtitle && !d.content && !d.backgroundImage;
        }
        return !d.content && !d.url && !d.postId && !d.postUrl &&
            !d.socialPlatform && !d.platform && !d.campaignId &&
            !d.formId && !d.slug && !d.galleryId &&
            !(d.items && d.items.length > 0) &&
            // Multi-image blocks store their images in `images[]` (the legacy
            // single-image `url` is handled above) — treat a block with any
            // image as non-empty so its preview renders instead of the hint.
            !(Array.isArray(d.images,) && d.images.some((img: { url?: string; },) => img && img.url));
    };

    return (
        <div ref={guardRef} style={{ display: 'contents', }}>
            <Show
                when={!isEmpty()}
                fallback={
                    <div class="block-preview__empty">
                        <span class="block-preview__empty-label">
                            {props.block.type.replace(/_/g, ' ',)}
                        </span>
                        <span class="block-preview__empty-hint">Click edit to configure</span>
                    </div>
                }
            >
                <BlockRenderer block={renderBlock() as any} preview={true} />
            </Show>
        </div>
    );
};

export default BlockPreview;
