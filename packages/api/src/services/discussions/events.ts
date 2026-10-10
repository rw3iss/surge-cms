/**
 * Discussion events, fired AFTER the write commits. Features hook in here
 * (reply emails, admin notifications, forum counters) without the engine
 * importing them. Listeners never break the request: errors are logged.
 */
import { logger, } from '../../utils/logger';
import type { CommentRow, } from './rows';
import type { Viewer, } from './viewer';

export type DiscussionEventType = 'created' | 'approved' | 'edited' | 'hidden' | 'deleted' | 'restored' | 'reported' | 'reacted';

export interface DiscussionEvent {
    type: DiscussionEventType;
    comment: CommentRow;
    actor: Viewer;
    /** `reported`: the reason given. */
    reason?: string | null;
}

type Listener = (e: DiscussionEvent,) => Promise<void> | void;
const listeners: Listener[] = [];

export function onDiscussionEvent(fn: Listener,): void {
    listeners.push(fn,);
}

export function emitDiscussionEvent(e: DiscussionEvent,): void {
    for (const fn of listeners) {
        Promise.resolve().then(() => fn(e,),).catch((err,) =>
            logger.warn('Discussion event listener failed', { type: e.type, commentId: e.comment.id, error: (err as Error).message, },)
        );
    }
}
