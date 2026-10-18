/**
 * A list of top-level comments with their replies, laid out flat with an
 * indent cap (see threadLayout). Shared by Comments and the Forum.
 *
 * A list carries only the newest replies of each top-level comment; one with
 * more (`hiddenReplies`) gets a "Show N earlier replies" button that loads
 * that comment's full tree (`root`) in place.
 */
import type { Comment, CommentTargetRef, DiscussionsSettings, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, on, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import CommentItem from './CommentItem';
import { layoutThread, } from './threadLayout';

export interface CommentThreadProps {
    comments: Comment[];
    target: CommentTargetRef;
    settings: DiscussionsSettings | null;
    allowReply?: boolean;
    allowAnonymous?: boolean;
    onChanged?: () => void;
}

const CommentThread: Component<CommentThreadProps> = (props,) => {
    /** Root id → its full tree, once "show earlier replies" was clicked. */
    const [full, setFull,] = createSignal<Record<string, Comment>>({},);
    const [loading, setLoading,] = createSignal<string | null>(null,);
    // A reload of the list brings fresh trees — drop the expanded copies.
    createEffect(on(() => props.comments, () => setFull({},), { defer: true, },),);

    const tops = () => props.comments.map((c,) => full()[c.id] ?? c);

    const loadAll = async (root: Comment,) => {
        setLoading(root.id,);
        try {
            const r = await cms.discussions.list(props.target, { root: root.id, },);
            const tree = r.data[0];
            if (tree) setFull({ ...full(), [root.id]: tree, },);
        } catch { /* keep the partial tree */ } finally {
            setLoading(null,);
        }
    };

    return (
        <div class="comment-thread">
            <For each={tops()}>
                {(top,) => (
                    <>
                        <For each={layoutThread([top,],)}>
                            {(row,) => (
                                <CommentItem
                                    comment={row.comment}
                                    indent={row.indent}
                                    replyingTo={row.replyingTo}
                                    target={props.target}
                                    settings={props.settings}
                                    allowReply={props.allowReply}
                                    allowAnonymous={props.allowAnonymous}
                                    onChanged={props.onChanged}
                                />
                            )}
                        </For>
                        <Show when={(top.hiddenReplies ?? 0) > 0}>
                            <button
                                type="button"
                                class="comment-thread__more"
                                disabled={loading() === top.id}
                                onClick={() => void loadAll(top,)}
                            >
                                {loading() === top.id ? 'Loading…' : `Show ${top.hiddenReplies} earlier ${top.hiddenReplies === 1 ? 'reply' : 'replies'}`}
                            </button>
                        </Show>
                    </>
                )}
            </For>
        </div>
    );
};

export default CommentThread;
