/**
 * Solid hooks behind the Forum widget:
 *   useForumFeed      GET /forum/feed for the block's settings — first page,
 *                     "Load more", and a merge-by-id refresh for polling.
 *   usePoll           run a function every N ms while the tab is visible and
 *                     `paused()` is false (nobody typing in the widget).
 *   createScrollKeeper keep what the reader sees when rows are added (chat
 *                     order follows the bottom, else shows a "New posts" pill).
 *   createFreshIds    ids to animate in, cleared after the animation.
 */
import type { ForumFeedResponse, ForumFeedThread, ResolvedForumBlockSettings, } from '@sitesurge/types';
import { forumFeedQueryFor, } from '@sitesurge/types';
import { createEffect, createSignal, on, onCleanup, } from 'solid-js';
import { createStore, reconcile, } from 'solid-js/store';
import { cms, } from '../../services/cmsClient';
import { errorText, } from '../discussions/CommentComposer';
import { appendPage, hasMorePages, isNearBottom, mergeById, } from './forumFeed';

export type ForumFeedMeta = Omit<ForumFeedResponse, 'items'>;
export interface ForumFeedError { status: number; code: string; message: string; }

const errorOf = (e: unknown,): ForumFeedError => ({
    status: (e as { status?: number; })?.status ?? 0,
    code: String((e as { code?: string; })?.code ?? '',),
    message: errorText(e,),
});

export function useForumFeed(opts: {
    settings: () => ResolvedForumBlockSettings;
    /** False → nothing is fetched (feature off, members-only + signed out). */
    enabled: () => boolean;
    /** Changes on sign-in / out so the feed is re-read for the new viewer. */
    viewer: () => string;
},) {
    // A store reconciled by id: a polled row keeps its identity (and its card
    // keeps its open replies / composer) while its fields update in place.
    const [state, setState,] = createStore<{ items: ForumFeedThread[]; }>({ items: [], },);
    const items = () => state.items;
    const setItems = (next: ForumFeedThread[],) => setState('items', reconcile(next, { key: 'id', merge: true, },),);
    const [meta, setMeta,] = createSignal<ForumFeedMeta | null>(null,);
    const [page, setPage,] = createSignal(1,);
    const [loading, setLoading,] = createSignal(false,);
    const [loadingMore, setLoadingMore,] = createSignal(false,);
    const [loaded, setLoaded,] = createSignal(false,);
    const [error, setError,] = createSignal<ForumFeedError | null>(null,);
    /** Latest request wins — a slow response never overwrites a newer one. */
    let seq = 0;

    const query = (p: number,) => forumFeedQueryFor(opts.settings(), p,);
    const metaOf = (r: ForumFeedResponse,): ForumFeedMeta => {
        const { items: _items, ...rest } = r;
        return rest;
    };

    const load = async () => {
        const mine = ++seq;
        setLoading(true,);
        try {
            const r = await cms.forum.feed(query(1,),);
            if (mine !== seq) return;
            setItems(r.items ?? [],);
            setMeta(metaOf(r,),);
            setPage(1,);
            setError(null,);
        } catch (e) {
            if (mine !== seq) return;
            setItems([],);
            setError(errorOf(e,),);
        } finally {
            if (mine === seq) {
                setLoading(false,);
                setLoaded(true,);
            }
        }
    };

    /**
     * Re-read the first page and merge it in; returns the ids that are new.
     * `wrap` runs the state change (a scroll keeper keeps the reader's place).
     */
    const refresh = async (wrap?: (change: () => void,) => void,): Promise<string[]> => {
        const mine = ++seq;
        try {
            const r = await cms.forum.feed(query(1,),);
            if (mine !== seq) return [];
            const merged = mergeById(items(), r.items ?? [],);
            const commit = () => {
                setItems(merged.items,);
                setMeta(metaOf(r,),);
                setError(null,);
            };
            if (wrap) wrap(commit,);
            else commit();
            return merged.added;
        } catch {
            return []; // a failed poll keeps what is shown
        }
    };

    const loadMore = async (wrap?: (change: () => void,) => void,) => {
        if (loadingMore()) return;
        setLoadingMore(true,);
        try {
            const next = page() + 1;
            const r = await cms.forum.feed(query(next,),);
            const commit = () => {
                setItems(appendPage(items(), r.items ?? [],),);
                setPage(next,);
            };
            if (wrap) wrap(commit,);
            else commit();
        } catch (e) {
            setError(errorOf(e,),);
        } finally {
            setLoadingMore(false,);
        }
    };

    const hasMore = () => {
        const m = meta();
        return Boolean(m,) && hasMorePages(page(), m!.limit || opts.settings().limit, m!.total,);
    };

    // Re-read whenever the query or the viewer changes (display edits do not refetch).
    createEffect(on(
        () => (opts.enabled() ? JSON.stringify([query(1,), opts.viewer(),],) : null),
        (key,) => {
            if (key) void load();
        },
    ),);

    return { items, setItems, meta, loading, loadingMore, loaded, error, hasMore, load, refresh, loadMore, };
}

/** Run `fn` every `interval()` ms while active, the tab is visible and not paused. */
export function usePoll(fn: () => void | Promise<unknown>, opts: { interval: () => number; active: () => boolean; paused: () => boolean; },) {
    let timer: number | undefined;
    let running = false;
    const tick = async () => {
        if (running || !opts.active() || opts.paused() || document.visibilityState !== 'visible') return;
        running = true;
        try {
            await fn();
        } finally {
            running = false;
        }
    };
    createEffect(on(() => [opts.active(), opts.interval(),] as const, ([active, ms,],) => {
        if (timer) window.clearInterval(timer,);
        timer = active ? window.setInterval(() => void tick(), ms,) : undefined;
    },),);
    const onVisible = () => {
        if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible,);
    onCleanup(() => {
        if (timer) window.clearInterval(timer,);
        document.removeEventListener('visibilitychange', onVisible,);
    },);
}

/**
 * Keep the reader's place when rows are added to a scrolling list.
 *   edge 'top'    (newer rows above in default order, or older rows above in
 *                 chat order): the view stays on what the reader was reading.
 *   edge 'bottom' + follow (chat order): scroll to the new rows when the reader
 *                 was at the bottom, else show the "New posts" pill.
 */
export function createScrollKeeper(list: () => HTMLElement | undefined,) {
    const [pill, setPill,] = createSignal(false,);
    const near = (el: HTMLElement,) => isNearBottom(el.scrollTop, el.scrollHeight, el.clientHeight,);

    const toBottom = (smooth = false,) => {
        const el = list();
        if (!el) return;
        const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)',).matches;
        el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto', },);
        setPill(false,);
    };

    const apply = (change: () => void, edge: 'top' | 'bottom', follow: boolean,) => {
        const el = list();
        if (!el) {
            change();
            return;
        }
        const wasNear = near(el,);
        const height = el.scrollHeight;
        const top = el.scrollTop;
        change();
        requestAnimationFrame(() => {
            const grow = el.scrollHeight - height;
            if (grow <= 0) return;
            if (edge === 'top') {
                if (top > 4 || follow) el.scrollTop = top + grow;
            } else if (follow) {
                if (wasNear) toBottom(true,);
                else setPill(true,);
            }
        },);
    };

    const onScroll = () => {
        const el = list();
        if (el && pill() && near(el,)) setPill(false,);
    };

    return { pill, setPill, toBottom, apply, onScroll, };
}

/** Ids to animate in; each clears itself after the entrance animation. */
export function createFreshIds(ms = 1600,) {
    const [fresh, setFresh,] = createSignal<ReadonlySet<string>>(new Set(),);
    const mark = (ids: readonly string[],) => {
        if (!ids.length) return;
        setFresh((cur,) => new Set([...cur, ...ids,],),);
        window.setTimeout(() => setFresh((cur,) => {
            const next = new Set(cur,);
            ids.forEach((id,) => next.delete(id,),);
            return next;
        },), ms,);
    };
    return { isFresh: (id: string,) => fresh().has(id,), mark, };
}
