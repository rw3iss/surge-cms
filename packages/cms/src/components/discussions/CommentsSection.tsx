/**
 * The Comments section at the bottom of a post or event page.
 *
 * Renders NOTHING unless commenting is enabled for that item. Reads the item's
 * switches (`cms.comments.thread`), then the comments (`cms.discussions.list`,
 * top-level pages + reply trees). "Load more" fetches the NEXT page and appends
 * it. Reloads after posting; every 60 s (tab visible, nobody typing) it polls
 * only the total + newest id and offers "N new comments — show" rather than
 * refetching every page.
 */
import type { Comment, CommentTargetRef, CommentThreadSettings, DiscussionsSettings, } from '@sitesurge/types';
import { Component, createEffect, createSignal, on, onCleanup, onMount, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import UpgradeTout from '../content/UpgradeTout';
import CommentComposer from './CommentComposer';
import CommentThread from './CommentThread';
import './discussions.scss';

export interface CommentsSectionProps {
    targetType: 'post' | 'event' | (string & {});
    targetId: string;
    class?: string;
}

const PAGE = 20;
const REFRESH_MS = 60_000;

type Sort = 'newest' | 'oldest' | 'top';

const CommentsSection: Component<CommentsSectionProps> = (props,) => {
    const auth = useAuth();
    let root: HTMLElement | undefined;
    const target = (): CommentTargetRef => `${props.targetType}:${props.targetId}`;

    const [thread, setThread,] = createSignal<CommentThreadSettings | null>(null,);
    const [settings, setSettings,] = createSignal<DiscussionsSettings | null>(null,);
    const [comments, setComments,] = createSignal<Comment[]>([],);
    const [total, setTotal,] = createSignal(0,);
    const [pages, setPages,] = createSignal(1,);
    const [sort, setSort,] = createSignal<Sort>('newest',);
    const [loading, setLoading,] = createSignal(false,);
    const [forbidden, setForbidden,] = createSignal(false,);
    /** New comments since the last load (from the cheap poll). */
    const [fresh, setFresh,] = createSignal(0,);

    /** Merge pages, first occurrence wins (a comment that moved between pages shows once). */
    const dedupe = (list: Comment[],): Comment[] => {
        const seen = new Set<string>();
        return list.filter((c,) => (seen.has(c.id,) ? false : (seen.add(c.id,), true)));
    };

    /** Latest request wins: a slow, older response never overwrites a newer one. */
    let seq = 0;

    /** (Re)load pages 1…N — each its own page request, so >100 comments page correctly. */
    const load = async () => {
        if (!thread()?.enabled) return;
        const mine = ++seq;
        setLoading(true,);
        try {
            const n = pages();
            const results = await Promise.all(
                Array.from({ length: n, }, (_, i,) => cms.discussions.list(target(), { sort: sort(), page: i + 1, limit: PAGE, },),),
            );
            if (mine !== seq) return;
            setComments(dedupe(results.flatMap((r,) => r.data,),),);
            setTotal(results[0]?.meta?.total ?? results[0]?.data.length ?? 0,);
            setForbidden(false,);
            setFresh(0,);
        } catch (e) {
            if (mine === seq && (e as { status?: number; }).status === 403) setForbidden(true,);
        } finally {
            if (mine === seq) setLoading(false,);
        }
    };

    /** Fetch ONE more page and append it. */
    const loadMore = async () => {
        if (!thread()?.enabled || loading()) return;
        const next = pages() + 1;
        const mine = ++seq;
        setLoading(true,);
        try {
            const res = await cms.discussions.list(target(), { sort: sort(), page: next, limit: PAGE, },);
            if (mine !== seq) return;
            setPages(next,);
            setComments(dedupe([...comments(), ...res.data,],),);
            setTotal(res.meta?.total ?? total(),);
        } catch { /* keep what is shown */ } finally {
            if (mine === seq) setLoading(false,);
        }
    };

    /**
     * Cheap poll: one comment + the total. When something changed, offer a
     * "N new" button instead of reloading every page in every open tab.
     */
    const poll = async () => {
        try {
            const res = await cms.discussions.list(target(), { sort: 'newest', page: 1, limit: 1, },);
            const t = res.meta?.total ?? 0;
            const newestId = res.data[0]?.id;
            const known = sort() === 'newest' ? comments()[0]?.id : undefined;
            if (t > total()) setFresh(t - total(),);
            else if (known && newestId && newestId !== known) setFresh(1,);
        } catch { /* ignore */ }
    };

    /** Is this comment id anywhere in the loaded trees? */
    const has = (id: string, list: Comment[] = comments(),): boolean =>
        list.some((c,) => c.id === id || has(id, c.replies ?? [],));

    /**
     * `#comment-<id>` deep links (discovery lists, reply emails, the
     * moderation queue): when the comment is not on the pages shown, load its
     * top-level comment's whole tree and put it first, then scroll to it and
     * highlight it.
     */
    const focusHash = async () => {
        const m = /^#comment-([0-9a-f-]{36})$/i.exec(typeof location !== 'undefined' ? location.hash : '',);
        if (!m) return;
        const id = m[1];
        if (!has(id,)) {
            try {
                const { rootId, } = await cms.discussions.locate(id,);
                const r = await cms.discussions.list(target(), { root: rootId, },);
                if (r.data[0]) setComments(dedupe([r.data[0], ...comments(),],),);
            } catch { return; /* gone or not readable */ }
        }
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const el = document.getElementById(`comment-${id}`,);
            if (!el) return;
            el.scrollIntoView({ block: 'center', },);
            el.classList.add('comment-item--target',);
            setTimeout(() => el.classList.remove('comment-item--target',), 2500,);
        },),);
    };

    const init = async () => {
        try {
            const [t, s,] = await Promise.all([cms.comments.thread(props.targetType, props.targetId,), cms.discussions.settings(),],);
            setThread(t,);
            setSettings(s,);
            await load();
            await focusHash();
        } catch {
            setThread(null,); // feature off / item unknown → render nothing
        }
    };

    createEffect(on(() => [props.targetType, props.targetId,] as const, () => { setPages(1,); void init(); },),);
    // Who is viewing changes what comes back (own pending comments, edit rights).
    createEffect(on(() => auth.user?.id, () => void load(), { defer: true, },),);
    createEffect(on(sort, () => void load(), { defer: true, },),);

    /** Someone is mid-sentence in a composer or edit box inside this section. */
    const typing = (): boolean => {
        if (!root) return false;
        const active = document.activeElement;
        if (active && root.contains(active,) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return true;
        return [...root.querySelectorAll('textarea',),].some((t,) => t.value.trim() !== '');
    };

    onMount(() => {
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible' && thread()?.enabled && !typing()) void poll();
        }, REFRESH_MS,);
        onCleanup(() => clearInterval(timer,));
    },);

    const open = () => Boolean(thread()?.enabled,) && !thread()?.locked;

    return (
        <Show when={thread()?.enabled}>
            <section ref={root} class={`comments-section${props.class ? ` ${props.class}` : ''}`} id="comments" aria-label="Comments">
                <header class="comments-section__head">
                    <h2 class="comments-section__title">
                        Comments<Show when={total() > 0}><span class="comments-section__count">{total()}</span></Show>
                    </h2>
                    <Show when={total() > 1}>
                        <label class="comments-section__sort">
                            <span>Sort</span>
                            <select value={sort()} onChange={(e,) => setSort(e.currentTarget.value as Sort,)}>
                                <option value="newest">Newest</option>
                                <option value="oldest">Oldest</option>
                                <option value="top">Top</option>
                            </select>
                        </label>
                    </Show>
                </header>

                <Show
                    when={!forbidden()}
                    fallback={<UpgradeTout title="Comments are for members" message="Become a member to read and join the conversation." onLoggedIn={() => void load()} />}
                >
                    <Show when={open()} fallback={<p class="comments-section__closed">Comments are closed.</p>}>
                        <CommentComposer
                            target={target()}
                            allowAnonymous={thread()?.allowAnonymous}
                            maxLength={settings()?.maxLength}
                            onPosted={() => void load()}
                            onLoggedIn={() => void load()}
                        />
                    </Show>

                    <Show when={fresh() > 0}>
                        <button type="button" class="btn btn--outline comments-section__fresh" onClick={() => void load()}>
                            {fresh() === 1 ? 'New comments — show' : `${fresh()} new comments — show`}
                        </button>
                    </Show>

                    <Show when={comments().length > 0} fallback={<Show when={!loading()}><p class="comments-section__empty">No comments yet.</p></Show>}>
                        <CommentThread
                            comments={comments()}
                            target={target()}
                            settings={settings()}
                            allowReply={open()}
                            allowAnonymous={thread()?.allowAnonymous}
                            onChanged={() => void load()}
                        />
                    </Show>

                    <Show when={comments().length < total()}>
                        <button type="button" class="btn btn--outline comments-section__more" disabled={loading()} onClick={() => void loadMore()}>
                            {loading() ? 'Loading…' : 'Load more comments'}
                        </button>
                    </Show>
                </Show>
            </section>
        </Show>
    );
};

export default CommentsSection;
