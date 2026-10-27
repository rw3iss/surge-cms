/**
 * One thread in the Forum widget's list mode. What it shows follows the
 * block's display switches: avatar, author, date, category, Pinned / Locked /
 * Awaiting approval badges, the title (linked to the thread page), the
 * opening post (none / excerpt / full), reply / view counts, last reply, Read more,
 * reactions on the opening post, "N replies" (opens them in place) and Reply
 * (a small composer under the card).
 *
 * Styles: `full` = title, post, a meta row (counts, last reply, Read more),
 * then the action row. `minimal` = chat: a compact avatar + name row, the
 * message as a bubble, ONE row — Reply, reactions, "N replies (2m ago by X)",
 * "N views", Read more.
 */
import type { Comment, ForumFeedThread, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createSignal, Show, } from 'solid-js';
import { timeAgo, } from '../../utils/timeAgo';
import { memberUrl, } from '../discussions/AuthorCard';
import ReactionBar from '../discussions/ReactionBar';
import { ForumAvatar, postForumReply, useForum, } from './forumContext';
import { clipText, countLabel, replyAccess, titleRepeatsBody, } from './forumFeed';
import ForumComposer from './ForumComposer';
import ForumReplies, { type ForumRepliesApi, } from './ForumReplies';
import { createFreshIds, } from './forumHooks';

const ForumThreadCard: Component<{ thread: ForumFeedThread; fresh?: boolean; }> = (props,) => {
    const ctx = useForum();
    const s = () => ctx.settings();
    const t = () => props.thread;
    const [repliesOpen, setRepliesOpen,] = createSignal(s().showReplies && s().expandReplies && t().replyCount > 0,);
    const [composerOpen, setComposerOpen,] = createSignal(false,);
    const [replyTo, setReplyTo,] = createSignal<Comment | null>(null,);
    const [error, setError,] = createSignal('',);
    const freshReplies = createFreshIds();
    let replies: ForumRepliesApi | undefined;

    const access = () => (s().allowReplies ? replyAccess(t(), ctx.signedIn(), ctx.guestWriting(),) : null);
    const startReply = (to: Comment | null,) => {
        if (access() === 'login') {
            ctx.requestLogin('Log in to reply',);
            return;
        }
        setReplyTo(to,);
        setComposerOpen(true,);
    };

    const excerpt = () => clipText(t().excerpt, s().excerptLength,);
    const opening = () => t().opening;
    const minimal = () => s().threadStyle === 'minimal';
    const hasBody = () => (s().content === 'excerpt' && Boolean(excerpt(),)) || (s().content === 'full' && Boolean(opening()?.bodyHtml,));
    /** "2m ago by Ryan Weiss". */
    const lastReply = () => `${timeAgo(t().lastReplyAt,)}${t().lastReplyBy ? ` by ${t().lastReplyBy!.name}` : ''}`;
    const canOpenReplies = () => s().showReplies && t().replyCount > 0;

    // Pieces shared by both styles (each call renders its own nodes).
    const reactions = () => (
        <Show when={ctx.reactionKinds().length > 0 && opening() && opening()!.status === 'visible'}>
            <ReactionBar
                commentId={opening()!.id}
                reactions={opening()!.reactions}
                myReactions={opening()!.myReactions}
                kinds={ctx.reactionKinds()}
                onSignIn={ctx.readOnly() ? undefined : () => ctx.requestLogin('Log in to react',)}
                onError={setError}
            />
        </Show>
    );
    /** "N replies" (or "Show replies" when the count is hidden) → opens the replies in place. */
    const repliesToggle = () => (
        <Show when={canOpenReplies()}>
            <button type="button" class="forum-link-btn" aria-expanded={repliesOpen()} onClick={() => setRepliesOpen(!repliesOpen(),)}>
                {repliesOpen() ? 'Hide replies' : s().showReplyCount ? countLabel(t().replyCount, 'reply', 'replies',) : 'Show replies'}
            </button>
        </Show>
    );
    const replyButton = () => (
        <Show when={access()}>
            <button type="button" class="forum-link-btn forum-link-btn--strong" onClick={() => startReply(null,)}>Reply</button>
        </Show>
    );
    const readMore = () => (
        <Show when={s().readMoreLabel}>
            <A class="forum-card__more" href={t().url}>{s().readMoreLabel} →</A>
        </Show>
    );

    return (
        <article
            class={`forum-card forum-card--${s().threadStyle}`}
            classList={{ 'is-new': Boolean(props.fresh,), 'has-avatar': s().showAvatar, 'is-pinned': t().pinned, 'is-pending': t().status === 'pending', }}
        >
            <header class="forum-card__head">
                <Show when={s().showAvatar}>
                    <ForumAvatar name={t().author.name} src={t().author.avatarUrl} size={minimal() ? 'xs' : 'md'} />
                </Show>
                <div class="forum-card__byline">
                    <Show when={s().showAuthor}>
                        <Show when={t().author.handle} fallback={<span class="forum-card__author">{t().author.name}</span>}>
                            {(h,) => <a class="forum-card__author" href={memberUrl(h(),)}>{t().author.name}</a>}
                        </Show>
                    </Show>
                    <Show when={s().showDate}>
                        <time class="forum-card__time" dateTime={t().createdAt} title={new Date(t().createdAt,).toLocaleString()}>
                            {timeAgo(t().createdAt,)}
                        </time>
                    </Show>
                    <Show when={s().showCategory && t().category?.name}>
                        <span class="forum-chip">{t().category.name}</span>
                    </Show>
                </div>
                <div class="forum-card__badges">
                    <Show when={t().pinned}><span class="forum-badge">Pinned</span></Show>
                    <Show when={t().locked}><span class="forum-badge forum-badge--muted">Locked</span></Show>
                    <Show when={t().status === 'pending'}><span class="forum-badge forum-badge--pending">Awaiting approval</span></Show>
                </div>
            </header>

            {/* A chat-style post's title is its first line: with the body shown, say it once. */}
            <Show when={s().showTitle && (s().content === 'none' || !titleRepeatsBody(t().title, t().excerpt,))}>
                <h3 class="forum-card__title"><A href={t().url}>{t().title}</A></h3>
            </Show>
            <Show when={hasBody()}>
                <div class="forum-card__message">
                    <Show when={s().content === 'excerpt' && excerpt()}>
                        <p class="forum-card__excerpt">{excerpt()}</p>
                    </Show>
                    <Show when={s().content === 'full' && opening()?.bodyHtml}>
                        <div class="forum-card__body rich-text" innerHTML={opening()!.bodyHtml ?? ''} />
                    </Show>
                </div>
            </Show>

            <Show
                when={minimal()}
                fallback={
                    <>
                        <Show when={s().showReplyCount || s().showViewCount || (s().showLastReply && t().lastReplyAt) || s().readMoreLabel}>
                            <div class="forum-card__meta">
                                <Show when={s().showReplyCount}>
                                    <span>{countLabel(t().replyCount, 'reply', 'replies',)}</span>
                                </Show>
                                <Show when={s().showViewCount}>
                                    <span>{countLabel(t().viewCount, 'view', 'views',)}</span>
                                </Show>
                                <Show when={s().showLastReply && t().lastReplyAt}>
                                    <span>Last reply {lastReply()}</span>
                                </Show>
                                {readMore()}
                            </div>
                        </Show>
                        <div class="forum-card__actions">
                            {reactions()}
                            {repliesToggle()}
                            {replyButton()}
                        </div>
                    </>
                }
            >
                {/* Minimal: Reply · reactions · replies (last reply) · views · Read more — one row. */}
                <div class="forum-card__bar">
                    {replyButton()}
                    {reactions()}
                    <Show
                        when={canOpenReplies()}
                        fallback={
                            <Show when={s().showReplyCount || (s().showLastReply && t().lastReplyAt)}>
                                <span class="forum-card__stat">
                                    {s().showReplyCount ? countLabel(t().replyCount, 'reply', 'replies',) : 'Last reply'}
                                    <Show when={s().showLastReply && t().lastReplyAt}>
                                        {' '}<span class="forum-card__when">({lastReply()})</span>
                                    </Show>
                                </span>
                            </Show>
                        }
                    >
                        <span class="forum-card__stat">
                            {repliesToggle()}
                            <Show when={s().showLastReply && t().lastReplyAt && !repliesOpen()}>
                                {' '}<span class="forum-card__when">({lastReply()})</span>
                            </Show>
                        </span>
                    </Show>
                    <Show when={s().showViewCount}>
                        <span class="forum-card__stat">{countLabel(t().viewCount, 'view', 'views',)}</span>
                    </Show>
                    {readMore()}
                </div>
            </Show>
            <Show when={error()}>
                <p class="forum-composer__error" role="alert">{error()}</p>
            </Show>

            <Show when={repliesOpen()}>
                <ForumReplies
                    thread={t()}
                    canReply={Boolean(access(),)}
                    onReply={(c,) => startReply(c,)}
                    isFresh={freshReplies.isFresh}
                    onApi={(api,) => (replies = api)}
                />
            </Show>

            <Show when={composerOpen()}>
                <ForumComposer
                    class="forum-card__composer"
                    variant="inline"
                    autofocus
                    placeholder="Write a reply…"
                    submitLabel="Send reply"
                    maxLength={ctx.meta()?.maxLength}
                    guest={!ctx.signedIn() && ctx.guestWriting()}
                    disabled={ctx.readOnly()}
                    disabledHint="Replies are posted from the site, not the editor preview."
                    context={replyTo() ? `Replying to ${replyTo()!.author.name}` : null}
                    onClearContext={() => setReplyTo(null,)}
                    onCancel={() => setComposerOpen(false,)}
                    focusKey={() => replyTo()?.id}
                    onSubmit={async (input,) => {
                        const c = await postForumReply(ctx, t().id, replyTo()?.id ?? null, input,);
                        setReplyTo(null,);
                        setComposerOpen(false,);
                        freshReplies.mark([c.id,],);
                        if (s().showReplies) {
                            if (repliesOpen() && replies) await replies.add(c,);
                            else setRepliesOpen(true,);
                        }
                        ctx.refreshFeed();
                    }}
                />
            </Show>
        </article>
    );
};

export default ForumThreadCard;
