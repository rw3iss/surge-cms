/**
 * Every reply recorded for one record, newest first: when, who sent it, to
 * whom, the subject, whether it went out (and why not), the message as typed,
 * and the email exactly as it was delivered (sandboxed).
 */
import { createResource, createSignal, For, Show, } from 'solid-js';
import { formatDateTime, type ReplyRecord, type ReplySourceKey, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import ModalShell from '../common/ModalShell';
import './ReplyModal.scss';
import './ReplyActions.scss';
import { EVENT_LABELS, replyStatusView, } from './replyStatus';

export interface ReplyHistoryModalProps {
    source: ReplySourceKey;
    subjectId: string;
    onClose: () => void;
    /** Show a "Reply again" button that opens the compose modal. */
    onReplyAgain?: () => void;
}

export default function ReplyHistoryModal(props: ReplyHistoryModalProps,) {
    const [items,] = createResource(() => cms.replies.history(props.source, props.subjectId,),);
    const [open, setOpen,] = createSignal<string | null>(null,);
    const [showEmail, setShowEmail,] = createSignal<string | null>(null,);

    // The newest reply starts expanded.
    const isOpen = (r: ReplyRecord, i: number,) => open() === r.id || (open() === null && i === 0);
    const toggle = (r: ReplyRecord, i: number,) => setOpen(isOpen(r, i,) ? '' : r.id,);
    const recipient = (r: ReplyRecord,) => r.toName ? `${r.toName} <${r.to}>` : r.to;
    const sender = (r: ReplyRecord,) => r.fromName ? `${r.fromName} <${r.fromEmail}>` : r.fromEmail;
    const view = (r: ReplyRecord,) => replyStatusView(r.status, r.delivery, r.openCount > 0,);
    const time = (iso: string,) => formatDateTime(iso,);

    return (
        <ModalShell open onClose={props.onClose} size="lg" class="reply-modal reply-history" ariaLabel="Replies">
            <div class="reply-modal__header">
                <h2>Replies</h2>
                <Show when={items()?.length}>
                    <p class="reply-modal__to">{items()!.length} recorded · newest first</p>
                </Show>
            </div>

            <div class="reply-modal__body">
                <Show when={!items.loading} fallback={<p class="form-help-muted">Loading…</p>}>
                    <Show when={!items.error} fallback={<div class="alert alert--error">Could not load the replies.</div>}>
                        <Show when={items()?.length} fallback={<p class="form-help-muted">No replies have been sent for this record.</p>}>
                            <For each={items()}>
                                {(r, i,) => (
                                    <article class="reply-history__item" classList={{ 'is-open': isOpen(r, i(),), }}>
                                        <button type="button" class="reply-history__head" onClick={() => toggle(r, i(),)} aria-expanded={isOpen(r, i(),)}>
                                            <span class={`reply-history__status reply-tone--${view(r,).tone}`} title={view(r,).hint}>
                                                {view(r,).label}
                                            </span>
                                            <span class="reply-history__subject">{r.subject || '(no subject)'}</span>
                                            <span class="reply-history__date">{formatDateTime(r.createdAt,)}</span>
                                        </button>
                                        <Show when={isOpen(r, i(),)}>
                                            <dl class="reply-history__meta">
                                                <dt>To</dt><dd>{recipient(r,)}</dd>
                                                <dt>From</dt><dd>{sender(r,) || '—'}</dd>
                                                <dt>Sent by</dt><dd>{r.sentBy?.name ?? '—'}</dd>
                                                <Show when={r.error}>
                                                    <dt>Error</dt><dd class="reply-history__error">{r.error}</dd>
                                                </Show>
                                                <Show when={r.deliveryDetail && r.delivery !== 'delivered'}>
                                                    <dt>Delivery</dt><dd class="reply-history__error">{r.deliveryDetail}</dd>
                                                </Show>
                                            </dl>
                                            <Show when={r.status === 'sent'}>
                                                <div class="reply-history__stats">
                                                    <span>Delivered: <strong>{r.deliveredAt ? time(r.deliveredAt,) : '—'}</strong></span>
                                                    <span title="Approximate. Some mail apps (Apple Mail) load images without the reader; others block images, so a real open is not seen.">
                                                        Opened: <strong>{r.openCount ? `${r.openCount}× · first ${time(r.firstOpenedAt!,)}` : '—'}</strong> (approx.)
                                                    </span>
                                                    <span>Link clicks: <strong>{r.clickCount || '—'}</strong></span>
                                                </div>
                                            </Show>
                                            <Show when={r.events?.length}>
                                                <ul class="reply-history__timeline" aria-label="Events">
                                                    <For each={r.events}>
                                                        {(e,) => (
                                                            <li>
                                                                <span class="reply-history__event-time">{time(e.at,)}</span>
                                                                <strong>{EVENT_LABELS[e.type] ?? e.type}</strong>
                                                                <Show when={e.detail}>
                                                                    {' '}<span class="reply-history__event-detail">· {e.detail}</span>
                                                                </Show>
                                                            </li>
                                                        )}
                                                    </For>
                                                </ul>
                                            </Show>
                                            <div class="reply-history__message">{r.message}</div>
                                            <Show when={r.html}>
                                                <button
                                                    type="button"
                                                    class="reply-actions__link"
                                                    onClick={() => setShowEmail(showEmail() === r.id ? null : r.id,)}
                                                >
                                                    {showEmail() === r.id ? 'Hide the email' : 'Show the email as delivered'}
                                                </button>
                                                <Show when={showEmail() === r.id}>
                                                    <iframe class="reply-modal__preview" title="Delivered email" sandbox="" srcdoc={r.html ?? ''} />
                                                </Show>
                                            </Show>
                                        </Show>
                                    </article>
                                )}
                            </For>
                        </Show>
                    </Show>
                </Show>
            </div>

            <div class="reply-modal__footer">
                <span class="reply-modal__footer-spacer" />
                <button type="button" class="ui-button ui-button--secondary" onClick={props.onClose}>Close</button>
                <Show when={props.onReplyAgain}>
                    <button type="button" class="ui-button ui-button--primary" onClick={() => props.onReplyAgain!()}>Reply again</button>
                </Show>
            </div>
        </ModalShell>
    );
}
