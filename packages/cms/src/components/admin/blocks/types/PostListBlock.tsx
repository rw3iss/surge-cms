/**
 * PostListBlock — admin editor for the `post_list` content block.
 *
 * The block doesn't store posts directly; it stores a *query
 * specification* (count, brevity, date filters, etc.) plus an optional
 * list of hand-picked post IDs (`pinnedPostIds`). The runtime
 * PostListRenderer feeds those settings into PostsService and renders
 * whatever comes back.
 *
 * The data is ONE "Set data…" — the shared <PostDataField> (see
 * `../PostQueryControls`), also used by the carousel's Posts item: ticked
 * posts → `pinnedPostIds`, none ticked → the live query. This block adds its
 * own brevity + show-field options on top.
 */
import { Component, For, JSX, Show, } from 'solid-js';
import { templateSlots, } from '../../../../stores/templateSlots';
import { slotChoices, slotOptionLabel, } from '../../../../utils/templateSlots';
import { FormCheck, FormField, FormSection, } from '../../forms';
import { PostDataField, PostFieldsSection, } from '../PostQueryControls';
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

    /** `PostListSlotSettings.source`: 'slot' = posts come from a template slot. */
    const fromSlot = () => props.data.source === 'slot';
    /** Offered only inside a template that declares slots (or when the block
     *  already reads one, so it can be seen and switched away). */
    const offerSlot = () => templateSlots().length > 0 || fromSlot();

    return (
        <div class="post-list-block-edit">
            <Show when={offerSlot()}>
                <FormField label="Source" tooltip="Use this block's own posts/query, or the posts the block using this template puts in a slot.">
                    <select
                        value={fromSlot() ? 'slot' : 'default'}
                        onChange={(e,) => patch({ source: e.currentTarget.value === 'slot' ? 'slot' : undefined, },)}
                    >
                        <option value="default">This block's posts + query</option>
                        <option value="slot">Slot (from the block using this template)</option>
                    </select>
                </FormField>
                <Show when={fromSlot()}>
                    <FormField label="Slot" hint="The block that uses this template chooses the posts for this slot.">
                        <select value={props.data.slotId ?? ''} onChange={(e,) => patch({ slotId: e.currentTarget.value || undefined, },)}>
                            <option value="">— select a slot —</option>
                            <For each={slotChoices(templateSlots(), 'post',)}>
                                {(c,) => (
                                    <option value={c.slot.id} disabled={!c.compatible}>
                                        {slotOptionLabel(c.slot,)}{c.compatible ? '' : ' (incompatible)'}
                                    </option>
                                )}
                            </For>
                        </select>
                    </FormField>
                </Show>
            </Show>

            {/* ─── Data: specific posts OR a live query (shared) ─── */}
            <Show when={!fromSlot()}>
                <PostDataField
                    value={props.data}
                    onChange={(p,) => patch(p,)}
                    emptyMessageTooltip="When on (default), the public output shows 'No posts match the current filters.' if the query returns zero results. Turn off to render nothing in that case — useful when the post-list block is supplementary and an empty placeholder would feel out of place."
                />
            </Show>

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
                        onChange={(e,) => patch({ shortMaxHeight: e.currentTarget.value || undefined, },)}
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
                defaults={{ showExcerpt: true, showAuthor: false, showDateCreated: true, showDateUpdated: false, showTags: true, }}
            />

        </div>
    );
};

export default PostListBlock;
