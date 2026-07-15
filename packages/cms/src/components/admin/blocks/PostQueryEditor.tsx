/**
 * PostQueryEditor — the carousel "Posts item" settings panel: hand-picked
 * "specific posts" + an optional dynamic query. A thin composition of the
 * shared <SpecificPostsField> + <PostQuerySection> controls (see
 * PostQueryControls), which it also shares with the `post_list` block.
 * Operates on a typed `HeroPostsConfig`.
 */
import type { HeroPostsConfig, } from '@sitesurge/types';
import { Component, } from 'solid-js';
import { PostFieldsSection, PostQuerySection, SpecificPostsField, } from './PostQueryControls';

interface PostQueryEditorProps {
    value: HeroPostsConfig;
    onChange: (patch: Partial<HeroPostsConfig>,) => void;
}

const PostQueryEditor: Component<PostQueryEditorProps> = (props,) => {
    return (
        <div class="post-list-block-edit">
            <SpecificPostsField
                value={props.value.pinnedPostIds ?? []}
                onChange={(ids,) => props.onChange({ pinnedPostIds: ids, },)}
                tooltip="Hand-pick posts to render first, in the order shown. Drag to reorder, click × to remove. Specific posts render before any query results below."
            />
            <PostFieldsSection
                value={props.value}
                onChange={props.onChange}
            />
            <PostQuerySection
                value={props.value}
                onChange={props.onChange}
                emptyMessageTooltip="When on (default), a single 'No posts found' slide renders if the item resolves to zero posts. Turn off to render no slide at all in that case."
            />
        </div>
    );
};

export default PostQueryEditor;
