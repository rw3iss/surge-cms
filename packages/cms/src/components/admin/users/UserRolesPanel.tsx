/**
 * User detail → **Roles**: the MAIN role (set by the membership for members;
 * staff roles by an admin in Profile → Role) and the ADDITIONAL roles
 * (`users.extra_roles`, e.g. Ambassador) — switches that save at once and are
 * kept when the membership changes. Roles allowed to sign in without a
 * membership (Users → Settings) are marked.
 */
import { A, } from '@solidjs/router';
import type { RoleDef, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { createResource, createSignal, For, Show, type Component, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import Toggle from '../common/Toggle';
import { useToast, } from '../../common/toast';
import { assignableRoles, roleLabel, } from './assignableRoles';

export interface UserRolesPanelProps {
    userId: string;
    role: string;
    extraRoles: string[];
    roles: readonly RoleDef[] | undefined;
    onChanged: () => void;
}

const UserRolesPanel: Component<UserRolesPanelProps> = (props,) => {
    const toast = useToast();
    const [busy, setBusy,] = createSignal<string | null>(null,);
    const [settings,] = createResource(() => cms.settings.getUsersSettings().catch(() => null),);
    const signInRoles = () => (settings()?.requireSubscription ? settings()?.accessRoles ?? [] : []);
    const options = () => assignableRoles(props.roles,).filter((r,) => r.key !== props.role,);

    const toggle = async (key: string, on: boolean,) => {
        const next = on ? [...new Set([...props.extraRoles, key,],),] : props.extraRoles.filter((k,) => k !== key,);
        setBusy(key,);
        try {
            await cms.users.update(props.userId, { extraRoles: next, },);
            toast.success(`${roleLabel(props.roles, key,)} ${on ? 'added' : 'removed'}.`,);
            props.onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not update the roles.',);
        } finally {
            setBusy(null,);
        }
    };

    return (
        <div class="user-detail__panel user-roles">
            <h2 class="user-detail__panel-title">Roles</h2>
            <div class="user-detail__info-grid">
                <div class="user-detail__info-item">
                    <span class="user-detail__info-label">Main role</span>
                    <span class="user-detail__info-value">
                        <strong>{roleLabel(props.roles, props.role,)}</strong>
                        <span class="form-help-muted">
                            {isStaffRole(props.role,)
                                ? ' — a staff role, changed in Profile → Role.'
                                : ' — set by their membership (Free → Member, a paid level → its role). Profile → Role overrides it.'}
                        </span>
                    </span>
                </div>
            </div>

            <div class="user-roles__extra">
                <span class="user-detail__info-label">Additional roles</span>
                <Show
                    when={options().length}
                    fallback={<p class="form-help-muted">No member-level roles yet — add one in <A href="/admin/settings?tab=permissions">Settings → Permissions → Roles</A>.</p>}
                >
                    <ul class="user-roles__list">
                        <For each={options()}>
                            {(r,) => (
                                <li>
                                    <Toggle
                                        label={r.label}
                                        checked={props.extraRoles.includes(r.key,)}
                                        disabled={busy() !== null}
                                        onChange={(v,) => void toggle(r.key, v,)}
                                    />
                                    <Show when={signInRoles().includes(r.key,)}>
                                        <span class="badge badge--success" title="Users → Settings: can sign in without a membership">Signs in without a membership</span>
                                    </Show>
                                    <Show when={r.description}><span class="form-help-muted user-roles__desc">{r.description}</span></Show>
                                </li>
                            )}
                        </For>
                    </ul>
                </Show>
                <p class="form-help-muted">
                    Saved at once. Kept when their membership changes. What each role may do: <A href="/admin/settings?tab=permissions">Settings → Permissions</A>.
                </p>
            </div>
        </div>
    );
};

export default UserRolesPanel;
