/**
 * Reply to a donor by email, from the campaign's donations table.
 *
 * The recipient is fixed to the donation's own address (the server ignores
 * anything else). From name / email start at the site's default sender
 * (Settings → General → E-mail and Contact). **Preview** renders through the
 * same backend function that sends, so what you see is exactly what goes out.
 * On failure the modal stays open with the server's error.
 */
import { createSignal, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import ModalShell from '../common/ModalShell';
import { FormField, } from '../forms';
import './DonationReplyModal.scss';

export interface DonationReplyModalProps {
    campaignId: string;
    campaignTitle?: string;
    donation: { id: string; donorName?: string | null; donorEmail: string; };
    onClose: () => void;
    onSent: (to: string,) => void;
}

export default function DonationReplyModal(props: DonationReplyModalProps,) {
    const [view, setView,] = createSignal<'compose' | 'preview'>('compose',);
    const [fromName, setFromName,] = createSignal('',);
    const [fromEmail, setFromEmail,] = createSignal('',);
    const [subject, setSubject,] = createSignal(
        props.campaignTitle ? `Thank you for supporting ${props.campaignTitle}` : 'Thank you for your donation',
    );
    const [message, setMessage,] = createSignal(
        props.donation.donorName && props.donation.donorName !== 'Anonymous' ? `Hi ${props.donation.donorName},\n\n` : '',
    );
    const [previewHtml, setPreviewHtml,] = createSignal('',);
    const [previewing, setPreviewing,] = createSignal(false,);
    const [sending, setSending,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    onMount(async () => {
        try {
            const s = await cms.campaigns.replySender();
            // Only fill what the user hasn't typed yet.
            if (!fromName()) setFromName(s.fromName,);
            if (!fromEmail()) setFromEmail(s.fromEmail,);
        } catch { /* the server falls back to the default sender anyway */ }
    },);

    const showPreview = async () => {
        setError('',);
        setView('preview',);
        setPreviewing(true,);
        try {
            const res = await cms.campaigns.previewDonationReply(props.campaignId, props.donation.id, { message: message(), },);
            setPreviewHtml(res.html,);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Preview failed.',);
        } finally {
            setPreviewing(false,);
        }
    };

    const send = async () => {
        setError('',);
        if (!subject().trim()) return setError('A subject is required.',);
        if (!message().trim()) return setError('A message is required.',);
        setSending(true,);
        try {
            const res = await cms.campaigns.replyToDonation(props.campaignId, props.donation.id, {
                subject: subject().trim(),
                message: message(),
                fromName: fromName().trim() || undefined,
                fromEmail: fromEmail().trim() || undefined,
            },);
            props.onSent(res.to,);
            props.onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'The reply could not be sent.',);
        } finally {
            setSending(false,);
        }
    };

    const close = () => {
        if (!sending()) props.onClose();
    };

    return (
        <ModalShell open onClose={close} size="lg" class="donation-reply" ariaLabel="Reply to donor" dismissOnBackdrop={!sending()}>
            <div class="donation-reply__header">
                <h2>Reply to donor</h2>
                <div class="donation-reply__tabs" role="tablist">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={view() === 'compose'}
                        classList={{ 'is-active': view() === 'compose', }}
                        onClick={() => setView('compose',)}
                    >
                        Compose
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={view() === 'preview'}
                        classList={{ 'is-active': view() === 'preview', }}
                        onClick={showPreview}
                    >
                        Preview
                    </button>
                </div>
            </div>

            <div class="donation-reply__body">
                <Show
                    when={view() === 'compose'}
                    fallback={
                        <Show when={!previewing()} fallback={<p class="form-help-muted">Rendering preview…</p>}>
                            <iframe class="donation-reply__preview" title="Email preview" sandbox="" srcdoc={previewHtml()} />
                        </Show>
                    }
                >
                    <FormField label="To" hint="The donation's email address.">
                        <input type="email" value={props.donation.donorEmail} readOnly />
                    </FormField>
                    <div class="donation-reply__row">
                        <FormField label="From name">
                            <input type="text" value={fromName()} onInput={(e,) => setFromName(e.currentTarget.value,)} />
                        </FormField>
                        <FormField label="From email" hint="Must be an address your mail provider may send from.">
                            <input type="email" value={fromEmail()} onInput={(e,) => setFromEmail(e.currentTarget.value,)} />
                        </FormField>
                    </div>
                    <FormField label="Subject">
                        <input type="text" value={subject()} onInput={(e,) => setSubject(e.currentTarget.value,)} />
                    </FormField>
                    <FormField label="Message" hint="Plain text. Blank lines start new paragraphs.">
                        <textarea rows={10} value={message()} onInput={(e,) => setMessage(e.currentTarget.value,)} />
                    </FormField>
                </Show>

                <Show when={error()}>
                    <div class="alert alert--error donation-reply__error">{error()}</div>
                </Show>
            </div>

            <div class="donation-reply__footer">
                <button type="button" class="ui-button ui-button--secondary" onClick={close} disabled={sending()}>
                    Cancel
                </button>
                <Show when={view() === 'compose'}>
                    <button type="button" class="ui-button ui-button--secondary" onClick={showPreview} disabled={sending()}>
                        Preview
                    </button>
                </Show>
                <button type="button" class="ui-button ui-button--primary" onClick={send} disabled={sending()}>
                    {sending() ? 'Sending…' : 'Send reply'}
                </button>
            </div>
        </ModalShell>
    );
}
