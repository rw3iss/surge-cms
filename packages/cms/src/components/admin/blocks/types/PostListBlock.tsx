/**
 * PostListBlock — admin editor for the `post_list` content block.
 *
 * The block doesn't store posts directly; it stores a *query
 * specification* (count, brevity, date filters, etc.) plus an optional
 * list of hand-picked post IDs (`pinnedPostIds`). The runtime
 * PostListRenderer feeds those settings into PostsService and renders
 * whatever comes back.
 *
 * UI structure here uses the shared admin form primitives
 * (FormField / FormCheck / FormSection) so labels, inline rows and
 * checkbox groups all render with the canonical small-bold label
 * style used elsewhere in admin (see `components/admin/forms/`).
 */
import type { Post, } from '@sitesurge/types';
import { Component, createSignal, For, JSX, onMount, Show, } from 'solid-js';
import { cms, } from '../../../../services/cmsClient';
import { FormCheck, FormField, FormSection, } from '../../forms';
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

const SORT_OPTIONS: { value: string; label: string; }[] = [
    { value: 'updated_desc', label: 'Recently updated', },
    { value: 'date_desc', label: 'Newest', },
    { value: 'date_asc', label: 'Oldest', },
    { value: 'title_asc', label: 'Title A→Z', },
    { value: 'title_desc', label: 'Title Z→A', },
];

/** Tighter, more legible drag handle than `⋮⋮`. Two columns of three
 *  dots in a 2:3 grid — the standard "drag to reorder" affordance. */
const DragHandleIcon = () => (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
        <circle cx="2.5" cy="3" r="1.2" fill="currentColor" />
        <circle cx="7.5" cy="3" r="1.2" fill="currentColor" />
        <circle cx="2.5" cy="7" r="1.2" fill="currentColor" />
        <circle cx="7.5" cy="7" r="1.2" fill="currentColor" />
        <circle cx="2.5" cy="11" r="1.2" fill="currentColor" />
        <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
    </svg>
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

    // ─── Resolved-post lookup (for showing titles in the pinned list) ─
    const [pinnedDetails, setPinnedDetails,] = createSignal<Record<string, Post>>({},);

    /**
     * Fetch each pinned post via the admin endpoint so drafts /
     * scheduled posts also resolve. The public `/posts?ids=`
     * filter only returns published posts and would leave drafts
     * unnamed. Failures are tolerated silently — the row falls back
     * to the truncated ID.
     */
    const loadPinnedDetails = async (ids: string[],) => {
        if (ids.length === 0) { setPinnedDetails({},); return; }
        const results = await Promise.all(ids.map(async (id,) => {
            try {
                return await cms.posts.getById(id,) as unknown as Post;
            } catch { /* ignore — show fallback ID */ }
            return null;
        }),);
        const map: Record<string, Post> = { ...pinnedDetails(), };
        for (let i = 0; i < ids.length; i++) {
            const p = results[i];
            if (p) map[ids[i]] = p;
        }
        setPinnedDetails(map,);
    };

    onMount(() => {
        loadPinnedDetails(pinnedIds(),);
    },);

    // ─── Picker modal state ──────────────────────────────────────
    const [pickerOpen, setPickerOpen,] = createSignal(false,);
    const [pickerSearch, setPickerSearch,] = createSignal('',);
    const [pickerSort, setPickerSort,] = createSignal('date_desc',);
    const [pickerPosts, setPickerPosts,] = createSignal<Post[]>([],);
    const [pickerLoading, setPickerLoading,] = createSignal(false,);
    const [pickerSelected, setPickerSelected,] = createSignal<Set<string>>(new Set(),);

    const openPicker = () => {
        setPickerSelected(new Set(pinnedIds(),),);
        setPickerOpen(true,);
        void loadPickerPosts();
    };

    const loadPickerPosts = async () => {
        setPickerLoading(true,);
        try {
            // Admin endpoint — includes drafts so users can pin them.
            const params: Record<string, unknown> = {
                page: 1,
                limit: 100,
                sort: pickerSort(),
            };
            if (pickerSearch().trim()) params.search = pickerSearch().trim();
            const res = await cms.posts.list(params as any,);
            setPickerPosts((res.data || []) as unknown as Post[],);
        } catch {
            setPickerPosts([],);
        } finally {
            setPickerLoading(false,);
        }
    };

    const togglePickerSelect = (id: string,) => {
        setPickerSelected(prev => {
            const next = new Set(prev,);
            if (next.has(id,)) next.delete(id,);
            else next.add(id,);
            return next;
        },);
    };

    const acceptPicker = () => {
        const existing = pinnedIds();
        const sel = pickerSelected();
        const kept = existing.filter(id => sel.has(id,));
        const added = [...sel,].filter(id => !existing.includes(id,));
        const next = [...kept, ...added,];
        patch({ pinnedPostIds: next, },);

        // Pre-populate pinnedDetails from the picker's loaded posts so
        // titles appear immediately — no second round-trip.
        const picked = pickerPosts();
        const map: Record<string, Post> = { ...pinnedDetails(), };
        for (const p of picked) {
            if (sel.has((p as any).id,)) map[(p as any).id] = p;
        }
        setPinnedDetails(map,);

        // Also fetch any newly-added IDs that weren't in pickerPosts
        // (rare — could happen if pagination cut off the picker list).
        const missing = added.filter(id => !map[id]);
        if (missing.length > 0) void loadPinnedDetails(missing,);

        setPickerOpen(false,);
    };

    const cancelPicker = () => setPickerOpen(false,);

    // ─── Pinned-list mutation helpers ────────────────────────────
    const removePinned = (id: string,) => {
        const next = pinnedIds().filter(x => x !== id);
        patch({ pinnedPostIds: next, },);
        // No need to fetch — we already have details for IDs that were
        // visible. Just drop the removed entry.
        const map = { ...pinnedDetails(), };
        delete map[id];
        setPinnedDetails(map,);
    };

    const [dragIndex, setDragIndex,] = createSignal<number | null>(null,);

    const onDragStart = (e: DragEvent, idx: number,) => {
        setDragIndex(idx,);
        e.dataTransfer?.setData('text/plain', String(idx,),);
        e.dataTransfer!.effectAllowed = 'move';
    };
    const onDragOver = (e: DragEvent,) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    };
    const onDrop = (e: DragEvent, dropIdx: number,) => {
        e.preventDefault();
        const from = dragIndex();
        setDragIndex(null,);
        if (from === null || from === dropIdx) return;
        const ids = [...pinnedIds(),];
        const [moved,] = ids.splice(from, 1,);
        ids.splice(dropIdx, 0, moved,);
        patch({ pinnedPostIds: ids, },);
    };

    /** Whether the dynamic-query section is enabled. Default true so
     *  blocks created before this toggle existed keep the same
     *  behavior; new blocks get the toggle's stored value. */
    const queryEnabled = () => get('queryEnabled', true,) !== false;

    return (
        <div class="post-list-block-edit">
            {/* ─── Specific posts (always at the top) ─── */}
            <FormSection
                title="Specific posts"
                tooltip="Hand-pick posts to render in the output. They appear at the top of the list, in the order shown. Drag to reorder, click × to remove. Specific posts render independently of the query below."
            >
                <div class="post-list-block-edit__pinned">
                    <Show when={pinnedIds().length === 0}>
                        <div class="post-list-block-edit__pinned-empty">No specific posts selected.</div>
                    </Show>
                    <For each={pinnedIds()}>
                        {(id, idx,) => {
                            const p = () => pinnedDetails()[id];
                            return (
                                <div
                                    class="post-list-block-edit__pinned-item"
                                    draggable={true}
                                    onDragStart={(e,) => onDragStart(e, idx(),)}
                                    onDragOver={onDragOver}
                                    onDrop={(e,) => onDrop(e, idx(),)}
                                >
                                    <span class="post-list-block-edit__pinned-handle" title="Drag to reorder">
                                        <DragHandleIcon />
                                    </span>
                                    <span class="post-list-block-edit__pinned-title">
                                        {p()?.title || `Post ${id.slice(0, 8,)}…`}
                                    </span>
                                    <button
                                        type="button"
                                        class="post-list-block-edit__pinned-remove"
                                        onClick={() => removePinned(id,)}
                                        title="Remove"
                                    >
                                        ×
                                    </button>
                                </div>
                            );
                        }}
                    </For>
                    <button
                        type="button"
                        class="btn btn--secondary btn--small"
                        onClick={openPicker}
                    >
                        + Select posts
                    </button>
                </div>
            </FormSection>

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

            <FormSection title="Show fields" tight padded inlineItems>
                <FormCheck
                    label="Description / Excerpt"
                    plain
                    checked={get('showExcerpt', true,) === true}
                    onChange={(next,) => patch({ showExcerpt: next, },)}
                />
                <FormCheck
                    label="Date created"
                    plain
                    checked={get('showDateCreated', true,) === true}
                    onChange={(next,) => patch({ showDateCreated: next, },)}
                />
                <FormCheck
                    label="Date updated"
                    plain
                    checked={get('showDateUpdated', false,) === true}
                    onChange={(next,) => patch({ showDateUpdated: next, },)}
                />
                <FormCheck
                    label="Tags"
                    plain
                    checked={get('showTags', true,) === true}
                    onChange={(next,) => patch({ showTags: next, },)}
                />
            </FormSection>

            {/* ─── Posts query (toggled) ─── */}
            <FormCheck
                label="Enable posts query"
                checked={queryEnabled()}
                onChange={(next,) => patch({ queryEnabled: next, },)}
                tooltip="When on, runs a dynamic query against your posts (count, date filters, full-text search) and renders the results below any specific posts above. Turn off to render only the specific posts you've pinned."
            />

            <Show when={queryEnabled()}>
                <div class="post-list-block-edit__query-panel">
                    <FormField label="Number of posts" inline>
                        <input
                            type="number"
                            min="1"
                            max="100"
                            value={get('count', 5,)}
                            onInput={(e,) => patch({ count: Number(e.currentTarget.value,) || undefined, },)}
                        />
                    </FormField>

                    <div class="post-list-block-edit__row-pair">
                        <FormField
                            label="Posts after (days ago)"
                            tooltip="Show posts older than this many days. Leave blank for no lower bound. Useful for archive feeds."
                        >
                            <input
                                type="number"
                                min="0"
                                value={get('afterDaysAgo', '',)}
                                placeholder="leave blank for no limit"
                                onInput={(e,) => {
                                    const v = e.currentTarget.value;
                                    patch({ afterDaysAgo: v === '' ? undefined : Number(v,), },);
                                }}
                            />
                        </FormField>
                        <FormField
                            label="Posts before (days ago)"
                            tooltip="Show posts newer than this many days ago. Leave blank for no upper bound. Useful for recent-posts feeds."
                        >
                            <input
                                type="number"
                                min="0"
                                value={get('beforeDaysAgo', '',)}
                                placeholder="leave blank for no limit"
                                onInput={(e,) => {
                                    const v = e.currentTarget.value;
                                    patch({ beforeDaysAgo: v === '' ? undefined : Number(v,), },);
                                }}
                            />
                        </FormField>
                    </div>

                    <FormField
                        label="Search filter"
                        tooltip="Free-text query — the backend full-text searches post titles + bodies for matching posts. Combined with the date / tag filters above."
                    >
                        <input
                            type="text"
                            value={get('query', '',)}
                            placeholder="e.g. interview, election, …"
                            onInput={(e,) => patch({ query: e.currentTarget.value || undefined, },)}
                        />
                    </FormField>

                    <FormCheck
                        label="Show message when there are no posts"
                        checked={get('showEmptyMessage', true,) === true}
                        onChange={(next,) => patch({ showEmptyMessage: next, },)}
                        tooltip="When on (default), the public output shows 'No posts match the current filters.' if the query returns zero results. Turn off to render nothing in that case — useful when the post-list block is supplementary and an empty placeholder would feel out of place."
                    />
                </div>
            </Show>

            {/* ─── Picker modal ─── */}
            <Show when={pickerOpen()}>
                <div class="post-picker-overlay" onClick={(e,) => { if (e.target === e.currentTarget) cancelPicker(); }}>
                    <div class="post-picker">
                        <div class="post-picker__header">
                            <h3 class="post-picker__title">Select posts</h3>
                            <button class="post-picker__close" onClick={cancelPicker} type="button">×</button>
                        </div>
                        <div class="post-picker__filters">
                            <input
                                type="text"
                                class="post-picker__search"
                                value={pickerSearch()}
                                placeholder="Filter by title or body…"
                                onInput={(e,) => setPickerSearch(e.currentTarget.value,)}
                                onKeyDown={(e,) => { if (e.key === 'Enter') void loadPickerPosts(); }}
                            />
                            <select
                                class="post-picker__sort"
                                value={pickerSort()}
                                onChange={(e,) => { setPickerSort(e.currentTarget.value,); void loadPickerPosts(); }}
                            >
                                <For each={SORT_OPTIONS}>
                                    {(o,) => <option value={o.value}>{o.label}</option>}
                                </For>
                            </select>
                            <button
                                type="button"
                                class="btn btn--secondary btn--small"
                                onClick={() => void loadPickerPosts()}
                            >
                                Apply
                            </button>
                        </div>
                        <div class="post-picker__list">
                            <Show when={pickerLoading()}>
                                <div class="post-picker__loading">Loading…</div>
                            </Show>
                            <Show when={!pickerLoading() && pickerPosts().length === 0}>
                                <div class="post-picker__empty">No posts match.</div>
                            </Show>
                            <For each={pickerPosts()}>
                                {(p,) => {
                                    const id = (p as any).id as string;
                                    const selected = () => pickerSelected().has(id,);
                                    return (
                                        <div
                                            class={`post-picker__item ${selected() ? 'post-picker__item--selected' : ''}`}
                                            onClick={() => togglePickerSelect(id,)}
                                        >
                                            <div class="post-picker__item-title">{p.title}</div>
                                            <div class="post-picker__item-meta">
                                                <span class="post-picker__item-status">{p.status}</span>
                                                <span>{p.slug}</span>
                                            </div>
                                        </div>
                                    );
                                }}
                            </For>
                        </div>
                        <div class="post-picker__actions">
                            <span class="post-picker__count">
                                {pickerSelected().size} selected
                            </span>
                            <button class="btn btn--secondary" onClick={cancelPicker} type="button">Cancel</button>
                            <button class="btn btn--primary" onClick={acceptPicker} type="button">Accept</button>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    );
};

export default PostListBlock;
