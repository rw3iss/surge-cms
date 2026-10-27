/**
 * The replies under one thread card (list mode), loaded when opened: oldest
 * first, compact rows (ForumMessage), "Show more replies" for the next page.
 * The card reloads it after posting (`api.reload`) and marks the new reply
 * so it animates in.
 */
import type { Comment, ForumFeedThread, } from '@sitesurge/types';
import { Component, createEffect, createSignal, on, Show, } from 'solid-js';
import { createStore, reconcile, } from 'solid-js/store';
import { cms, } from '../../services/cmsClient';
import { errorText, } from '../discussions/CommentComposer';
import { useForum, } from './forumContext';
import { appendPage, mergeById, } from './forumFeed';
import { ForumMessageList, } from './ForumMessage';

const PAGE_SIZE = 20;

export interface ForumRepliesApi {
    reload: () => Promise<void>;
    /** Show a reply just posted: reload, and append it if it sits on a later page. */
    add: (c: Comment,) => Promise<void>;
}

const ForumReplies: Component<{
    thread: ForumFeedThread;
    /** Show Reply on each reply. */
    canReply: boolean;
    onReply: (c: Comment,) => void;
    isFresh: (id: string,) => boolean;
    onApi?: (api: ForumRepliesApi,) => void;
}> = (props,) => {
    const ctx = useForum();
    const [store, setStore,] = createStore<{ tops: Comment[]; }>({ tops: [], },);
    const tops = () => store.tops;
    const setTops = (next: Comment[],) => setStore('tops', reconcile(next, { key: 'id', merge: true, },),);
    const [page, setPage,] = createSignal(1,);
    const [totalPages, setTotalPages,] = createSignal(1,);
    const [loading, setLoading,] = createSignal(true,);
    const [error, setError,] = createSignal('',);
    const target = () => `forum_thread:${props.thread.id}` as const;

    const fetchPage = (p: number,) => cms.discussions.list(target(), { sort: 'oldest', page: p, limit: PAGE_SIZE, },);

    /** Re-read the pages already shown and merge (new replies land at the end). */
    const reload = async () => {
        try {
            const r = await fetchPage(1,);
            // Oldest first: page 1 is the START — its rows, then the later pages already shown.
            setTops(mergeById(tops(), r.data,).items,);
            setTotalPages(r.meta?.totalPages ?? 1,);
            setError('',);
        } catch (e) {
            setError(errorText(e,),);
        } finally {
            setLoading(false,);
        }
    };
    const contains = (list: Comment[], id: string,): boolean => list.some((c,) => c.id === id || contains(c.replies ?? [], id,));
    const add = async (c: Comment,) => {
        await reload();
        if (!contains(tops(), c.id,) && !c.parentId) setTops([...tops(), c,],);
    };
    props.onApi?.({ reload, add, },);

    const more = async () => {
        const next = page() + 1;
        try {
            const r = await fetchPage(next,);
            setTops(appendPage(tops(), r.data,),);
            setPage(next,);
            setTotalPages(r.meta?.totalPages ?? next,);
        } catch (e) {
            setError(errorText(e,),);
        }
    };

    // First load + reload for a new viewer (rights and "mine" change).
    createEffect(on(ctx.viewer, () => void reload(),),);

    return (
        <div class="forum-replies">
            <Show when={!loading()} fallback={<p class="forum-replies__loading">Loading replies…</p>}>
                <Show when={error()}>
                    <p class="forum-composer__error" role="alert">Replies could not be loaded: {error()}</p>
                </Show>
                <Show when={tops().length} fallback={<Show when={!error()}><p class="forum-replies__empty">No replies yet.</p></Show>}>
                    <ForumMessageList tops={tops()} isFresh={props.isFresh} canReply={props.canReply} onReply={props.onReply} />
                </Show>
                <Show when={page() < totalPages()}>
                    <button type="button" class="forum-link-btn forum-replies__more" onClick={() => void more()}>Show more replies</button>
                </Show>
            </Show>
        </div>
    );
};

export default ForumReplies;
