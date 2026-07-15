/**
 * PostQueryEditor — a self-contained editor for a post-query spec
 * (`HeroPostsConfig`): hand-picked "specific posts" + an optional
 * dynamic query (count / date window / search) + an empty-message
 * toggle.
 *
 * It's the carousel's "Posts item" settings panel and is modeled on the
 * `post_list` block's specific-posts + query sections (see
 * `types/PostListBlock.tsx`) — minus the brevity / show-field options,
 * which don't apply to a carousel slide. Styles are reused from
 * `PostListBlock.scss`.
 */
import type { HeroPostsConfig, Post, } from '@sitesurge/types';
import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { FormCheck, FormField, FormSection, } from '../forms';
import './types/PostListBlock.scss';

interface PostQueryEditorProps {
    value: HeroPostsConfig;
    onChange: (patch: Partial<HeroPostsConfig>,) => void;
}

const SORT_OPTIONS: { value: string; label: string; }[] = [
    { value: 'date_desc', label: 'Newest', },
    { value: 'date_asc', label: 'Oldest', },
    { value: 'updated_desc', label: 'Recently updated', },
    { value: 'title_asc', label: 'Title A→Z', },
    { value: 'title_desc', label: 'Title Z→A', },
];

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

const PostQueryEditor: Component<PostQueryEditorProps> = (props,) => {
    const pinnedIds = (): string[] => {
        const v = props.value.pinnedPostIds;
        return Array.isArray(v,) ? v : [];
    };
    const queryEnabled = () => props.value.queryEnabled !== false;

    // ─── Resolved-post lookup (titles for the pinned list) ───
    const [pinnedDetails, setPinnedDetails,] = createSignal<Record<string, Post>>({},);

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

    onMount(() => { void loadPinnedDetails(pinnedIds(),); },);

    // ─── Picker modal state ───
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
            const params: Record<string, unknown> = { page: 1, limit: 100, sort: pickerSort(), };
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
        props.onChange({ pinnedPostIds: next, },);

        const picked = pickerPosts();
        const map: Record<string, Post> = { ...pinnedDetails(), };
        for (const p of picked) {
            if (sel.has((p as any).id,)) map[(p as any).id] = p;
        }
        setPinnedDetails(map,);
        const missing = added.filter(id => !map[id]);
        if (missing.length > 0) void loadPinnedDetails(missing,);

        setPickerOpen(false,);
    };

    const cancelPicker = () => setPickerOpen(false,);

    // ─── Pinned-list mutation ───
    const removePinned = (id: string,) => {
        props.onChange({ pinnedPostIds: pinnedIds().filter(x => x !== id), },);
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
        props.onChange({ pinnedPostIds: ids, },);
    };

    return (
        <div class="post-list-block-edit">
            {/* ─── Specific posts ─── */}
            <FormSection
                title="Specific posts"
                tooltip="Hand-pick posts to render first, in the order shown. Drag to reorder, click × to remove. Specific posts render before any query results below."
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
                    <button type="button" class="btn btn--secondary btn--small" onClick={openPicker}>
                        + Select posts
                    </button>
                </div>
            </FormSection>

            {/* ─── Posts query (toggled) ─── */}
            <FormCheck
                label="Enable posts query"
                checked={queryEnabled()}
                onChange={(next,) => props.onChange({ queryEnabled: next, },)}
                tooltip="When on, runs a dynamic query against your posts (count, date window, full-text search) and renders the results after any specific posts above."
            />

            <Show when={queryEnabled()}>
                <div class="post-list-block-edit__query-panel">
                    <FormField label="Number of posts" inline>
                        <input
                            type="number"
                            min="1"
                            max="100"
                            value={props.value.count ?? 5}
                            onInput={(e,) => props.onChange({ count: Number(e.currentTarget.value,) || undefined, },)}
                        />
                    </FormField>

                    <div class="post-list-block-edit__row-pair">
                        <FormField
                            label="Posts after (days ago)"
                            tooltip="Show posts older than this many days. Leave blank for no lower bound."
                        >
                            <input
                                type="number"
                                min="0"
                                value={props.value.afterDaysAgo ?? ''}
                                placeholder="leave blank for no limit"
                                onInput={(e,) => {
                                    const v = e.currentTarget.value;
                                    props.onChange({ afterDaysAgo: v === '' ? undefined : Number(v,), },);
                                }}
                            />
                        </FormField>
                        <FormField
                            label="Posts before (days ago)"
                            tooltip="Show posts newer than this many days ago. Leave blank for no upper bound."
                        >
                            <input
                                type="number"
                                min="0"
                                value={props.value.beforeDaysAgo ?? ''}
                                placeholder="leave blank for no limit"
                                onInput={(e,) => {
                                    const v = e.currentTarget.value;
                                    props.onChange({ beforeDaysAgo: v === '' ? undefined : Number(v,), },);
                                }}
                            />
                        </FormField>
                    </div>

                    <FormField
                        label="Search filter"
                        tooltip="Free-text query — the backend full-text searches post titles + bodies for matching posts."
                    >
                        <input
                            type="text"
                            value={props.value.query ?? ''}
                            placeholder="e.g. interview, election, …"
                            onInput={(e,) => props.onChange({ query: e.currentTarget.value || undefined, },)}
                        />
                    </FormField>

                    <FormCheck
                        label="Show message when there are no posts"
                        checked={props.value.showEmptyMessage !== false}
                        onChange={(next,) => props.onChange({ showEmptyMessage: next, },)}
                        tooltip="When on (default), a single 'No posts found' slide renders if the item resolves to zero posts. Turn off to render no slide at all in that case."
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
                            <button type="button" class="btn btn--secondary btn--small" onClick={() => void loadPickerPosts()}>
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
                            <span class="post-picker__count">{pickerSelected().size} selected</span>
                            <button class="btn btn--secondary" onClick={cancelPicker} type="button">Cancel</button>
                            <button class="btn btn--primary" onClick={acceptPicker} type="button">Accept</button>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    );
};

export default PostQueryEditor;
