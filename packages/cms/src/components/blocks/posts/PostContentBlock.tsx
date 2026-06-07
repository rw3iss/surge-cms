import { Component, } from 'solid-js';
import { BlockRenderer, } from '../BlockRenderer';

/**
 * Renders a single post content block on the public post page.
 *
 * Converts the post content block data shape (everything in `block.data`)
 * to the page Block shape (separate content/title/settings/style) and
 * delegates to BlockRenderer — the single shared renderer for ALL block
 * types on both posts and pages.
 *
 * This ensures every block type gets identical style application
 * (background, padding, overflow, alignment, etc.) regardless of
 * whether it lives in a post or a page.
 */
const PostContentBlock: Component<{ block: any; }> = (props,) => {
    const renderBlock = () => {
        const raw = props.block;
        const data = raw.data || {};
        const { content, title, __styleRef, ...settings } = data;

        // Resolve style: block.style (from API with template resolved),
        // or data.__styleRef.custom, or nothing
        const style = raw.style || (__styleRef?.custom) || undefined;

        return {
            id: raw.id,
            pageId: '',
            type: raw.type,
            title: title || null,
            content: content || null,
            settings,
            order: raw.sortOrder || raw.sort_order || 0,
            isVisible: true,
            style,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    };

    return <BlockRenderer block={renderBlock() as any} />;
};

export default PostContentBlock;
