/**
 * One comment or forum post: author card, body, "edited" marker, reactions,
 * and Reply / Edit / Delete / Report. Replies are laid out by `CommentThread`
 * (indent cap + "↪ replying to"), so this renders a single comment only.
 * Shared by Comments and the Forum.
 */
import type { Comment, CommentTargetRef, DiscussionsSettings, } from '@sitesurge/types';
import { Component, createSignal, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { timeAgo, } from '../../utils/timeAgo';
import AuthorCard from './AuthorCard';
import CommentComposer, { errorText, } from './CommentComposer';
import DiscussionDialog from './DiscussionDialog';
import ReactionBar from './ReactionBar';
import './discussions.scss';

export interface CommentItemProps {
    comment: Comment;
    target: CommentTargetRef;
    settings: DiscussionsSettings | null;
    /** Visual indent level (0…3). */
    indent?: number;
    /** "↪ replying to Name" when the reply is deeper than the indent shows. */
    replyingTo?: string | null;
    /** Replies allowed (commenting open on the item). */
    allowReply?: boolean;
    allowAnonymous?: boolean;
    /** Something changed (posted / edited / deleted) — reload the thread. */
    onChanged?: () => void;
    /** Hide the action row (e.g. a forum thread's opening post shows its own). */
    hideActions?: boolean;
}

const CommentItem: Component<CommentItemProps> = (props,) => {
    const auth = useAuth();
    const c = () => props.comment;
    const [replying, setReplying,] = createSignal(false,);
    const [editing, setEditing,] = createSignal(false,);
    const [draft, setDraft,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [reported, setReported,] = createSignal(false,);

    const deleted = () => c().status === 'deleted';
    const reactable = () => Boolean(props.settings?.reactionsEnabled,) && !deleted() && c().status === 'visible';

    const startEdit = () => {
        setDraft(c().body ?? '',);
        setEditing(true,);
        setError('',);
    };

    const saveEdit = async () => {
        if (!draft().trim() || busy()) return;
        setBusy(true,);
        try {
            await cms.discussions.update(c().id, draft(),);
            setEditing(false,);
            props.onChanged?.();
        } catch (e) {
            setError(errorText(e,),);
        } finally {
            setBusy(false,);
        }
    };

    const [dialog, setDialog,] = createSignal<'delete' | 'report' | null>(null,);

    const remove = async () => {
        try {
            await cms.discussions.remove(c().id,);
            setDialog(null,);
            props.onChanged?.();
        } catch (e) {
            setDialog(null,);
            setError(errorText(e,),);
        }
    };

    const report = async (reason: string,) => {
        try {
            await cms.discussions.report(c().id, reason || undefined,);
            setReported(true,);
        } catch (e) {
            setError(errorText(e,),);
        } finally {
            setDialog(null,);
        }
    };

    return (
        <div
            id={`comment-${c().id}`}
            class={`comment-item comment-item--indent-${props.indent ?? 0}`}
            classList={{ 'comment-item--deleted': deleted(), 'comment-item--pending': c().status === 'pending', 'comment-item--hidden': c().status === 'hidden', }}
        >
            <div class="comment-item__head">
                <AuthorCard author={c().author} />
                <a class="comment-item__time" href={`#comment-${c().id}`} title={new Date(c().createdAt,).toLocaleString()}>
                    {timeAgo(c().createdAt,)}
                </a>
            </div>
            <Show when={props.replyingTo}>
                <div class="comment-item__replying">↪ replying to {props.replyingTo}</div>
            </Show>
            <Show when={c().status === 'pending'}>
                <div class="comment-item__status">Awaiting approval — only you and the moderators can see this.</div>
            </Show>
            <Show when={c().status === 'hidden'}>
                <div class="comment-item__status">Hidden by a moderator.</div>
            </Show>

            <Show
                when={!editing()}
                fallback={
                    <div class="comment-item__edit">
                        <textarea
                            class="comment-composer__input"
                            value={draft()}
                            onInput={(e,) => setDraft(e.currentTarget.value,)}
                            rows={4}
                            maxLength={props.settings?.maxLength ?? 10_000}
                            aria-label="Edit comment"
                        />
                        <div class="comment-composer__actions">
                            <button type="button" class="btn btn--outline btn--sm" onClick={() => setEditing(false,)}>Cancel</button>
                            <button type="button" class="btn btn--primary btn--sm" disabled={busy() || !draft().trim()} onClick={saveEdit}>Save</button>
                        </div>
                    </div>
                }
            >
                <Show when={!deleted()} fallback={<p class="comment-item__deleted">[deleted]</p>}>
                    <div class="comment-item__body rich-text" innerHTML={c().bodyHtml ?? ''} />
                </Show>
            </Show>
            <Show when={c().editedAt && !deleted()}>
                <span class="comment-item__edited" title={new Date(c().editedAt!,).toLocaleString()}>edited</span>
            </Show>

            <Show when={!props.hideActions && !editing()}>
                <div class="comment-item__actions">
                    <Show when={reactable()}>
                        <ReactionBar
                            commentId={c().id}
                            reactions={c().reactions}
                            myReactions={c().myReactions}
                            kinds={props.settings?.reactions ?? []}
                            onError={setError}
                        />
                    </Show>
                    <Show when={props.allowReply && !deleted() && c().status === 'visible'}>
                        <button type="button" class="comment-item__action" onClick={() => setReplying(!replying(),)}>Reply</button>
                    </Show>
                    <Show when={c().canEdit && c().body !== null}>
                        <button type="button" class="comment-item__action" onClick={startEdit}>Edit</button>
                    </Show>
                    <Show when={c().canDelete}>
                        <button type="button" class="comment-item__action" onClick={() => setDialog('delete',)}>Delete</button>
                    </Show>
                    <Show when={auth.isAuthenticated && !deleted() && c().status === 'visible' && c().author.id !== auth.user?.id}>
                        <button type="button" class="comment-item__action" disabled={reported()} onClick={() => setDialog('report',)}>
                            {reported() ? 'Reported' : 'Report'}
                        </button>
                    </Show>
                </div>
            </Show>
            <Show when={error()}>
                <p class="comment-composer__error" role="alert">{error()}</p>
            </Show>
            <Show when={replying()}>
                <div class="comment-item__reply">
                    <CommentComposer
                        target={props.target}
                        parentId={c().id}
                        allowAnonymous={props.allowAnonymous}
                        maxLength={props.settings?.maxLength}
                        autofocus
                        onCancel={() => setReplying(false,)}
                        onPosted={() => { setReplying(false,); props.onChanged?.(); }}
                    />
                </div>
            </Show>
            <Show when={dialog() === 'delete'}>
                <DiscussionDialog
                    title="Delete this comment?"
                    message="This cannot be undone."
                    confirmLabel="Delete"
                    danger
                    onConfirm={() => remove()}
                    onCancel={() => setDialog(null,)}
                />
            </Show>
            <Show when={dialog() === 'report'}>
                <DiscussionDialog
                    title="Report this comment"
                    message="A moderator will review it."
                    confirmLabel="Report"
                    reason
                    reasonLabel="Why are you reporting it? (optional)"
                    maxLength={1000}
                    onConfirm={(reason,) => report(reason,)}
                    onCancel={() => setDialog(null,)}
                />
            </Show>
        </div>
    );
};

export default CommentItem;
