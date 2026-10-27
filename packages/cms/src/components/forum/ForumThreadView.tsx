/**
 * Forum widget, thread mode: ONE thread as a chat stream — its title, the
 * opening post, then the replies oldest → newest, the reply box at the
 * bottom (reply to the thread, or to one message via its Reply). The newest
 * replies load first ("Load earlier messages" pages back); live polling adds
 * new ones at the bottom, following them only when the reader is already
 * there (else a "New messages" pill).
 */
import type { Comment, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createEffect, createSignal, on, Show, } from 'solid-js';
import { createStore, reconcile, } from 'solid-js/store';
import { cms, } from '../../services/cmsClient';
import { isAdminView, } from '../blocks/slotContext';
import { errorText, } from '../discussions/CommentComposer';
import { postForumReply, useForum, } from './forumContext';
import { appendPage, displayOrder, mergeById, pollIntervalMs, replyAccess, } from './forumFeed';
import ForumComposer from './ForumComposer';
import { createFreshIds, createScrollKeeper, usePoll, type useForumFeed, } from './forumHooks';
import ForumMessage, { ForumMessageList, } from './ForumMessage';

type Feed = ReturnType<typeof useForumFeed>;

const PAGE_SIZE = 30;

/** Every comment id in a tree. */
const idsOf = (list: readonly Comment[],): string[] => list.flatMap((c,) => [c.id, ...idsOf(c.replies ?? [],),]);

const ForumThreadView: Component<{ feed: Feed; }> = (props,) => {
    const ctx = useForum();
    const s = () => ctx.settings();
    const thread = () => props.feed.items()[0] ?? null;
    const fresh = createFreshIds();
    let listEl: HTMLDivElement | undefined;
    const keeper = createScrollKeeper(() => listEl,);

    /** Top-level replies, NEWEST first (page 1 = the latest). Shown reversed. */
    const [store, setStore,] = createStore<{ tops: Comment[]; }>({ tops: [], },);
    const setTops = (next: Comment[],) => setStore('tops', reconcile(next, { key: 'id', merge: true, },),);
    const [page, setPage,] = createSignal(1,);
    const [totalPages, setTotalPages,] = createSignal(1,);
    const [loadingReplies, setLoadingReplies,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [replyTo, setReplyTo,] = createSignal<Comment | null>(null,);

    const fetchPage = (id: string, p: number,) => cms.discussions.list(`forum_thread:${id}`, { sort: 'newest', page: p, limit: PAGE_SIZE, },);

    // First load (and again for a new viewer / another thread).
    createEffect(on(() => [thread()?.id, ctx.viewer(),] as const, async ([id,],) => {
        if (!id) return;
        setLoadingReplies(true,);
        try {
            const r = await fetchPage(id, 1,);
            setTops(r.data,);
            setPage(1,);
            setTotalPages(r.meta?.totalPages ?? 1,);
            setError('',);
        } catch (e) {
            setTops([],);
            setError(errorText(e,),);
        } finally {
            setLoadingReplies(false,);
            requestAnimationFrame(() => keeper.toBottom(),);
        }
    },),);

    /** Re-read the newest page and merge; new messages animate in at the bottom. */
    const refresh = async () => {
        const id = thread()?.id;
        if (!id) return;
        try {
            const r = await fetchPage(id, 1,);
            const before = new Set(idsOf(store.tops,),);
            keeper.apply(() => {
                setTops(mergeById(store.tops, r.data,).items,);
                setTotalPages(Math.max(page(), r.meta?.totalPages ?? 1,),);
            }, 'bottom', true,);
            fresh.mark(idsOf(r.data,).filter((x,) => !before.has(x,)),);
        } catch { /* keep what is shown */ }
    };

    usePoll(refresh, { interval: () => pollIntervalMs(s().refreshSeconds,), active: ctx.live, paused: ctx.typing, },);

    const loadEarlier = async () => {
        const id = thread()?.id;
        if (!id) return;
        const next = page() + 1;
        try {
            const r = await fetchPage(id, next,);
            keeper.apply(() => {
                setTops(appendPage(store.tops, r.data,),);
                setPage(next,);
            }, 'top', true,);
        } catch (e) {
            setError(errorText(e,),);
        }
    };

    const writing = () => s().postMode !== 'off' || s().allowReplies;
    const access = () => (thread() && writing() ? replyAccess(thread()!, ctx.signedIn(), ctx.guestWriting(),) : null);
    const startReply = (c: Comment,) => {
        if (access() === 'login') ctx.requestLogin('Log in to reply',);
        else setReplyTo(c,);
    };

    return (
        <Show
            when={thread()}
            fallback={
                <Show when={!props.feed.loading()} fallback={<div class="forum-widget__skeleton" aria-hidden="true"><span /><span /></div>}>
                    <Show when={isAdminView() || s().emptyText}>
                        <p class={isAdminView() && !s().emptyText ? 'block-message' : 'forum-widget__empty'}>
                            {s().emptyText ?? 'Choose the thread this block shows (Mode: Thread → Thread).'}
                        </p>
                    </Show>
                </Show>
            }
        >
            {(t,) => (
                <div class="forum-widget__frame">
                    <div class="forum-widget__list forum-stream" ref={listEl} onScroll={keeper.onScroll} aria-live="polite">
                        <Show when={s().showTitle}>
                            <div class="forum-stream__title">
                                <A href={t().url}>{t().title}</A>
                                <Show when={s().showCategory && t().category?.name}><span class="forum-chip">{t().category.name}</span></Show>
                                <Show when={t().locked}><span class="forum-badge forum-badge--muted">Locked</span></Show>
                            </div>
                        </Show>
                        <Show when={page() < totalPages()}>
                            <button type="button" class="forum-link-btn forum-widget__more" onClick={() => void loadEarlier()}>Load earlier messages</button>
                        </Show>
                        <Show when={page() >= totalPages() && t().opening}>
                            {(op,) => <ForumMessage comment={op()} opening canReply={false} />}
                        </Show>
                        <Show when={error()}>
                            <p class="forum-composer__error" role="alert">Messages could not be loaded: {error()}</p>
                        </Show>
                        <Show when={!loadingReplies() || store.tops.length}>
                            <ForumMessageList
                                tops={displayOrder(store.tops, true,)}
                                isFresh={fresh.isFresh}
                                canReply={Boolean(access(),)}
                                onReply={startReply}
                            />
                        </Show>
                    </div>
                    <Show when={keeper.pill()}>
                        <button type="button" class="forum-widget__pill" onClick={() => keeper.toBottom(true,)}>New messages ↓</button>
                    </Show>
                    <Show when={writing()}>
                        <div class="forum-widget__compose forum-widget__compose--bottom">
                            <Show when={access() === 'write'}>
                                <ForumComposer
                                    variant="inline"
                                    placeholder={s().postPlaceholder || 'Write a message…'}
                                    submitLabel="Send"
                                    maxLength={ctx.meta()?.maxLength}
                                    guest={!ctx.signedIn()}
                                    disabled={ctx.readOnly()}
                                    disabledHint="Messages are posted from the site, not the editor preview."
                                    context={replyTo() ? `Replying to ${replyTo()!.author.name}` : null}
                                    onClearContext={() => setReplyTo(null,)}
                                    focusKey={() => replyTo()?.id}
                                    onSubmit={async (input,) => {
                                        const c = await postForumReply(ctx, t().id, replyTo()?.id ?? null, input,);
                                        setReplyTo(null,);
                                        await refresh();
                                        if (!idsOf(store.tops,).includes(c.id,) && !c.parentId) setTops([c, ...store.tops,],);
                                        fresh.mark([c.id,],);
                                        requestAnimationFrame(() => keeper.toBottom(true,),);
                                        ctx.refreshFeed();
                                    }}
                                />
                            </Show>
                            <Show when={access() === 'login'}>
                                <button type="button" class="forum-btn" onClick={() => ctx.requestLogin('Log in to reply',)}>Log in to reply</button>
                            </Show>
                            <Show when={access() === null}>
                                <p class="forum-widget__reason">{t().locked ? 'This thread is locked.' : (t().replyBlockedReason ?? 'You cannot reply here.')}</p>
                            </Show>
                        </div>
                    </Show>
                </div>
            )}
        </Show>
    );
};

export default ForumThreadView;
