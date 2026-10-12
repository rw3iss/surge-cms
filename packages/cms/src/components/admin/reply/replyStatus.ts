/**
 * One reading of "what happened to this reply", shared by the table links,
 * the history modal and the user Messages panel. Order matters: a send
 * failure, then the worst delivery outcome, then opened, then delivered.
 */
import type { ReplyDelivery, ReplyEventType, ReplyStatus, } from '@sitesurge/types';

export type ReplyTone = 'ok' | 'good' | 'warn' | 'bad' | 'muted';

export interface ReplyStatusView {
    label: string;
    tone: ReplyTone;
    /** Tooltip / longer explanation. */
    hint: string;
}

export function replyStatusView(status: ReplyStatus, delivery: ReplyDelivery | null, opened: boolean,): ReplyStatusView {
    if (status === 'failed') return { label: 'Failed', tone: 'bad', hint: 'The mail server did not accept the message.', };
    switch (delivery) {
        case 'bounced': return { label: 'Bounced', tone: 'bad', hint: 'The receiving server refused it.', };
        case 'complained': return { label: 'Marked as spam', tone: 'bad', hint: 'The recipient reported it as spam.', };
        case 'rejected': return { label: 'Rejected', tone: 'bad', hint: 'SES refused to send it.', };
        default: break;
    }
    if (opened) return { label: 'Opened', tone: 'good', hint: 'The email was opened (approximate: some mail apps open mail automatically).', };
    if (delivery === 'delivered') return { label: 'Delivered', tone: 'ok', hint: "The recipient's mail server accepted it.", };
    if (delivery === 'delayed') return { label: 'Delayed', tone: 'warn', hint: 'Delivery is being retried.', };
    return { label: 'Sent', tone: 'muted', hint: 'Accepted by our mail server. No delivery report yet.', };
}

export const EVENT_LABELS: Record<ReplyEventType, string> = {
    send: 'Sent by SES',
    delivery: 'Delivered',
    delay: 'Delayed',
    bounce: 'Bounced',
    complaint: 'Marked as spam',
    reject: 'Rejected',
    open: 'Opened',
    click: 'Link clicked',
};
