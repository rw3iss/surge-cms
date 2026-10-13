/**
 * Invite someone to create an account with roles (e.g. Ambassador). The server
 * emails a 3-day link — or, when the address already has an account, adds the
 * roles to it straight away.
 */
import type { RoleDef, } from '@sitesurge/types';
import { Component, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ModalShell from '../common/ModalShell';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';
import { assignableRoles, } from './assignableRoles';

export interface InviteUserModalProps {
    roles: RoleDef[];
    onClose: () => void;
    onDone: () => void;
}

const InviteUserModal: Component<InviteUserModalProps> = (props,) => {
    const toast = useToast();
    const options = () => assignableRoles(props.roles,);
    const [email, setEmail,] = createSignal('',);
    const [name, setName,] = createSignal('',);
    const [picked, setPicked,] = createSignal<string[]>(options().some((r,) => r.key === 'ambassador',) ? ['ambassador',] : [],);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const toggle = (key: string, on: boolean,) =>
        setPicked(on ? [...new Set([...picked(), key,],),] : picked().filter((k,) => k !== key,),);

    const submit = async (e: Event,) => {
        e.preventDefault();
        setError('',);
        const addr = email().trim();
        if (!addr) return setError('Enter an email address.',);
        if (!picked().length) return setError('Choose at least one role.',);
        setBusy(true,);
        try {
            const res = await cms.users.invite({ email: addr, name: name().trim() || undefined, roles: picked(), },);
            toast.success(res.result === 'roles_added'
                ? `${addr} already has an account — the roles were added.`
                : `Invite sent to ${addr}.`,);
            props.onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'The invite could not be sent.',);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <ModalShell open onClose={() => !busy() && props.onClose()} size="md" showClose ariaLabel="Invite a user" dismissOnBackdrop={false}>
            <form class="invite-user-modal" onSubmit={submit}>
                <header class="admin-section__header">
                    <h2>Invite a user</h2>
                    <p class="form-help-muted">
                        They get an email with a link to create their account (valid 3 days). If the address already has an
                        account, the roles are added to it now.
                    </p>
                </header>
                <div class="admin-section__body">
                    <Show when={error()}><div class="alert alert--error">{error()}</div></Show>
                    <div class="admin-form-row">
                        <FormField label="Email">
                            <input type="email" required value={email()} onBlur={(e,) => setEmail(e.currentTarget.value,)} onInput={(e,) => setEmail(e.currentTarget.value,)} />
                        </FormField>
                        <FormField label="Name (optional)" hint="Pre-fills their account form.">
                            <input type="text" value={name()} onBlur={(e,) => setName(e.currentTarget.value,)} />
                        </FormField>
                    </div>
                    <FormField label="Roles" hint="Additional roles the account gets. They stay when the person later buys a membership.">
                        <div class="invite-user-modal__roles">
                            <For each={options()} fallback={<p class="form-help-muted">No member-level roles exist yet (Settings → Permissions → Roles).</p>}>
                                {(r,) => <Toggle label={r.label} checked={picked().includes(r.key,)} onChange={(v,) => toggle(r.key, v,)} />}
                            </For>
                        </div>
                    </FormField>
                </div>
                <div class="invite-user-modal__footer">
                    <button type="button" class="ui-button ui-button--secondary" onClick={() => props.onClose()} disabled={busy()}>Cancel</button>
                    <button type="submit" class="ui-button ui-button--primary" disabled={busy()}>{busy() ? 'Sending…' : 'Send invite'}</button>
                </div>
            </form>
        </ModalShell>
    );
};

export default InviteUserModal;
