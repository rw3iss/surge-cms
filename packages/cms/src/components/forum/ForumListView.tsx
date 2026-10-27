/**
 * Forum widget, list mode: the thread cards, "Load more", live polling and
 * the new-thread composer (inline / form / button), placed above the list —
 * or below it in chat order (newest at the bottom, scrolled to the end). Both
 * sit in ONE bordered frame; only the list inside it scrolls.
 */
import { Component, createEffect, createSignal, For, Match, on, Show, Switch, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { isAdminView, } from '../blocks/slotContext';
import { useForum, } from './forumContext';
import { displayOrder, pollIntervalMs, postAccess, } from './forumFeed';
import ForumComposer, { type ForumComposerInput, } from './ForumComposer';
import { createFreshIds, createScrollKeeper, usePoll, type useForumFeed, } from './forumHooks';
import ForumThreadCard from './ForumThreadCard';

type Feed = ReturnType<typeof useForumFeed>;

const ForumListView: Component<{ feed: Feed; }> = (props,) => {
    const ctx = useForum();
    const s = () => ctx.settings();
    const feed = props.feed;
    const chat = () => s().chatOrder;
    const fresh = createFreshIds();
    let listEl: HTMLDivElement | undefined;
    const keeper = createScrollKeeper(() => listEl,);

    const shown = () => displayOrder(feed.items(), chat(),);

    // Chat order opens at the newest post (the end of the list).
    createEffect(on(() => feed.loaded() && !feed.loading(), (ready,) => {
        if (ready && chat()) requestAnimationFrame(() => keeper.toBottom(),);
    },),);

    const refresh = async () => {
        const added = await feed.refresh((change,) => keeper.apply(change, chat() ? 'bottom' : 'top', chat(),),);
        fresh.mark(added,);
        return added;
    };

    usePoll(refresh, {
        interval: () => pollIntervalMs(s().refreshSeconds,),
        active: ctx.live,
        paused: ctx.typing,
    },);

    const loadMore = () => void feed.loadMore((change,) => keeper.apply(change, chat() ? 'top' : 'bottom', false,),);

    // ─── New threads ───
    const target = () => feed.meta()?.postTarget ?? null;
    const access = () => postAccess(target(), ctx.signedIn(), s().allowAnonymous,);
    const [formOpen, setFormOpen,] = createSignal(false,);

    const createThread = async (input: ForumComposerInput,) => {
        const t = target();
        if (!t) return;
        const created = await cms.forum.threads.create({
            categoryId: t.categoryId,
            body: input.body,
            ...(input.title ? { title: input.title, } : {}),
            ...(ctx.signedIn() ? {} : { guestName: input.guestName, website: input.website, }),
        },);
        ctx.notify(created.status === 'pending' ? 'Thanks — your post will appear once it is approved.' : 'Posted',);
        setFormOpen(false,);
        const added = await refresh();
        fresh.mark([created.id, ...added,],);
        if (chat()) requestAnimationFrame(() => keeper.toBottom(true,),);
        else listEl?.scrollTo({ top: 0, },);
    };

    const placeholder = () => s().postPlaceholder || (s().postMode === 'inline' ? 'Start a conversation…' : 'Write your post… (Markdown supported)');

    const Composer = (p: { at: 'top' | 'bottom'; },) => (
        <Show when={s().postMode !== 'off'}>
            <div class={`forum-widget__compose forum-widget__compose--${p.at}`}>
                <Switch>
                    <Match when={access() === 'none'}>
                        <Show when={isAdminView() && feed.loaded() && !feed.loading()}>
                            <p class="block-message">
                                Posting is on, but this block has no category for new posts. Choose one under Posting → "New posts go to", or
                                filter the query by a category.
                            </p>
                        </Show>
                    </Match>
                    <Match when={access() === 'login'}>
                        <button type="button" class="forum-btn" onClick={() => ctx.requestLogin('Log in to post',)}>Log in to post</button>
                    </Match>
                    <Match when={access() === 'blocked'}>
                        <p class="forum-widget__reason">{target()?.reason ?? 'You cannot post here.'}</p>
                    </Match>
                    <Match when={access() === 'write' && s().postMode === 'inline'}>
                        <ForumComposer
                            variant="inline"
                            placeholder={placeholder()}
                            submitLabel="Post"
                            maxLength={feed.meta()?.maxLength}
                            guest={!ctx.signedIn()}
                            disabled={ctx.readOnly()}
                            disabledHint="Posting works on the site, not in the editor preview."
                            onSubmit={createThread}
                        />
                    </Match>
                    <Match when={access() === 'write' && (s().postMode === 'form' || formOpen())}>
                        <ForumComposer
                            variant="form"
                            withTitle
                            autofocus={s().postMode === 'button'}
                            placeholder={placeholder()}
                            submitLabel="Post"
                            maxLength={feed.meta()?.maxLength}
                            guest={!ctx.signedIn()}
                            disabled={ctx.readOnly()}
                            disabledHint="Posting works on the site, not in the editor preview."
                            onCancel={s().postMode === 'button' ? () => setFormOpen(false,) : undefined}
                            onSubmit={createThread}
                        />
                    </Match>
                    <Match when={access() === 'write' && s().postMode === 'button'}>
                        <button type="button" class="forum-btn" onClick={() => setFormOpen(true,)}>+ New post</button>
                    </Match>
                </Switch>
                <Show when={target() && s().showCategory}>
                    <p class="forum-widget__target">Posting in <strong>{target()!.categoryName}</strong></p>
                </Show>
            </div>
        </Show>
    );

    const LoadMore = () => (
        <Show when={feed.hasMore()}>
            <button type="button" class="forum-link-btn forum-widget__more" disabled={feed.loadingMore()} onClick={loadMore}>
                {feed.loadingMore() ? 'Loading…' : chat() ? 'Load earlier posts' : 'Load more'}
            </button>
        </Show>
    );

    return (
        // ONE bordered frame that does not scroll: the writing row (top, or bottom in
        // chat order) and the list that scrolls inside it — nothing is cut at its edges.
        <div class="forum-widget__frame">
            <Show when={!chat()}><Composer at="top" /></Show>
            <div class="forum-widget__list" ref={listEl} onScroll={keeper.onScroll} aria-live="polite" aria-busy={feed.loading()}>
                <Show when={chat()}><LoadMore /></Show>
                <Show
                    when={feed.items().length > 0}
                    fallback={
                        <Show
                            when={!feed.loading()}
                            fallback={<div class="forum-widget__skeleton" aria-hidden="true"><span /><span /><span /></div>}
                        >
                            <Show
                                when={s().emptyText}
                                fallback={
                                    <p class="forum-widget__empty">
                                        {isAdminView() ? 'No threads to show yet — check the block\'s data (Set data…) or start a thread.' : 'No posts yet.'}
                                    </p>
                                }
                            >
                                <p class="forum-widget__empty">{s().emptyText}</p>
                            </Show>
                        </Show>
                    }
                >
                    <For each={shown()}>{(t,) => <ForumThreadCard thread={t} fresh={fresh.isFresh(t.id,)} />}</For>
                </Show>
                <Show when={!chat()}><LoadMore /></Show>
            </div>
            <Show when={chat() && keeper.pill()}>
                <button type="button" class="forum-widget__pill" onClick={() => keeper.toBottom(true,)}>New posts ↓</button>
            </Show>
            <Show when={chat()}><Composer at="bottom" /></Show>
        </div>
    );
};

export default ForumListView;
