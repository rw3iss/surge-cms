/**
 * "View Sent Template" on a mailing-list job: the email exactly as that send
 * rendered it (the job's stored HTML — not re-rendered from today's template),
 * with `{{ }}` resolved for YOU, the signed-in admin, plus everything the job
 * carried (`{{products}}`, …). Same endpoint as the public `/mail/:jobId` view.
 */
import { createResource, Show, type Component, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import EmailFrame from '../../mail/EmailFrame';
import ModalShell from '../common/ModalShell';

const SentMailModal: Component<{ jobId: string; onClose: () => void; }> = (props,) => {
    const [view,] = createResource(() => props.jobId, (id,) => cms.mailArchive.view(id,),);
    return (
        <ModalShell open onClose={props.onClose} size="lg" showClose ariaLabel="Sent email">
            <div style={{ padding: '1rem 1.25rem', }}>
                <h2 style={{ margin: '0 0 0.25rem', 'font-size': '1.1rem', }}>Sent email</h2>
                <Show when={view()}>
                    <p class="form-help-muted" style={{ margin: '0 0 0.75rem', }}>
                        Subject: <strong>{view()!.subject}</strong> · rendered for you (variables about the reader use your account).
                    </p>
                </Show>
                <Show when={!view.loading} fallback={<p class="form-help-muted">Rendering…</p>}>
                    <Show when={view()} fallback={<div class="alert alert--error">Could not render this email.</div>}>
                        <EmailFrame html={view()!.html} height="65vh" title="Sent email" />
                    </Show>
                </Show>
            </div>
        </ModalShell>
    );
};

export default SentMailModal;
