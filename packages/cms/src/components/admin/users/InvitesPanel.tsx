/**
 * The Users page's Invites list: every account invite with its status, roles
 * and dates, and Resend / Revoke for the ones not yet used.
 */
import type { RoleDef, UserInvite, } from '@sitesurge/types';
import { formatDateShort, } from '@sitesurge/types';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ConfirmModal from '../common/ConfirmModal';
import { roleLabel, } from './assignableRoles';
import './invites.scss';

const STATUS_CLASS: Record<UserInvite['status'], string> = {
    pending: 'badge--warning',
    accepted: 'badge--success',
    expired: 'badge--muted',
    revoked: 'badge--error',
};

const InvitesPanel: Component<{ roles: RoleDef[]; refreshKey: number; }> = (props,) => {
    const toast = useToast();
    const [invites, { refetch, },] = createResource(() => props.refreshKey, () => cms.users.invites().catch(() => [] as UserInvite[],),);
    const [busyId, setBusyId,] = createSignal<string | null>(null,);
    const [revoking, setRevoking,] = createSignal<UserInvite | null>(null,);

    const resend = async (i: UserInvite,) => {
        setBusyId(i.id,);
        try {
            await cms.users.resendInvite(i.id,);
            toast.success(`A new link was sent to ${i.email}.`,);
            await refetch();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not resend the invite.',);
        } finally {
            setBusyId(null,);
        }
    };

    const revoke = async () => {
        const i = revoking();
        if (!i) return;
        setBusyId(i.id,);
        try {
            await cms.users.revokeInvite(i.id,);
            toast.success(`Invite to ${i.email} revoked.`,);
            setRevoking(null,);
            await refetch();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not revoke the invite.',);
        } finally {
            setBusyId(null,);
        }
    };

    return (
        <section class="admin-section users-invites">
            <header class="admin-section__header">
                <h2>Invites</h2>
                <p class="form-help-muted">Links expire after 3 days. Resend sends a new link; the old one stops working.</p>
            </header>
            <Show when={!invites.loading || invites()} fallback={<p class="form-help-muted">Loading…</p>}>
                <Show when={(invites() ?? []).length} fallback={<p class="form-help-muted">No invites yet.</p>}>
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr><th>Email</th><th>Roles</th><th>Status</th><th>Expires / accepted</th><th>Invited by</th><th /></tr>
                            </thead>
                            <tbody>
                                <For each={invites()}>
                                    {(i,) => (
                                        <tr>
                                            <td>{i.email}<Show when={i.name}><div class="form-help-muted">{i.name}</div></Show></td>
                                            <td>{i.roles.map((r,) => roleLabel(props.roles, r,),).join(', ',)}</td>
                                            <td><span class={`badge ${STATUS_CLASS[i.status]}`}>{i.status}</span></td>
                                            <td>{i.acceptedAt ? `Accepted ${formatDateShort(i.acceptedAt,)}` : formatDateShort(i.expiresAt,)}</td>
                                            <td>{i.invitedBy ?? '—'}</td>
                                            <td class="users-invites__actions">
                                                <Show when={i.status === 'pending' || i.status === 'expired' || i.status === 'revoked'}>
                                                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" disabled={busyId() === i.id} onClick={() => void resend(i,)}>
                                                        Resend
                                                    </button>
                                                </Show>
                                                <Show when={i.status === 'pending'}>
                                                    <button type="button" class="ui-button ui-button--danger ui-button--sm" disabled={busyId() === i.id} onClick={() => setRevoking(i,)}>
                                                        Revoke
                                                    </button>
                                                </Show>
                                            </td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                </Show>
            </Show>
            <ConfirmModal
                open={!!revoking()}
                title={`Revoke the invite to ${revoking()?.email ?? ''}?`}
                message="The link stops working. You can send a new invite later."
                confirmLabel="Revoke"
                busyLabel="Revoking…"
                loading={!!revoking() && busyId() === revoking()?.id}
                danger
                onConfirm={() => void revoke()}
                onCancel={() => setRevoking(null,)}
            />
        </section>
    );
};

export default InvitesPanel;
