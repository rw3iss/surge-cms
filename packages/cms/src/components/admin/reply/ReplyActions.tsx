/**
 * The reply control for one table row. No replies yet → a "Reply" button.
 * Replies exist → a status line (sent count / "last failed") and two small
 * links: "View reply" (the history) and "Reply again". Owns its modals, so a
 * table only passes the record and the summary.
 */
import { createSignal, Show, } from 'solid-js';
import type { ReplyRef, ReplySourceKey, ReplySummary, } from '@sitesurge/types';
import { useToast, } from '../../common/toast';
import { formatDateTime, } from '@sitesurge/types';
import ReplyHistoryModal from './ReplyHistoryModal';
import ReplyModal from './ReplyModal';
import './ReplyActions.scss';

export interface ReplyActionsProps {
    source: ReplySourceKey;
    /** The record's id — the key replies are stored under. */
    subjectId: string;
    record: ReplyRef;
    summary: ReplySummary | null;
    /** After a send (refetch the summaries). */
    onChanged?: () => void;
    /** Wording: a reply to someone who wrote in (default), or a message we start. */
    kind?: 'reply' | 'message';
}

export default function ReplyActions(props: ReplyActionsProps,) {
    const toast = useToast();
    const [composing, setComposing,] = createSignal(false,);
    const [viewing, setViewing,] = createSignal(false,);
    const count = () => props.summary?.count ?? 0;
    const failed = () => props.summary?.lastStatus === 'failed';
    const words = () => props.kind === 'message'
        ? { action: 'Message', done: 'Messaged', one: 'message', many: 'messages', again: 'Message again', }
        : { action: 'Reply', done: 'Replied', one: 'reply', many: 'replies', again: 'Reply again', };

    const sent = (to: string,) => {
        toast.success(`${props.kind === 'message' ? 'Message' : 'Reply'} sent to ${to}.`,);
        props.onChanged?.();
    };

    return (
        <span class="reply-actions">
            <Show
                when={count() > 0}
                fallback={
                    <button type="button" class="ui-button ui-button--sm ui-button--secondary" onClick={() => setComposing(true,)}>
                        {words().action}
                    </button>
                }
            >
                <span
                    class="reply-actions__status"
                    classList={{ 'reply-actions__status--failed': failed(), }}
                    title={props.summary?.lastAt ? `Last reply ${formatDateTime(props.summary.lastAt,)}` : undefined}
                >
                    {failed() ? `✕ Last ${words().one} failed` : `✓ ${words().done}${count() > 1 ? ` ×${count()}` : ''}`}
                </span>
                <button type="button" class="reply-actions__link" onClick={() => setViewing(true,)}>
                    View {count() > 1 ? words().many : words().one}
                </button>
                <button type="button" class="reply-actions__link" onClick={() => setComposing(true,)}>
                    {failed() ? 'Try again' : words().again}
                </button>
            </Show>

            <Show when={composing()}>
                <ReplyModal
                    source={props.source}
                    record={props.record}
                    onClose={() => { setComposing(false,); props.onChanged?.(); }}
                    onSent={sent}
                />
            </Show>
            <Show when={viewing()}>
                <ReplyHistoryModal
                    source={props.source}
                    subjectId={props.subjectId}
                    onClose={() => setViewing(false,)}
                    onReplyAgain={() => { setViewing(false,); setComposing(true,); }}
                />
            </Show>
        </span>
    );
}
