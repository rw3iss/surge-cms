/**
 * Review one membership application (a level that requires approval): the
 * applicant, the level, their answers and the saved card. While pending, the
 * admin approves — which starts the membership and charges the saved card now
 * — or rejects (nothing is charged; the applicant is emailed).
 */
import { A, } from '@solidjs/router';
import { createResource, createSignal, For, Show, type Component, } from 'solid-js';
import type { MembershipApplication, } from '@sitesurge/types';
import { formatDateTime, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ConfirmModal from '../common/ConfirmModal';
import ModalShell from '../common/ModalShell';
import { FormField, } from '../forms';
import { approvalBadge, offerStatus, } from './applicationStatus';
import './ReviewApplicationModal.scss';

export interface ReviewApplicationModalProps {
    applicationId: string;
    onClose: () => void;
    /** Called after an approve / reject succeeded. */
    onDecided: () => void;
}

const cap = (s: string,) => s.charAt(0,).toUpperCase() + s.slice(1,);

const ReviewApplicationModal: Component<ReviewApplicationModalProps> = (props,) => {
    const toast = useToast();
    const [app, { refetch, },] = createResource(() => props.applicationId, (id,) => cms.membershipApplications.getById(id,),);
    const [note, setNote,] = createSignal('',);
    const [confirm, setConfirm,] = createSignal<'approve' | 'reject' | null>(null,);
    const [busy, setBusy,] = createSignal(false,);

    const decide = async () => {
        const action = confirm();
        if (!action) return;
        setBusy(true,);
        try {
            const body = note().trim() ? { note: note().trim(), } : {};
            if (action === 'approve') {
                const done = await cms.membershipApplications.approve(props.applicationId, body,);
                toast.success(done.tierHidePrice
                    ? 'Approved. The applicant was emailed a link to choose their billing and start the membership.'
                    : 'Approved — the membership is active and billing has started.',);
            } else {
                await cms.membershipApplications.reject(props.applicationId, body,);
                toast.success('Application rejected. The applicant was emailed; nothing was charged.',);
            }
            setConfirm(null,);
            props.onDecided();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : `Could not ${action} the application.`,);
            setConfirm(null,);
            // An approval that failed records its error on the application.
            void refetch();
        } finally {
            setBusy(false,);
        }
    };

    /** A "hide price" application approved without a card = an offer (no charge now). */
    const offer = () => Boolean(app()?.tierHidePrice && !app()?.card,);
    const card = (a: MembershipApplication,) => a.card ? `${cap(a.card.brand,)} •••• ${a.card.last4}` : 'No card saved';

    return (
        <ModalShell open onClose={() => !busy() && props.onClose()} size="md" showClose ariaLabel="Review application">
            <div class="review-application">
                <h2>Membership application</h2>
                <Show when={app()} fallback={<p class="form-help-muted">{app.error ? 'Could not load the application.' : 'Loading…'}</p>}>
                    {(a,) => (
                        <>
                            <dl class="review-application__meta">
                                <div>
                                    <dt>Applicant</dt>
                                    <dd>
                                        <Show
                                            when={a().userId}
                                            fallback={<span>No account yet <div class="form-help-muted">{a().contactEmail ?? 'No email given'} — applied before signing up</div></span>}
                                        >
                                            <A href={`/admin/users/${a().userId}`}>{a().user?.displayName || a().user?.email || 'Unknown user'}</A>
                                            <Show when={a().user?.email}><div class="form-help-muted">{a().user!.email}</div></Show>
                                        </Show>
                                    </dd>
                                </div>
                                <div><dt>Membership level</dt><dd><strong>{a().tierName}</strong></dd></div>
                                <div><dt>Submitted</dt><dd>{formatDateTime(a().createdAt,)}</dd></div>
                                <div>
                                    <dt>Status</dt>
                                    <dd>
                                        <Show when={approvalBadge(a().status,)}>{(b,) => <span class={b().cls}>{b().label}</span>}</Show>
                                        <Show when={offerStatus(a(),)}>{(s,) => <div class="form-help-muted">{s()}</div>}</Show>
                                    </dd>
                                </div>
                                <div>
                                    <dt>Saved card</dt>
                                    <dd>
                                        <Show when={!a().tierHidePrice || a().card} fallback="Not needed — price hidden until approved">
                                            {card(a(),)}<div class="form-help-muted">Charged only on approval.</div>
                                        </Show>
                                    </dd>
                                </div>
                                <div>
                                    <dt>Form</dt>
                                    <dd>
                                        <Show when={a().formId} fallback="Built-in application form">
                                            <A href={`/admin/forms/${a().formId}/submissions`}>{a().formTitle || 'Application form'}</A>
                                        </Show>
                                    </dd>
                                </div>
                            </dl>

                            <Show when={a().error}>
                                <p class="review-application__error">Last approval failed: {a().error}</p>
                            </Show>

                            <h3 class="review-application__heading">Answers</h3>
                            <dl class="review-application__answers">
                                <For each={a().answers} fallback={<p class="form-help-muted">No answers recorded.</p>}>
                                    {(ans,) => (
                                        <div>
                                            <dt>{ans.label}</dt>
                                            <dd>{ans.value || <span class="form-help-muted">—</span>}</dd>
                                        </div>
                                    )}
                                </For>
                            </dl>

                            <Show when={a().status !== 'pending' && (a().decidedAt || a().note)}>
                                <p class="form-help-muted review-application__decided">
                                    {cap(a().status,)}
                                    <Show when={a().decidedBy}> by {a().decidedBy}</Show>
                                    <Show when={a().decidedAt}> on {formatDateTime(a().decidedAt!,)}</Show>
                                    <Show when={a().note}>. Note: {a().note}</Show>
                                </p>
                            </Show>

                            <Show when={a().status === 'pending'}>
                                <FormField label="Note (optional)" hint="Kept with the decision. A rejection note is included in the email to the applicant.">
                                    <textarea rows={2} value={note()} onBlur={(e,) => setNote(e.currentTarget.value,)} />
                                </FormField>
                                <div class="review-application__footer">
                                    <button type="button" class="ui-button ui-button--secondary" onClick={props.onClose} disabled={busy()}>Close</button>
                                    <button type="button" class="ui-button ui-button--danger" onClick={() => setConfirm('reject',)} disabled={busy()}>Reject</button>
                                    <button
                                        type="button"
                                        class="ui-button ui-button--primary"
                                        onClick={() => setConfirm('approve',)}
                                        disabled={busy() || (!offer() && (!a().userId || !a().card))}
                                        title={offer() ? undefined : !a().userId ? 'The applicant has not created their account yet' : !a().card ? 'The applicant has not saved a card yet' : undefined}
                                    >
                                        {offer() ? 'Approve' : 'Approve & start billing'}
                                    </button>
                                </div>
                            </Show>

                            <ConfirmModal
                                open={confirm() === 'approve'}
                                title={`Approve ${a().user?.displayName || 'this applicant'} for ${a().tierName}?`}
                                message={offer()
                                    ? 'Nothing is charged now. They get an email to choose their billing and start the membership.'
                                    : `This charges the saved card (${card(a(),)}) now and starts the ${a().tierName} membership.`}
                                confirmLabel={offer() ? 'Approve' : 'Approve & charge'}
                                busyLabel={offer() ? 'Approving…' : 'Charging…'}
                                loading={busy()}
                                onConfirm={() => void decide()}
                                onCancel={() => setConfirm(null,)}
                            />
                            <ConfirmModal
                                open={confirm() === 'reject'}
                                title="Reject this application?"
                                message="The applicant is emailed and their card is not charged."
                                confirmLabel="Reject"
                                busyLabel="Rejecting…"
                                loading={busy()}
                                danger
                                onConfirm={() => void decide()}
                                onCancel={() => setConfirm(null,)}
                            />
                        </>
                    )}
                </Show>
            </div>
        </ModalShell>
    );
};

export default ReviewApplicationModal;
