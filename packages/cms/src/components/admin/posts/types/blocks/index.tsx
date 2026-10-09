import type { Component, } from 'solid-js';
import BlockEditor from '../../../blocks/BlockEditor';
import type { PostTypeEditorProps, } from '../types';

/**
 * The content-block editor — article, video, custom and any type whose
 * `editor` is `blocks`. No restrictions: a type's `defaultBlocks` only seed
 * a new post (done by the Post editor), they don't limit what can be added.
 */
const BlocksPostEditor: Component<PostTypeEditorProps> = (props,) => (
    <BlockEditor
        title="Content Blocks"
        blocks={props.blocks}
        savedBlocks={props.savedBlocks}
        onBlocksChange={props.onBlocksChange}
        onFullWidthChange={props.onFullWidthChange}
        containerStyle={props.containerStyle}
        containerClass="site-preview-container"
    />
);

export default BlocksPostEditor;
