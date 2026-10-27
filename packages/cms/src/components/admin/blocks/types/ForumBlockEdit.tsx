/**
 * Forum block editor. Groups, top to bottom:
 *   Mode      List (threads) or Thread (one thread as a chat stream).
 *   Data      list: one "Set data…" on `forum_thread` — ticked threads, or
 *             none ticked = a live query (sort / window / category filters);
 *             thread: pick the one thread.
 *   Display   what each post shows, the content (none / excerpt / full).
 *   Layout    chat order, list height, threads per load, heading, empty text.
 *   Posting   post mode, where new threads go (default: the query's
 *             category), placeholder, replies, reactions.
 *   Access    visibility, guest posting, live updates.
 * Text / number fields commit on blur (CommitInput); booleans are Toggles.
 */
import type {
    ForumBlockMode, ForumBlockVisibility, ForumCategory, ForumContentDisplay, ForumPostMode, ResolvedForumBlockSettings, SlotBinding,
} from '@sitesurge/types';
import { DEFAULT_FORUM_BINDING, forumBlockPostCategory, normalizeForumBlockSettings, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, type JSX, Show, } from 'solid-js';
import { cms, } from '../../../../services/cmsClient';
import { isFeatureEnabled, } from '../../../../stores/siteSettings';
import AlignButtons from '../../common/AlignButtons';
import Toggle from '../../common/Toggle';
import DataBindingField from '../../entities/DataBindingField';
import { FormField, } from '../../forms';
import { CommitInput, } from '../../forms/CommitInput';
import './ForumBlockEdit.scss';

type Flag = 'showTitle' | 'showAuthor' | 'showAvatar' | 'showDate' | 'showLastReply' | 'showCategory' | 'showCounts';

/** Display toggles, in card order. */
const DISPLAY: { key: Flag; label: string; }[] = [
    { key: 'showAvatar', label: 'Avatar', },
    { key: 'showAuthor', label: 'Author', },
    { key: 'showDate', label: 'Date posted', },
    { key: 'showCategory', label: 'Category', },
    { key: 'showTitle', label: 'Title', },
    { key: 'showCounts', label: 'Reply + view counts', },
    { key: 'showLastReply', label: 'Last reply (time + by)', },
];

const POST_MODES: { value: ForumPostMode; label: string; }[] = [
    { value: 'off', label: 'Off (read only)', },
    { value: 'inline', label: 'Inline (one chat-style box)', },
    { value: 'form', label: 'Form (title + message)', },
    { value: 'button', label: '"New post" button (opens the form)', },
];

const Group: Component<{ title: string; children: JSX.Element; }> = (props,) => (
    <div class="forum-block-edit__group">
        <h4 class="forum-block-edit__title">{props.title}</h4>
        {props.children}
    </div>
);

const ForumBlockEdit: Component<{
    data: Record<string, any>;
    onUpdate: (d: Record<string, any>,) => void;
}> = (props,) => {
    const d = (): ResolvedForumBlockSettings => normalizeForumBlockSettings(props.data,);
    const list = () => d().mode === 'list';
    const set = (patch: Record<string, unknown>,) => {
        const next: Record<string, unknown> = { ...props.data, ...patch, };
        for (const k of Object.keys(next,)) if (next[k] === undefined) delete next[k];
        props.onUpdate(next,);
    };
    const num = (v: string,) => (v.trim() === '' ? undefined : Math.round(Number(v,),) || undefined);
    const text = (v: string,) => v.trim() || undefined;

    const [categories,] = createResource(
        () => (isFeatureEnabled('forum',) ? 'on' : false),
        () => cms.forum.categories.list().catch(() => [] as ForumCategory[]),
    );
    const categoryName = (ref: string | undefined,) => {
        if (!ref) return null;
        const c = (categories() ?? []).find((x,) => x.id === ref || x.slug === ref,);
        return c ? c.name : ref;
    };
    /** Where new threads go now (the chosen category, else the query's). */
    const resolvedTarget = () => categoryName(forumBlockPostCategory(d(),),);
    const queryCategory = () => (list() && d().binding.mode === 'query' ? forumBlockPostCategory({ ...d(), postCategory: undefined, },) : undefined);

    const threadBinding = (): SlotBinding | null => (d().thread ? { mode: 'single', ref: d().thread!, } : null);

    // The heading's draft (it commits on blur) so its alignment bar enables while typing.
    const [headingDraft, setHeadingDraft,] = createSignal(d().heading ?? '',);
    createEffect(() => setHeadingDraft(d().heading ?? '',),);

    return (
        <div class="forum-block-edit block-edit-form">
            <Show when={!isFeatureEnabled('forum',)}>
                <div class="alert alert--warning">The Forum feature is off — this block shows nothing until it is enabled in Settings → Features.</div>
            </Show>

            <Group title="Mode">
                <FormField label="Show" tooltip="A list of threads (read, post, reply in place), or one thread as a chat stream where posting replies to it.">
                    <select value={d().mode} onChange={(e,) => set({ mode: e.currentTarget.value as ForumBlockMode, },)}>
                        <option value="list">List of threads</option>
                        <option value="thread">One thread (chat)</option>
                    </select>
                </FormField>
            </Group>

            <Group title="Data">
                <Show
                    when={list()}
                    fallback={
                        <DataBindingField
                            label="Thread"
                            tooltip="The thread this block shows: its opening post, then the replies, newest at the bottom."
                            entityType="forum_thread"
                            value={threadBinding()}
                            allowMultiple={false}
                            allowQuery={false}
                            emptyText="No thread chosen"
                            clearLabel="Clear"
                            onChange={(b,) => set({ thread: b && b.mode === 'single' ? b.ref : b && b.mode === 'list' ? b.refs[0] : undefined, },)}
                        >
                            <A href="/admin/forum" class="form-help-muted">Manage the forum</A>
                        </DataBindingField>
                    }
                >
                    <DataBindingField
                        label="Threads"
                        tooltip="Tick threads for a fixed selection (shown in the order picked), or tick none to save a live query — filters: sort (latest = last activity, newest = date posted, hot, top), window (24h / 7d / 30d / all) and category. Only threads the viewer may read are shown."
                        entityType="forum_thread"
                        value={d().binding}
                        maxRecords={50}
                        emptyText="Latest threads"
                        clearLabel="Reset to latest"
                        onChange={(b,) => set({ binding: b ?? DEFAULT_FORUM_BINDING, },)}
                    >
                        <A href="/admin/forum" class="form-help-muted">Manage the forum</A>
                    </DataBindingField>
                </Show>
            </Group>

            <Group title="Display">
                <div class="forum-block-edit__toggles">
                    <For each={DISPLAY}>
                        {(t,) => <Toggle checked={d()[t.key]} onChange={(v,) => set({ [t.key]: v, },)} label={t.label} />}
                    </For>
                </div>
                <div class="admin-form-row forum-block-edit__row">
                    <FormField label="Content" tooltip="The opening post under the title: nothing, a plain-text excerpt, or the whole post.">
                        <select value={d().content} onChange={(e,) => set({ content: e.currentTarget.value as ForumContentDisplay, },)}>
                            <option value="none">None</option>
                            <option value="excerpt">Excerpt</option>
                            <option value="full">Full post</option>
                        </select>
                    </FormField>
                    <Show when={d().content === 'excerpt'}>
                        <FormField label="Excerpt length" tooltip="Characters, cut at a word boundary.">
                            <CommitInput type="number" min={20} max={5000} value={d().excerptLength} onCommit={(v,) => set({ excerptLength: num(v,), },)} />
                        </FormField>
                    </Show>
                </div>
                <FormField label="Read more label" hint="Links to the thread page. Empty = no link.">
                    <CommitInput
                        value={typeof props.data.readMoreLabel === 'string' ? props.data.readMoreLabel : 'Read more'}
                        placeholder="(hidden)"
                        onCommit={(v,) => set({ readMoreLabel: v.trim(), },)}
                    />
                </FormField>
            </Group>

            <Group title="Layout">
                <Show when={list()}>
                    <Toggle
                        checked={d().chatOrder}
                        onChange={(v,) => set({ chatOrder: v, },)}
                        label="Chat order"
                        hint="Newest post at the bottom, the list scrolled to the end, the composer under it."
                    />
                </Show>
                <div class="admin-form-row forum-block-edit__row">
                    <FormField
                        label="List max height"
                        tooltip="The list scrolls inside this height when the block sets no height of its own (Style → Height makes the widget fill the block instead). Any CSS length; a bare number is px."
                    >
                        <CommitInput value={(props.data.listMaxHeight as string) ?? ''} placeholder="560px" onCommit={(v,) => set({ listMaxHeight: text(v,), },)} />
                    </FormField>
                    <Show when={list()}>
                        <FormField label="Threads per load" tooltip="How many threads show at first; Load more fetches the next set (1–50).">
                            <CommitInput type="number" min={1} max={50} value={d().limit} onCommit={(v,) => set({ limit: num(v,), },)} />
                        </FormField>
                    </Show>
                </div>
                <FormField label="Heading" tooltip="Optional title above the discussion. The buttons set its alignment.">
                    <div class="forum-block-edit__heading">
                        <CommitInput
                            value={d().heading ?? ''}
                            placeholder="e.g. Join the conversation"
                            onDraft={setHeadingDraft}
                            onCommit={(v,) => set({ heading: text(v,), },)}
                        />
                        <AlignButtons
                            label="Heading alignment"
                            value={d().headingAlign}
                            disabled={!headingDraft().trim()}
                            onChange={(v,) => set({ headingAlign: v === 'left' ? undefined : v, },)}
                        />
                    </div>
                </FormField>
                <FormField label="Empty text" hint="Shown when there is nothing to show yet.">
                    <CommitInput value={d().emptyText ?? ''} placeholder="No posts yet." onCommit={(v,) => set({ emptyText: text(v,), },)} />
                </FormField>
            </Group>

            <Group title="Posting">
                <Show
                    when={list()}
                    fallback={
                        <Toggle
                            checked={d().postMode !== 'off' || d().allowReplies}
                            onChange={(v,) => set({ postMode: v ? 'inline' : 'off', allowReplies: v, },)}
                            label="Reply box"
                            hint="A chat-style box at the bottom replies to the thread; each message gets a Reply."
                        />
                    }
                >
                    <FormField label="New posts" tooltip="Off, one chat-style box (the thread title is taken from the message), a title + message form, or a New post button that opens the form.">
                        <select value={d().postMode} onChange={(e,) => set({ postMode: e.currentTarget.value as ForumPostMode, },)}>
                            <For each={POST_MODES}>{(m,) => <option value={m.value}>{m.label}</option>}</For>
                        </select>
                    </FormField>
                    <Show when={d().postMode !== 'off'}>
                        <FormField
                            label="New posts go to"
                            hint={resolvedTarget()
                                ? `New threads are posted in: ${resolvedTarget()}.`
                                : 'Choose a category — the forum has no root category, so without one this block cannot post.'}
                        >
                            <select value={d().postCategory ?? ''} onChange={(e,) => set({ postCategory: e.currentTarget.value || undefined, },)}>
                                <option value="">
                                    {queryCategory() ? `Same as the query's category (${categoryName(queryCategory(),)})` : "Same as the query's category"}
                                </option>
                                <For each={categories() ?? []}>
                                    {(c,) => <option value={c.slug}>{c.name}{c.hiddenFromIndex ? ' (hidden)' : ''}</option>}
                                </For>
                            </select>
                        </FormField>
                    </Show>
                </Show>
                <Show when={d().postMode !== 'off' || (!list() && d().allowReplies)}>
                    <FormField label="Placeholder" hint="Text in the empty box.">
                        <CommitInput
                            value={d().postPlaceholder}
                            placeholder={list() ? 'Start a conversation…' : 'Write a message…'}
                            onCommit={(v,) => set({ postPlaceholder: text(v,), },)}
                        />
                    </FormField>
                </Show>
                <Show when={list()}>
                    <div class="forum-block-edit__toggles">
                        <Toggle checked={d().allowReplies} onChange={(v,) => set({ allowReplies: v, },)} label="Reply button on each post" />
                        <Toggle checked={d().showReplies} onChange={(v,) => set({ showReplies: v, },)} label='"N replies" opens them in place' />
                        <Show when={d().showReplies}>
                            <Toggle checked={d().expandReplies} onChange={(v,) => set({ expandReplies: v, },)} label="Replies open by default" />
                        </Show>
                    </div>
                </Show>
                <Toggle
                    checked={d().allowReactions}
                    onChange={(v,) => set({ allowReactions: v, },)}
                    label="Reactions"
                    hint="Uses the reactions set in Forum → Settings (when reactions are on there)."
                />
            </Group>

            <Group title="Access & updates">
                <FormField label="Visibility" tooltip="Members: signed-out visitors see a sign-in card instead. The forum's own read rules apply either way.">
                    <select value={d().visibility} onChange={(e,) => set({ visibility: e.currentTarget.value as ForumBlockVisibility, },)}>
                        <option value="public">Everyone who may read the forum</option>
                        <option value="members">Signed-in members only</option>
                    </select>
                </FormField>
                <Toggle
                    checked={d().allowAnonymous}
                    onChange={(v,) => set({ allowAnonymous: v, },)}
                    label="Allow anonymous posting"
                    hint={<>Guests may post and reply here (with an optional name). Needs Forum → <A href="/admin/forum/settings">Settings</A> → "Allow anonymous posting"; guests' posts wait for approval by default.</>}
                />
                <Toggle
                    checked={d().liveUpdates}
                    onChange={(v,) => set({ liveUpdates: v, },)}
                    label="Live updates"
                    hint="Check for new posts while the page is open and nobody is typing in the block. New posts slide in."
                />
                <Show when={d().liveUpdates}>
                    <FormField label="Refresh every (seconds)" tooltip="10 to 300.">
                        <CommitInput type="number" min={10} max={300} value={d().refreshSeconds} onCommit={(v,) => set({ refreshSeconds: num(v,), },)} />
                    </FormField>
                </Show>
            </Group>
        </div>
    );
};

export default ForumBlockEdit;
