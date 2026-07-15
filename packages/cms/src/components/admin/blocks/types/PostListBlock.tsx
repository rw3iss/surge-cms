/**
 * PostListBlock — admin editor for the `post_list` content block.
 *
 * The block doesn't store posts directly; it stores a *query
 * specification* (count, brevity, date filters, etc.) plus an optional
 * list of hand-picked post IDs (`pinnedPostIds`). The runtime
 * PostListRenderer feeds those settings into PostsService and renders
 * whatever comes back.
 *
 * The "specific posts" picker and the dynamic-query fields are the
 * shared <SpecificPostsField> / <PostQuerySection> controls (see
 * `../PostQueryControls`), also used by the carousel's Posts item. This
 * block adds its own brevity + show-field options on top.
 */
import { Component, For, JSX, Show, } from 'solid-js';
import { FormCheck, FormField, FormSection, } from '../../forms';
import { PostFieldsSection, PostQuerySection, SpecificPostsField, } from '../PostQueryControls';
import './PostListBlock.scss';

interface PostListBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

type Brevity = 'brief' | 'short' | 'full';

const BREVITY_HELP: JSX.Element = (
    <>
        <p style={{ margin: '0 0 4px 0', }}>
            <strong>Brief</strong>: Renders only the title, excerpt, and selected meta fields.
        </p>
        <p style={{ margin: '0 0 4px 0', }}>
            <strong>Short</strong>: Like brief, plus a clipped slice of the post content.
            Readers can optionally expand to see the full post inline.
        </p>
        <p style={{ margin: 0, }}>
            <strong>Full</strong>: Renders every block of every post in full.
        </p>
    </>
);

const PostListBlock: Component<PostListBlockProps> = (props,) => {
    const get = <K extends string,>(key: K, fallback: any,) => {
        const v = props.data[key];
        return v === undefined ? fallback : v;
    };

    const patch = (changes: Record<string, any>,) => {
        props.onUpdate({ ...props.data, ...changes, },);
    };

    const pinnedIds = (): string[] => {
        const v = props.data.pinnedPostIds;
        return Array.isArray(v,) ? v : [];
    };

    return (
        <div class="post-list-block-edit">
            {/* ─── Specific posts (shared) ─── */}
            <SpecificPostsField
                value={pinnedIds()}
                onChange={(ids,) => patch({ pinnedPostIds: ids, },)}
                tooltip="Hand-pick posts to render in the output. They appear at the top of the list, in the order shown. Drag to reorder, click × to remove. Specific posts render independently of the query below."
            />

            {/* ─── Render options (apply to both pinned + query results) ─── */}
            <FormSection title="Post brevity" tooltip={BREVITY_HELP} inlineItems tight>
                <For each={(['brief', 'short', 'full',] as Brevity[])}>
                    {(b,) => (
                        <label class="post-list-block-edit__radio">
                            <input
                                type="radio"
                                name="brevity"
                                checked={get('brevity', 'brief',) === b}
                                onChange={() => patch({ brevity: b, },)}
                            />
                            <span>{b.charAt(0,).toUpperCase() + b.slice(1,)}</span>
                        </label>
                    )}
                </For>
            </FormSection>

            <Show when={get('brevity', 'brief',) === 'short'}>
                <FormField
                    label="Short max height"
                    inline
                    tooltip="When brevity = Short, each post's content is clipped to this height. Use any valid CSS height (e.g. '400px', '50vh', '30rem'). Default: 400px."
                >
                    <input
                        type="text"
                        value={get('shortMaxHeight', '400px',)}
                        placeholder="400px"
                        onInput={(e,) => patch({ shortMaxHeight: e.currentTarget.value || undefined, },)}
                    />
                </FormField>
                <FormCheck
                    label="Allow expansion to full height"
                    checked={get('allowExpand', true,) === true}
                    onChange={(next,) => patch({ allowExpand: next, },)}
                    tooltip="Adds a 'See all' bar to clipped posts in the public output. Clicking it expands that post inline to its full height; a 'Hide all' bar appears at the top and bottom while expanded."
                />
            </Show>

            <PostFieldsSection
                value={props.data}
                onChange={(p,) => patch(p,)}
                defaults={{ showExcerpt: true, showDateCreated: true, showDateUpdated: false, showTags: true, }}
            />

            {/* ─── Posts query (shared) ─── */}
            <PostQuerySection
                value={props.data}
                onChange={(p,) => patch(p,)}
                emptyMessageTooltip="When on (default), the public output shows 'No posts match the current filters.' if the query returns zero results. Turn off to render nothing in that case — useful when the post-list block is supplementary and an empty placeholder would feel out of place."
            />
        </div>
    );
};

export default PostListBlock;
