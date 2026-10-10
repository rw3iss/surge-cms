/**
 * A list of top-level comments with their replies, laid out flat with an
 * indent cap (see threadLayout). Shared by Comments and the Forum.
 */
import type { Comment, CommentTargetRef, DiscussionsSettings, } from '@sitesurge/types';
import { Component, For, } from 'solid-js';
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

const CommentThread: Component<CommentThreadProps> = (props,) => (
    <div class="comment-thread">
        <For each={layoutThread(props.comments,)}>
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
    </div>
);

export default CommentThread;
