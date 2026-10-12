/**
 * User detail → Messages: send this user an email (the generic reply
 * procedure, `user` source) and see every message sent to them — when, the
 * subject, who sent it, and whether it went out.
 */
import { createResource, createSignal, For, Show, } from 'solid-js';
import { formatDateTime, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ReplyHistoryModal from '../reply/ReplyHistoryModal';
import ReplyModal from '../reply/ReplyModal';
import '../reply/ReplyActions.scss';

export default function UserMessagesPanel(props: { userId: string; },) {
    const toast = useToast();
    const [items, { refetch, },] = createResource(() => props.userId, (id,) => cms.replies.history('user', id,).catch(() => []),);
    const [composing, setComposing,] = createSignal(false,);
    const [viewing, setViewing,] = createSignal(false,);

    return (
        <div class="user-detail__panel user-detail__panel--messages">
            <h2 class="user-detail__panel-title">Messages</h2>
            <Show
                when={items()?.length}
                fallback={<p class="form-help-muted">{items.loading ? 'Loading…' : 'No messages have been sent to this user from the admin.'}</p>}
            >
                <ul class="user-messages">
                    <For each={items()!.slice(0, 5,)}>
                        {(r,) => (
                            <li class="user-messages__item">
                                <span class="reply-history__status" classList={{ 'reply-history__status--failed': r.status === 'failed', }}>
                                    {r.status === 'sent' ? 'Sent' : 'Failed'}
                                </span>
                                <span class="user-messages__subject">{r.subject || '(no subject)'}</span>
                                <span class="user-messages__meta">
                                    {formatDateTime(r.createdAt,)}{r.sentBy ? ` · ${r.sentBy.name}` : ''}
                                </span>
                            </li>
                        )}
                    </For>
                </ul>
            </Show>
            <div class="user-detail__activity-links">
                <button type="button" class="ui-button ui-button--sm ui-button--primary" onClick={() => setComposing(true,)}>
                    Send message
                </button>
                <Show when={items()?.length}>
                    <button type="button" class="ui-button ui-button--sm ui-button--secondary" onClick={() => setViewing(true,)}>
                        View messages ({items()!.length})
                    </button>
                </Show>
            </div>

            <Show when={composing()}>
                <ReplyModal
                    source="user"
                    record={{ userId: props.userId, }}
                    onClose={() => { setComposing(false,); void refetch(); }}
                    onSent={(to,) => toast.success(`Message sent to ${to}.`,)}
                />
            </Show>
            <Show when={viewing()}>
                <ReplyHistoryModal
                    source="user"
                    subjectId={props.userId}
                    onClose={() => setViewing(false,)}
                    onReplyAgain={() => { setViewing(false,); setComposing(true,); }}
                />
            </Show>
        </div>
    );
}
