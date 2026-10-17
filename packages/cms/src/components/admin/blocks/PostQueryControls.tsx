/**
 * Shared post-data controls, used by BOTH the `post_list` block editor
 * (PostListBlock) and the carousel's legacy Posts item (PostQueryEditor):
 *
 *   <PostDataField>     — the ONE "Set data…" for posts (the shared
 *       DataBindingField on the `post` entity type). Ticked posts are saved as
 *       `pinnedPostIds` (query off); none ticked saves a live query
 *       (`queryEnabled` + `count` = limit + `query` = search). Under it: the
 *       reorderable pinned list, or the live query's extra options (date
 *       window, empty message).
 *   <PostFieldsSection> — which post fields render.
 *
 * Settings shape is unchanged (`pinnedPostIds`, `queryEnabled`, `count`,
 * `afterDaysAgo`, `beforeDaysAgo`, `query`, `showEmptyMessage`), so
 * PostListRenderer, ResolvedHeroCarousel and email keep working. Pure mapping:
 * `postDataBinding` / `postSettingsFromBinding`.
 */
import type { Post, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, JSX, on, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { describeQuery, } from '../../../utils/dataBinding';
import DataBindingField from '../entities/DataBindingField';
import { DEFAULT_POST_COUNT, hasPinnedAndQuery, type PostDataSettings, postDataBinding, postSettingsFromBinding, } from './postDataBinding';
import { FormCheck, FormField, FormSection, } from '../forms';
import './types/PostListBlock.scss';

/** Two columns of three dots — the standard "drag to reorder" affordance. */
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

// ─── Posts data (Set data… + pinned list / live-query options) ─────

export interface PostDataValue extends PostDataSettings {
    afterDaysAgo?: number;
    beforeDaysAgo?: number;
    showEmptyMessage?: boolean;
}

export interface PostDataFieldProps {
    value: PostDataValue;
    onChange: (patch: Partial<PostDataValue>,) => void;
    /** Field tooltip. */
    tooltip?: JSX.Element | string;
    /** Tooltip on the "Show message when there are no posts" toggle — the
     *  empty-state semantics differ slightly between consumers. */
    emptyMessageTooltip?: JSX.Element | string;
}

const DEFAULT_DATA_TOOLTIP =
    'Tick posts for a fixed list (rendered in the order shown — drag to reorder), or tick none to save a live query (search + number of posts) that updates as posts are published.';
const DEFAULT_EMPTY_TOOLTIP =
    'When on (default), an empty-state placeholder renders if the query returns zero results. Turn off to render nothing in that case.';

export const PostDataField: Component<PostDataFieldProps> = (props,) => {
    const pinnedIds = (): string[] => (Array.isArray(props.value.pinnedPostIds,) ? props.value.pinnedPostIds : []);
    const queryOn = () => props.value.queryEnabled !== false;

    // ─── Titles for the pinned list ───
    const [pinnedDetails, setPinnedDetails,] = createSignal<Record<string, Post>>({},);
    /** Admin endpoint per id so drafts / scheduled posts resolve too. */
    const loadPinnedDetails = async (ids: string[],) => {
        const missing = ids.filter((id,) => !pinnedDetails()[id]);
        if (!missing.length) return;
        const results = await Promise.all(missing.map(async (id,) => {
            try {
                return await cms.posts.getById(id,) as unknown as Post;
            } catch { /* show the fallback id */ }
            return null;
        }),);
        const map: Record<string, Post> = { ...pinnedDetails(), };
        missing.forEach((id, i,) => {
            const p = results[i];
            if (p) map[id] = p;
        },);
        setPinnedDetails(map,);
    };
    createEffect(on(pinnedIds, (ids,) => { void loadPinnedDetails(ids,); },),);

    /** An older block may hold BOTH (pinned first, then the query); say so. */
    const summary = () => (hasPinnedAndQuery(props.value,)
        ? `${pinnedIds().length} selected, then live: ${describeQuery({ limit: props.value.count ?? DEFAULT_POST_COUNT, search: props.value.query, },)}`
        : undefined);

    const removePinned = (id: string,) => props.onChange({ pinnedPostIds: pinnedIds().filter((x,) => x !== id), },);

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
        ids.splice(dropIdx, 0, moved!,);
        props.onChange({ pinnedPostIds: ids, },);
    };

    return (
        <DataBindingField
            label="Posts"
            tooltip={props.tooltip ?? DEFAULT_DATA_TOOLTIP}
            entityType="post"
            value={postDataBinding(props.value,)}
            queryFilters={false}
            querySort={false}
            summary={summary()}
            emptyText="No posts"
            onChange={(b,) => props.onChange(postSettingsFromBinding(b,),)}
        >
            <Show when={pinnedIds().length > 0}>
                <div class="post-list-block-edit__pinned">
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
                </div>
            </Show>

            <Show when={queryOn()}>
                <div class="post-list-block-edit__query-panel">
                    <FormField label="Number of posts" inline>
                        <input
                            type="number"
                            min="1"
                            max="100"
                            value={props.value.count ?? DEFAULT_POST_COUNT}
                            onChange={(e,) => props.onChange({ count: Number(e.currentTarget.value,) || undefined, },)}
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
                                value={props.value.afterDaysAgo ?? ''}
                                placeholder="leave blank for no limit"
                                onChange={(e,) => {
                                    const v = e.currentTarget.value;
                                    props.onChange({ afterDaysAgo: v === '' ? undefined : Number(v,), },);
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
                                value={props.value.beforeDaysAgo ?? ''}
                                placeholder="leave blank for no limit"
                                onChange={(e,) => {
                                    const v = e.currentTarget.value;
                                    props.onChange({ beforeDaysAgo: v === '' ? undefined : Number(v,), },);
                                }}
                            />
                        </FormField>
                    </div>

                    <FormCheck
                        label="Show message when there are no posts"
                        checked={props.value.showEmptyMessage !== false}
                        onChange={(next,) => props.onChange({ showEmptyMessage: next, },)}
                        tooltip={props.emptyMessageTooltip ?? DEFAULT_EMPTY_TOOLTIP}
                    />
                </div>
            </Show>
        </DataBindingField>
    );
};

// ─── Show-fields section (which post fields render) ────────────────

export interface PostFieldsValue {
    showExcerpt?: boolean;
    showAuthor?: boolean;
    showDateCreated?: boolean;
    showDateUpdated?: boolean;
    showTags?: boolean;
}

export interface PostFieldsSectionProps {
    value: PostFieldsValue;
    onChange: (patch: Partial<PostFieldsValue>,) => void;
    /** Per-field default when the value is unset. Consumers differ:
     *  the post_list block defaults most on; the carousel defaults all
     *  off (title-only slides). */
    defaults?: PostFieldsValue;
}

export const PostFieldsSection: Component<PostFieldsSectionProps> = (props,) => {
    const checked = (key: keyof PostFieldsValue,) => {
        const v = props.value[key];
        return (v ?? props.defaults?.[key] ?? false) === true;
    };
    return (
        <FormSection title="Show fields" tight padded inlineItems>
            <FormCheck
                label="Description / Excerpt"
                plain
                checked={checked('showExcerpt',)}
                onChange={(next,) => props.onChange({ showExcerpt: next, },)}
            />
            <FormCheck
                label="Author"
                plain
                checked={checked('showAuthor',)}
                onChange={(next,) => props.onChange({ showAuthor: next, },)}
            />
            <FormCheck
                label="Date created"
                plain
                checked={checked('showDateCreated',)}
                onChange={(next,) => props.onChange({ showDateCreated: next, },)}
            />
            <FormCheck
                label="Date updated"
                plain
                checked={checked('showDateUpdated',)}
                onChange={(next,) => props.onChange({ showDateUpdated: next, },)}
            />
            <FormCheck
                label="Tags"
                plain
                checked={checked('showTags',)}
                onChange={(next,) => props.onChange({ showTags: next, },)}
            />
        </FormSection>
    );
};
