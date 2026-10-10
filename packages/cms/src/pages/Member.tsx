/**
 * `/members/:handle` — a member's public page.
 *
 *   - Header: avatar, name, @handle, joined, tier badge, activity count.
 *   - Tabs (`?tab=`): Overview · Comments. Comments shows when Comments or the
 *     Forum is on: their visible comments and forum posts across the site,
 *     each linking to the item at `#comment-<id>`. The API already leaves out
 *     anything on an item this viewer could not read.
 *
 * Author names on comments and in the forum link here with `?tab=comments`.
 */
import { A, useParams, useSearchParams, } from '@solidjs/router';
import type { CommentWithTarget, MemberProfile, } from '@sitesurge/types';
import { formatDate, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, on, Show, } from 'solid-js';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import { useAuth, } from '../stores/auth';
import { isFeatureEnabled, } from '../stores/siteSettings';
import NotFoundPage from './NotFound';
import './Member.scss';

const PAGE_SIZE = 20;

const plural = (n: number, one: string, many = `${one}s`,) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const MemberPage: Component = () => {
    const params = useParams<{ handle: string; }>();
    const [search, setSearch,] = useSearchParams<{ tab?: string; }>();
    const auth = useAuth();

    const [profile, setProfile,] = createSignal<MemberProfile | null>(null,);
    const [missing, setMissing,] = createSignal(false,);

    const [items, setItems,] = createSignal<CommentWithTarget[]>([],);
    const [page, setPage,] = createSignal(0,);
    const [totalPages, setTotalPages,] = createSignal(1,);
    const [loadingComments, setLoadingComments,] = createSignal(false,);
    const [commentsError, setCommentsError,] = createSignal(false,);

    const discussionsOn = () => isFeatureEnabled('comments',) || isFeatureEnabled('forum',);
    const showComments = () => discussionsOn() && Boolean(profile()?.commentsEnabled,);
    const tab = () => (search.tab === 'comments' && showComments() ? 'comments' : 'overview');

    // (Re)load the profile when the handle or the viewer changes (a hidden page
    // is visible to its owner).
    createEffect(on(() => [params.handle, auth.user?.id ?? null,] as const, ([handle,],) => {
        setProfile(null,);
        setMissing(false,);
        setItems([],);
        setPage(0,);
        cms.members.profile(handle,).then(setProfile,).catch(() => setMissing(true,),);
    },),);

    const loadMore = async () => {
        const p = profile();
        if (!p || loadingComments()) return;
        setLoadingComments(true,);
        setCommentsError(false,);
        try {
            const next = page() + 1;
            const res = await cms.members.comments(p.handle, { page: next, limit: PAGE_SIZE, },);
            setItems((cur,) => [...cur, ...res.data,],);
            setPage(next,);
            setTotalPages(res.meta?.totalPages || 1,);
        } catch {
            setCommentsError(true,);
        } finally {
            setLoadingComments(false,);
        }
    };

    // First page of comments when the Comments tab opens.
    createEffect(on(() => [tab(), profile()?.handle,] as const, ([t,],) => {
        if (t === 'comments' && page() === 0 && !loadingComments()) void loadMore();
    },),);

    const activityLine = (p: MemberProfile,) => {
        const a = p.activity;
        const parts = [plural(a.total, 'post',),];
        if (a.comments) parts.push(plural(a.comments, 'comment',),);
        if (a.forumThreads) parts.push(plural(a.forumThreads, 'thread',),);
        if (a.forumReplies) parts.push(plural(a.forumReplies, 'reply', 'replies',),);
        return parts.join(' · ',);
    };

    const reactionTotal = (c: CommentWithTarget,) => Object.values(c.reactions ?? {},).reduce((s, n,) => s + Number(n || 0,), 0,);
    const initial = (name: string,) => name.trim().charAt(0,).toUpperCase() || '?';
    const isSelf = () => Boolean(auth.user?.id,) && auth.user?.id === profile()?.id;

    return (
        <Show
            when={!missing()}
            fallback={<NotFoundPage title="Member not found" message="There is no public member page at this address." />}
        >
            <Show when={profile()} fallback={<div class="member-page"><div class="member-page__loading" aria-busy="true" /></div>}>
                {(p,) => (
                    <div class="member-page">
                        <SeoHead title={p().name} description={p().bio || `${p().name}'s member page.`} noindex={true} />

                        <header class="member-page__header">
                            <div class="member-page__avatar" aria-hidden="true">
                                <Show when={p().avatarUrl} fallback={<span>{initial(p().name,)}</span>}>
                                    <img src={p().avatarUrl!} alt="" />
                                </Show>
                            </div>
                            <div class="member-page__ident">
                                <h1 class="member-page__name">
                                    {p().name}
                                    <Show when={p().role}>
                                        <span class="member-page__badge member-page__badge--staff">{p().role}</span>
                                    </Show>
                                    <Show when={p().tierName}>
                                        <span class="member-page__badge">{p().tierName}</span>
                                    </Show>
                                </h1>
                                <p class="member-page__meta">
                                    <span>@{p().handle}</span>
                                    <span>Joined {formatDate(p().joinedAt,)}</span>
                                    <Show when={p().commentsEnabled}>
                                        <span>{activityLine(p(),)}</span>
                                    </Show>
                                </p>
                                <Show when={p().hidden}>
                                    <p class="member-page__notice">
                                        Only you{isSelf() ? '' : ' (and staff)'} can see this page.
                                        <Show when={isSelf()}> <A href="/profile">Show it in your profile</A>.</Show>
                                    </p>
                                </Show>
                            </div>
                        </header>

                        <Show when={showComments()}>
                            <nav class="member-page__tabs" role="tablist" aria-label="Member page">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={tab() === 'overview'}
                                    classList={{ 'is-active': tab() === 'overview', }}
                                    onClick={() => setSearch({ tab: undefined, },)}
                                >
                                    Overview
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={tab() === 'comments'}
                                    classList={{ 'is-active': tab() === 'comments', }}
                                    onClick={() => setSearch({ tab: 'comments', },)}
                                >
                                    Comments
                                    <span class="member-page__count">{p().activity.total.toLocaleString()}</span>
                                </button>
                            </nav>
                        </Show>

                        <Show when={tab() === 'overview'}>
                            <section class="member-page__overview">
                                <Show when={p().bio} fallback={<p class="member-page__muted">{p().name} hasn't written a bio yet.</p>}>
                                    <p class="member-page__bio">{p().bio}</p>
                                </Show>
                                <Show when={p().commentsEnabled}>
                                    <dl class="member-page__stats">
                                        <div><dt>Comments</dt><dd>{p().activity.comments.toLocaleString()}</dd></div>
                                        <div><dt>Forum threads</dt><dd>{p().activity.forumThreads.toLocaleString()}</dd></div>
                                        <div><dt>Forum replies</dt><dd>{p().activity.forumReplies.toLocaleString()}</dd></div>
                                        <Show when={p().activity.lastActiveAt}>
                                            <div><dt>Last active</dt><dd>{formatDate(p().activity.lastActiveAt!,)}</dd></div>
                                        </Show>
                                    </dl>
                                </Show>
                            </section>
                        </Show>

                        <Show when={tab() === 'comments'}>
                            <section class="member-page__comments" aria-live="polite">
                                <Show when={items().length || loadingComments() || commentsError()} fallback={<p class="member-page__muted">No public comments yet.</p>}>
                                    <ul class="member-page__list">
                                        <For each={items()}>
                                            {(c,) => (
                                                <li class="member-comment">
                                                    <p class="member-comment__excerpt">{c.excerpt}</p>
                                                    <p class="member-comment__meta">
                                                        <Show when={c.target} fallback={<span>on a removed item</span>}>
                                                            {(t,) => (
                                                                <span>
                                                                    {t().type === 'forum_thread' ? 'in ' : 'on '}
                                                                    <A href={`${t().url}#comment-${c.id}`}>{t().title}</A>
                                                                </span>
                                                            )}
                                                        </Show>
                                                        <span>{formatDate(c.createdAt,)}</span>
                                                        <Show when={reactionTotal(c,) > 0}>
                                                            <span>{plural(reactionTotal(c,), 'reaction',)}</span>
                                                        </Show>
                                                        <Show when={c.replyCount > 0}>
                                                            <span>{plural(c.replyCount, 'reply', 'replies',)}</span>
                                                        </Show>
                                                    </p>
                                                </li>
                                            )}
                                        </For>
                                    </ul>
                                </Show>
                                <Show when={commentsError()}>
                                    <p class="member-page__muted">Comments could not be loaded. <button type="button" class="member-page__link" onClick={() => void loadMore()}>Try again</button></p>
                                </Show>
                                <Show when={!commentsError() && page() > 0 && page() < totalPages()}>
                                    <button type="button" class="btn btn--outline member-page__more" disabled={loadingComments()} onClick={() => void loadMore()}>
                                        {loadingComments() ? 'Loading…' : 'Load more'}
                                    </button>
                                </Show>
                                <Show when={loadingComments() && page() === 0}>
                                    <p class="member-page__muted">Loading…</p>
                                </Show>
                            </section>
                        </Show>
                    </div>
                )}
            </Show>
        </Show>
    );
};

export default MemberPage;
