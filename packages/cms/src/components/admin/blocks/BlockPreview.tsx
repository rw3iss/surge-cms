import { Component, onCleanup, onMount, Show, } from 'solid-js';
import { BlockRenderer, } from '../../blocks/BlockRenderer';
import { BlockStyleService, } from '../../../services/blockStyles';
import { templatePreviewContext, } from '../../../stores/templatePreviewContext';
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

        // The preview breakpoint is NOT simulated here any more.
        //
        // This used to merge the breakpoint's overrides over the base style, so
        // the emitted "default" carried mobile values. That worked only for the
        // block this component renders directly — a component's inner blocks, an
        // entity slide and anything else reached through BlockRenderer got the
        // real `@media` rules, which cannot fire in a width-capped preview. They
        // kept showing desktop styles.
        //
        // `blockCss` now emits every breakpoint a second time as a `@container`
        // query, and the preview container declares that container name, so the
        // override reaches EVERY block inside it — no simulation, and one
        // mechanism instead of two that can disagree.
        const effectiveStyle = resolvedStyle;

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
        // A `template` block is empty only until a Component is chosen; once it
        // is, render the component itself. Without this it fell through to the
        // generic check below — which knows nothing about `templateId` — and
        // showed the "template / Click edit to configure" placeholder even for
        // a fully configured block.
        if (props.block.type === 'template') return !d.templateId;
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
                <BlockRenderer block={renderBlock() as any} preview={true} templateContext={templatePreviewContext()} />
            </Show>
        </div>
    );
};

export default BlockPreview;
