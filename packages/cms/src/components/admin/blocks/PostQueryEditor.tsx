/**
 * PostQueryEditor — the carousel "Posts item" settings panel: ONE "Set data…"
 * (specific posts OR a live query) via the shared <PostDataField> (see
 * PostQueryControls), which it also shares with the `post_list` block.
 * Operates on a typed `HeroPostsConfig`.
 */
import type { HeroPostsConfig, } from '@sitesurge/types';
import { Component, } from 'solid-js';
import { PostDataField, PostFieldsSection, } from './PostQueryControls';

interface PostQueryEditorProps {
    value: HeroPostsConfig;
    onChange: (patch: Partial<HeroPostsConfig>,) => void;
}

const PostQueryEditor: Component<PostQueryEditorProps> = (props,) => {
    return (
        <div class="post-list-block-edit">
            <PostDataField
                value={props.value}
                onChange={props.onChange}
                emptyMessageTooltip="When on (default), a single 'No posts found' slide renders if the item resolves to zero posts. Turn off to render no slide at all in that case."
            />
            <PostFieldsSection
                value={props.value}
                onChange={props.onChange}
            />
        </div>
    );
};

export default PostQueryEditor;
