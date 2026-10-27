/**
 * One message in the Forum widget — a reply under a card (list mode) or a
 * line of a thread's chat stream (thread mode): avatar, name (member page
 * link), time, "Awaiting approval", the body (server-sanitized HTML),
 * reactions and Reply. Deep replies keep a small indent (`indent`) and say
 * whom they answer when flattened further.
 */
import type { Comment, } from '@sitesurge/types';
import { Component, createMemo, createSignal, For, Show, } from 'solid-js';
import { timeAgo, } from '../../utils/timeAgo';
import { memberUrl, } from '../discussions/AuthorCard';
import ReactionBar from '../discussions/ReactionBar';
import { layoutThread, } from '../discussions/threadLayout';
import { ForumAvatar, useForum, } from './forumContext';

export interface ForumMessageProps {
    comment: Comment;
    indent?: number;
    replyingTo?: string | null;
    fresh?: boolean;
    /** The thread's opening post (thread mode). */
    opening?: boolean;
    /** Show a Reply action. */
    canReply?: boolean;
    onReply?: (c: Comment,) => void;
}

const ForumMessage: Component<ForumMessageProps> = (props,) => {
    const ctx = useForum();
    const c = () => props.comment;
    const [error, setError,] = createSignal('',);
    const visible = () => c().status === 'visible';
    const deleted = () => c().status === 'deleted';

    return (
        <div
            id={`comment-${c().id}`}
            class={`forum-msg forum-msg--indent-${Math.min(props.indent ?? 0, 2,)}`}
            classList={{ 'is-new': Boolean(props.fresh,), 'is-pending': c().status === 'pending', 'forum-msg--opening': Boolean(props.opening,), }}
        >
            <Show when={ctx.settings().showAvatar}>
                <ForumAvatar name={c().author.name} src={c().author.avatarUrl} size="sm" />
            </Show>
            <div class="forum-msg__main">
                <div class="forum-msg__head">
                    <Show when={c().author.handle} fallback={<span class="forum-msg__name">{c().author.name}</span>}>
                        {(h,) => <a class="forum-msg__name" href={memberUrl(h(),)}>{c().author.name}</a>}
                    </Show>
                    <Show when={c().author.isGuest && !deleted()}>
                        <span class="forum-badge forum-badge--muted">Guest</span>
                    </Show>
                    <time class="forum-msg__time" dateTime={c().createdAt} title={new Date(c().createdAt,).toLocaleString()}>
                        {timeAgo(c().createdAt,)}
                    </time>
                    <Show when={c().status === 'pending'}>
                        <span class="forum-badge forum-badge--pending">Awaiting approval</span>
                    </Show>
                </div>
                <Show when={props.replyingTo}>
                    <div class="forum-msg__replying">↪ {props.replyingTo}</div>
                </Show>
                <Show when={!deleted()} fallback={<p class="forum-msg__deleted">[deleted]</p>}>
                    <div class="forum-msg__body rich-text" innerHTML={c().bodyHtml ?? ''} />
                </Show>
                <Show when={visible() && (ctx.reactionKinds().length > 0 || (props.canReply && props.onReply))}>
                    <div class="forum-msg__actions">
                        <Show when={ctx.reactionKinds().length > 0}>
                            <ReactionBar
                                commentId={c().id}
                                reactions={c().reactions}
                                myReactions={c().myReactions}
                                kinds={ctx.reactionKinds()}
                                onSignIn={ctx.readOnly() ? undefined : () => ctx.requestLogin('Log in to react',)}
                                onError={setError}
                            />
                        </Show>
                        <Show when={props.canReply && props.onReply}>
                            <button type="button" class="forum-link-btn" onClick={() => props.onReply?.(c(),)}>Reply</button>
                        </Show>
                    </div>
                </Show>
                <Show when={error()}>
                    <p class="forum-composer__error" role="alert">{error()}</p>
                </Show>
            </div>
        </div>
    );
};

/**
 * Top-level comments with their replies as message rows (indent ≤ 2). Rows
 * are keyed by the comment object, so with a reconciled store a refresh
 * updates rows in place instead of re-creating every message.
 */
export const ForumMessageList: Component<{
    tops: Comment[];
    isFresh: (id: string,) => boolean;
    canReply?: boolean;
    onReply?: (c: Comment,) => void;
}> = (props,) => {
    const rows = createMemo(() => layoutThread(props.tops, 2,),);
    const byId = createMemo(() => new Map(rows().map((r,) => [r.comment.id, r,]),),);
    return (
        <For each={rows().map((r,) => r.comment)}>
            {(c,) => (
                <ForumMessage
                    comment={c}
                    indent={byId().get(c.id,)?.indent ?? 0}
                    replyingTo={byId().get(c.id,)?.replyingTo ?? null}
                    fresh={props.isFresh(c.id,)}
                    canReply={props.canReply}
                    onReply={props.onReply}
                />
            )}
        </For>
    );
};

export default ForumMessage;
