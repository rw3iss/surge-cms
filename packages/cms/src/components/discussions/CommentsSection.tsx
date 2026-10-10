/**
 * The Comments section at the bottom of a post or event page.
 *
 * Renders NOTHING unless commenting is enabled for that item. Reads the item's
 * switches (`cms.comments.thread`), then the comments (`cms.discussions.list`,
 * top-level pages + reply trees). Refreshes after posting and every 60 s while
 * the tab is visible — but never while someone is typing, since a refresh
 * re-renders the list and would discard an open reply.
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

    /** Load pages 1…N in one request (a refresh keeps what was already shown). */
    const load = async () => {
        if (!thread()?.enabled) return;
        setLoading(true,);
        try {
            const res = await cms.discussions.list(target(), { sort: sort(), page: 1, limit: Math.min(100, PAGE * pages(),), },);
            setComments(res.data,);
            setTotal(res.meta?.total ?? res.data.length,);
            setForbidden(false,);
        } catch (e) {
            if ((e as { status?: number; }).status === 403) setForbidden(true,);
        } finally {
            setLoading(false,);
        }
    };

    const init = async () => {
        try {
            const [t, s,] = await Promise.all([cms.comments.thread(props.targetType, props.targetId,), cms.discussions.settings(),],);
            setThread(t,);
            setSettings(s,);
            await load();
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
            if (document.visibilityState === 'visible' && thread()?.enabled && !typing()) void load();
        }, REFRESH_MS,);
        onCleanup(() => clearInterval(timer,));
    },);

    const loadMore = () => {
        setPages(pages() + 1,);
        void load();
    };

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
                    fallback={<UpgradeTout title="Comments are for subscribers" message="Subscribe to read and join the conversation." onLoggedIn={() => void load()} />}
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
                        <button type="button" class="btn btn--outline comments-section__more" disabled={loading()} onClick={loadMore}>
                            {loading() ? 'Loading…' : 'Load more comments'}
                        </button>
                    </Show>
                </Show>
            </section>
        </Show>
    );
};

export default CommentsSection;
