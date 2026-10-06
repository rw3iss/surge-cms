/**
 * The generic "Reply by email" modal — one procedure for every admin surface
 * that answers a person who reached out: a campaign donation, a form
 * submission, … (`source` + `ref`, see `@sitesurge/types` `replies`).
 *
 * The recipient is read from the stored record by the server; the modal only
 * shows it. The email is rendered by the server for BOTH Preview and Send, in
 * email mode (table layout, inline styles), so the preview is what ships.
 *
 * Template: "Default Template" (built in) or any Mailing Lists template. With
 * Mailing Lists off there is no picker — just the default, and a link to turn
 * the feature on. Templates (and the subject/message themselves) can use
 * `{{reply.*}}` — fromName, fromEmail, subject, message, messageText, to,
 * toName, date — plus the record's own objects (`{{donation.amount}}`,
 * `{{submission.your_tip}}`, `{{campaign.title}}`, `{{form.title}}`, …).
 */
import { A, } from '@solidjs/router';
import { createSignal, For, onMount, Show, } from 'solid-js';
import type { MailTemplateOption, ReplyRef, ReplySourceKey, ReplyTargetResponse, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { isFeatureEnabled, } from '../../../stores/siteSettings';
import ModalShell from '../common/ModalShell';
import { FormField, } from '../forms';
import './ReplyModal.scss';

export interface ReplyModalProps {
    source: ReplySourceKey;
    /** Identifies the record within its source (sent as `ref`). */
    record: ReplyRef;
    onClose: () => void;
    /** Called with the recipient after a successful send. */
    onSent?: (to: string,) => void;
}

const DEFAULT_TEMPLATE = '';

/** What each top-level object in a reply's context is. Unknown keys (a future
 *  source) fall back to their own name. */
const GROUP_LABELS: Record<string, string> = {
    reply: 'this reply — what you type here',
    donation: 'the donation being answered',
    campaign: 'the campaign it was given to',
    submission: 'the form submission — every field of this form',
    form: 'the form it was sent through',
    site: 'your site',
};


export default function ReplyModal(props: ReplyModalProps,) {
    const templatesOn = () => isFeatureEnabled('mailing_lists',);

    const [target, setTarget,] = createSignal<ReplyTargetResponse | null>(null,);
    const [templates, setTemplates,] = createSignal<MailTemplateOption[]>([],);
    const [templateId, setTemplateId,] = createSignal(DEFAULT_TEMPLATE,);
    const [fromName, setFromName,] = createSignal('',);
    const [fromEmail, setFromEmail,] = createSignal('',);
    const [subject, setSubject,] = createSignal('',);
    const [message, setMessage,] = createSignal('',);
    const [view, setView,] = createSignal<'compose' | 'preview'>('compose',);
    const [preview, setPreview,] = createSignal<{ subject: string; html: string; messageShown: boolean; } | null>(null,);
    const [busy, setBusy,] = createSignal<'' | 'loading' | 'preview' | 'send'>('loading',);
    const [error, setError,] = createSignal('',);
    let messageEl: HTMLTextAreaElement | undefined;

    onMount(async () => {
        try {
            const [t, sender, opts,] = await Promise.all([
                cms.replies.target(props.source, props.record,),
                cms.replies.sender().catch(() => ({ fromName: '', fromEmail: '', })),
                templatesOn() ? cms.mailTemplates.options().catch(() => [] as MailTemplateOption[]) : Promise.resolve([] as MailTemplateOption[]),
            ],);
            setTarget(t,);
            setSubject(t.defaultSubject,);
            setMessage(t.defaultMessage,);
            setFromName(sender.fromName,);
            setFromEmail(sender.fromEmail,);
            setTemplates(opts,);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load this record.',);
        } finally {
            setBusy('',);
        }
    },);

    const body = () => ({
        ref: props.record,
        templateId: templateId() || null,
        subject: subject(),
        message: message(),
        fromName: fromName().trim() || undefined,
        fromEmail: fromEmail().trim() || undefined,
    });

    const showPreview = async () => {
        setError('',);
        setBusy('preview',);
        try {
            const res = await cms.replies.preview(props.source, body(),);
            setPreview({ subject: res.subject, html: res.html, messageShown: res.messageShown, },);
            setView('preview',);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Preview failed.',);
        } finally {
            setBusy('',);
        }
    };

    const send = async () => {
        setError('',);
        if (!subject().trim()) return setError('A subject is required.',);
        if (!message().trim()) return setError('A message is required.',);
        setBusy('send',);
        try {
            const res = await cms.replies.send(props.source, body(),);
            props.onSent?.(res.to,);
            props.onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'The reply could not be sent.',);
        } finally {
            setBusy('',);
        }
    };

    /** Insert `{{path}}` at the message cursor (or the end). */
    const insertVariable = (path: string,) => {
        const token = `{{${path}}}`;
        const el = messageEl;
        const text = message();
        const at = el && document.activeElement === el ? el.selectionStart : text.length;
        const next = text.slice(0, at,) + token + text.slice(el && document.activeElement === el ? el.selectionEnd : at,);
        setMessage(next,);
        queueMicrotask(() => {
            el?.focus();
            el?.setSelectionRange(at + token.length, at + token.length,);
        },);
    };

    /** The server's variable list for THIS record, grouped by object. */
    const variableGroups = () => {
        const groups = new Map<string, string[]>();
        for (const v of target()?.variables ?? []) {
            const key = v.split('.',)[0]!;
            groups.set(key, [...(groups.get(key,) ?? []), v,],);
        }
        return [...groups,].map(([key, paths,],) => ({ key, label: GROUP_LABELS[key] ?? key, paths, }));
    };

    const sending = () => busy() === 'send';
    const close = () => {
        if (!sending()) props.onClose();
    };

    return (
        <ModalShell open onClose={close} size="lg" class="reply-modal" ariaLabel="Reply by email" dismissOnBackdrop={!sending()}>
            <div class="reply-modal__header">
                <h2>{target()?.title ?? 'Reply'}</h2>
                <Show when={target()}>
                    <p class="reply-modal__to">
                        To <strong>{target()!.toName ? `${target()!.toName} <${target()!.to}>` : target()!.to}</strong>
                    </p>
                </Show>
            </div>

            <div class="reply-modal__body">
                <Show when={busy() !== 'loading'} fallback={<p class="form-help-muted">Loading…</p>}>
                    <Show
                        when={view() === 'compose'}
                        fallback={
                            <>
                                <Show when={preview() && !preview()!.messageShown}>
                                    <div class="alert alert--warning">
                                        This template never uses <code>{'{{reply.message}}'}</code>, so your message will not
                                        appear in the email. Add it to the template, or choose another.
                                    </div>
                                </Show>
                                <p class="reply-modal__preview-subject"><span>Subject:</span> {preview()?.subject}</p>
                                <iframe class="reply-modal__preview" title="Email preview" sandbox="" srcdoc={preview()?.html ?? ''} />
                            </>
                        }
                    >
                        <Show when={target()}>
                            <FormField
                                label="Email Template"
                                tooltip="The layout around your message. Templates come from Mailing Lists → Templates and can use {{reply.message}} and the variables below."
                            >
                                <Show
                                    when={templatesOn()}
                                    fallback={
                                        <div>
                                            <div class="reply-modal__template-static">Default Template</div>
                                            <p class="reply-modal__template-note">
                                                To use dynamic templates, enable the{' '}
                                                <A href="/admin/settings?tab=general#features">Mailing Lists</A> feature.
                                            </p>
                                        </div>
                                    }
                                >
                                    <select value={templateId()} onChange={(e,) => setTemplateId(e.currentTarget.value,)}>
                                        <option value={DEFAULT_TEMPLATE}>Default Template</option>
                                        <For each={templates()}>{(t,) => <option value={t.id}>{t.name}</option>}</For>
                                    </select>
                                </Show>
                            </FormField>

                            <div class="reply-modal__row">
                                <FormField label="Reply Name">
                                    <input type="text" value={fromName()} onInput={(e,) => setFromName(e.currentTarget.value,)} />
                                </FormField>
                                <FormField label="Reply Email" hint="Must be an address your mail provider may send from.">
                                    <input type="email" value={fromEmail()} onInput={(e,) => setFromEmail(e.currentTarget.value,)} />
                                </FormField>
                            </div>

                            <FormField label="Subject">
                                <input type="text" value={subject()} onInput={(e,) => setSubject(e.currentTarget.value,)} />
                            </FormField>

                            <FormField label="Message" hint="Plain text — blank lines start new paragraphs. Becomes {{reply.message}} in the template.">
                                <textarea
                                    ref={messageEl}
                                    rows={10}
                                    value={message()}
                                    onInput={(e,) => setMessage(e.currentTarget.value,)}
                                />
                            </FormField>

                            <details class="reply-modal__vars">
                                <summary>Template variables for this reply</summary>
                                <div class="reply-modal__vars-body">
                                    <p class="reply-modal__vars-help">
                                        Write <code>{'{{object.field}}'}</code> in the subject, the message or the email
                                        template — e.g. <code>{'{{reply.message}}'}</code> places your message (as
                                        paragraphs). Click a variable to insert it into the message. Templates can also
                                        use <code>{'{{if …}}'}</code> / <code>{'{{for …}}'}</code> and the value functions
                                        (<code>formatDate</code>, <code>formatCurrency</code>, <code>default</code>, …).
                                    </p>
                                    <For each={variableGroups()}>
                                        {(g,) => (
                                            <div class="reply-modal__var-group">
                                                <div class="reply-modal__var-group-title">
                                                    <code>{`{{${g.key}.*}}`}</code> {g.label}
                                                </div>
                                                <div class="reply-modal__var-list">
                                                    <For each={g.paths}>
                                                        {(v,) => (
                                                            <button type="button" class="reply-modal__var" title="Insert into the message" onClick={() => insertVariable(v,)}>
                                                                {`{{${v}}}`}
                                                            </button>
                                                        )}
                                                    </For>
                                                </div>
                                            </div>
                                        )}
                                    </For>
                                </div>
                            </details>
                        </Show>
                    </Show>
                </Show>

                <Show when={error()}>
                    <div class="alert alert--error reply-modal__error">{error()}</div>
                </Show>
            </div>

            <div class="reply-modal__footer">
                <Show when={view() === 'preview'}>
                    <button type="button" class="ui-button ui-button--secondary" onClick={() => setView('compose',)} disabled={sending()}>
                        ← Edit
                    </button>
                </Show>
                <span class="reply-modal__footer-spacer" />
                <button type="button" class="ui-button ui-button--secondary" onClick={close} disabled={sending()}>
                    Cancel
                </button>
                <Show when={view() === 'compose'}>
                    <button type="button" class="ui-button ui-button--secondary" onClick={showPreview} disabled={!target() || busy() !== ''}>
                        {busy() === 'preview' ? 'Rendering…' : 'Preview'}
                    </button>
                </Show>
                <button type="button" class="ui-button ui-button--primary" onClick={send} disabled={!target() || busy() !== ''}>
                    {sending() ? 'Sending…' : 'Send reply'}
                </button>
            </div>
        </ModalShell>
    );
}
