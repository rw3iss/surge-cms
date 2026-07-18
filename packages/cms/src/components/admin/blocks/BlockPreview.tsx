import { Component, Show, } from 'solid-js';
import { BlockRenderer, } from '../../blocks/BlockRenderer';
import { BlockStyleService, } from '../../../services/blockStyles';
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
    const renderBlock = () => {
        const { title, content, __styleRef: _drop, ...rest } = props.block.data || {};

        // Resolve style from styleRef or data.__styleRef (shared resolver).
        const resolvedStyle = BlockStyleService.resolve(props.block,);

        return {
            id: props.block.id,
            pageId: '',
            type: props.block.type,
            title: title || null,
            content: content || null,
            settings: rest,
            order: props.block.sort_order || 0,
            isVisible: true,
            style: resolvedStyle,
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
            !(d.items && d.items.length > 0);
    };

    return (
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
    );
};

export default BlockPreview;
