/**
 * One comment or forum post: author card, body, "edited" marker, reactions,
 * and Reply / Edit / Delete / Report. Replies are laid out by `CommentThread`
 * (indent cap + "↪ replying to"), so this renders a single comment only.
 * Shared by Comments and the Forum.
 */
import type { Comment, CommentTargetRef, DiscussionsSettings, } from '@sitesurge/types';
import { Component, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import AuthorCard from './AuthorCard';
import CommentComposer, { errorText, } from './CommentComposer';
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

const when = (iso: string,): string => {
    const d = new Date(iso,);
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60,)}m ago`;
    if (s < 86_400) return `${Math.floor(s / 3600,)}h ago`;
    if (s < 7 * 86_400) return `${Math.floor(s / 86_400,)}d ago`;
    return d.toLocaleDateString();
};

const CommentItem: Component<CommentItemProps> = (props,) => {
    const auth = useAuth();
    const c = () => props.comment;
    const [replying, setReplying,] = createSignal(false,);
    const [editing, setEditing,] = createSignal(false,);
    const [draft, setDraft,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [reactions, setReactions,] = createSignal<Record<string, number>>(c().reactions,);
    const [mine, setMine,] = createSignal<string[]>(c().myReactions,);
    const [picker, setPicker,] = createSignal(false,);
    const [reported, setReported,] = createSignal(false,);

    const deleted = () => c().status === 'deleted';
    const reactable = () => Boolean(props.settings?.reactionsEnabled,) && !deleted() && c().status === 'visible';
    const shownKinds = () => (props.settings?.reactions ?? []).filter((k,) => (reactions()[k] ?? 0) > 0);

    const react = async (kind: string,) => {
        if (!auth.isAuthenticated || busy()) return;
        setBusy(true,);
        try {
            const r = await cms.discussions.react(c().id, kind,);
            setReactions(r.reactions,);
            setMine(r.myReactions,);
            setPicker(false,);
        } catch (e) {
            setError(errorText(e,),);
        } finally {
            setBusy(false,);
        }
    };

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

    const remove = async () => {
        if (!window.confirm('Delete this comment?',)) return;
        try {
            await cms.discussions.remove(c().id,);
            props.onChanged?.();
        } catch (e) {
            setError(errorText(e,),);
        }
    };

    const report = async () => {
        const reason = window.prompt('Why are you reporting this comment? (optional)',);
        if (reason === null) return;
        try {
            await cms.discussions.report(c().id, reason || undefined,);
            setReported(true,);
        } catch (e) {
            setError(errorText(e,),);
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
                    {when(c().createdAt,)}
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
                        <div class="comment-item__reactions">
                            <For each={shownKinds()}>
                                {(k,) => (
                                    <button
                                        type="button"
                                        class="comment-item__reaction"
                                        classList={{ 'is-mine': mine().includes(k,), }}
                                        disabled={!auth.isAuthenticated}
                                        title={auth.isAuthenticated ? undefined : 'Log in to react'}
                                        onClick={() => void react(k,)}
                                    >
                                        <span>{k}</span> <span class="comment-item__reaction-n">{reactions()[k]}</span>
                                    </button>
                                )}
                            </For>
                            <Show when={auth.isAuthenticated}>
                                <span class="comment-item__picker-wrap">
                                    <button type="button" class="comment-item__action" aria-expanded={picker()} onClick={() => setPicker(!picker(),)} title="React">
                                        ☺+
                                    </button>
                                    <Show when={picker()}>
                                        <span class="comment-item__picker" role="menu">
                                            <For each={props.settings?.reactions ?? []}>
                                                {(k,) => (
                                                    <button type="button" role="menuitem" classList={{ 'is-mine': mine().includes(k,), }} onClick={() => void react(k,)}>{k}</button>
                                                )}
                                            </For>
                                        </span>
                                    </Show>
                                </span>
                            </Show>
                        </div>
                    </Show>
                    <Show when={props.allowReply && !deleted() && c().status === 'visible'}>
                        <button type="button" class="comment-item__action" onClick={() => setReplying(!replying(),)}>Reply</button>
                    </Show>
                    <Show when={c().canEdit && c().body !== null}>
                        <button type="button" class="comment-item__action" onClick={startEdit}>Edit</button>
                    </Show>
                    <Show when={c().canDelete}>
                        <button type="button" class="comment-item__action" onClick={() => void remove()}>Delete</button>
                    </Show>
                    <Show when={auth.isAuthenticated && !deleted() && c().status === 'visible' && c().author.id !== auth.user?.id}>
                        <button type="button" class="comment-item__action" disabled={reported()} onClick={() => void report()}>
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
        </div>
    );
};

export default CommentItem;
