/**
 * One user's permissions.
 *
 * Shows the RESOLVED answer for every permission — what the user can actually
 * do right now — rather than only their explicit grants. A list of exceptions
 * alone doesn't answer "can Dana publish posts?", which is the question an
 * admin opens this for.
 *
 * Rows the user gets from their role are marked as such, so it's clear that
 * removing an exception returns them to the role's behaviour rather than
 * denying them.
 */
import { Component, createMemo, createResource, createSignal, For, Show, } from 'solid-js';
import type { PermissionGrant, PermissionWithGrants, } from '@sitesurge/types';
import ModalShell from '../common/ModalShell';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import './UserPermissionsModal.scss';

export interface UserPermissionsModalProps {
    open: boolean;
    user: { id: string; email?: string; displayName?: string | null; role?: string; } | null;
    onClose: () => void;
}

const UserPermissionsModal: Component<UserPermissionsModalProps> = (props,) => {
    const toast = useToast();
    const [search, setSearch,] = createSignal('',);
    const [busy, setBusy,] = createSignal<string | null>(null,);

    const [data, { refetch, },] = createResource(
        () => (props.open && props.user ? props.user.id : ''),
        async (userId,) => {
            if (!userId) return null;
            try {
                const [catalog, forUser,] = await Promise.all([
                    cms.permissions.list(),
                    cms.permissions.forUser(userId,),
                ],);
                return { catalog, ...forUser, };
            } catch {
                return null;
            }
        },
    );

    const rows = createMemo(() => {
        const d = data();
        if (!d) return [];
        const q = search().toLowerCase().trim();
        const grantByKey = new Map<string, PermissionGrant>(
            d.grants.map((g,) => [g.permissionKey, g,]),
        );
        return (d.catalog as PermissionWithGrants[])
            .filter((p,) => !q || p.key.toLowerCase().includes(q,) || p.label.toLowerCase().includes(q,))
            .map((p,) => ({
                permission: p,
                allowed: Boolean(d.resolved[p.key],),
                grant: grantByKey.get(p.key,),
            }),);
    },);

    /** Set an explicit allow/deny for this user. */
    const setGrant = async (key: string, granted: boolean,) => {
        if (!props.user) return;
        setBusy(key,);
        try {
            await cms.permissions.setGrant(key, {
                subjectType: 'user', subjectId: props.user.id, granted,
            },);
            await refetch();
            toast.success(granted ? 'Permission granted.' : 'Permission denied for this user.',);
        } catch (e: any) {
            toast.error(e?.message || 'Could not save the grant.',);
        } finally {
            setBusy(null,);
        }
    };

    /** Drop the exception so the user follows their role again. */
    const clearGrant = async (key: string,) => {
        if (!props.user) return;
        setBusy(key,);
        try {
            await cms.permissions.removeGrant(key, 'user', props.user.id,);
            await refetch();
            toast.success('Back to the default for this user.',);
        } catch (e: any) {
            toast.error(e?.message || 'Could not remove the grant.',);
        } finally {
            setBusy(null,);
        }
    };

    const who = () => props.user?.displayName || props.user?.email || 'this user';

    return (
        <ModalShell
            open={props.open}
            size="lg"
            showClose
            dismissOnBackdrop={false}
            onClose={props.onClose}
            ariaLabel="User permissions"
            class="user-permissions"
        >
            <header class="user-permissions__head">
                <h2>Permissions — {who()}</h2>
                <p class="user-permissions__meta">
                    Role: <strong>{props.user?.role ?? 'unknown'}</strong>
                    <Show when={props.user?.role === 'sysadmin'}>
                        {' '}· a sysadmin is always allowed, so grants here have no effect.
                    </Show>
                </p>
            </header>

            <input
                type="search"
                class="user-permissions__search"
                placeholder="Search permissions…"
                value={search()}
                onInput={(e,) => setSearch(e.currentTarget.value,)}
            />

            <div class="user-permissions__body">
                <Show
                    when={!data.loading}
                    fallback={<p class="form-help-muted">Loading…</p>}
                >
                    <Show
                        when={rows().length > 0}
                        fallback={<p class="form-help-muted">No permissions match.</p>}
                    >
                        <For each={rows()}>
                            {(row,) => (
                                <div class="user-permissions__row">
                                    <div class="user-permissions__info">
                                        <div class="user-permissions__label">{row.permission.label}</div>
                                        <code class="user-permissions__key">{row.permission.key}</code>
                                    </div>

                                    <div class="user-permissions__state">
                                        <span
                                            class={`user-permissions__badge user-permissions__badge--${
                                                row.allowed ? 'yes' : 'no'
                                            }`}
                                        >
                                            {row.allowed ? 'Allowed' : 'Denied'}
                                        </span>
                                        {/* Naming the SOURCE matters: "allowed via role" and
                                            "allowed for this user specifically" look identical
                                            otherwise, and they behave differently when the
                                            user's role changes. */}
                                        <span class="user-permissions__source">
                                            {row.grant
                                                ? (row.grant.granted ? 'set for this user' : 'denied for this user')
                                                : 'from role / default'}
                                        </span>
                                    </div>

                                    <div class="user-permissions__actions">
                                        <button
                                            type="button"
                                            class="ui-button ui-button--sm ui-button--secondary"
                                            disabled={busy() === row.permission.key || row.grant?.granted === true}
                                            onClick={() => setGrant(row.permission.key, true,)}
                                        >Allow</button>
                                        <button
                                            type="button"
                                            class="ui-button ui-button--sm ui-button--danger"
                                            disabled={busy() === row.permission.key || row.grant?.granted === false}
                                            onClick={() => setGrant(row.permission.key, false,)}
                                        >Deny</button>
                                        <Show when={row.grant}>
                                            <button
                                                type="button"
                                                class="ui-button ui-button--sm ui-button--ghost"
                                                disabled={busy() === row.permission.key}
                                                onClick={() => clearGrant(row.permission.key,)}
                                            >Reset</button>
                                        </Show>
                                    </div>
                                </div>
                            )}
                        </For>
                    </Show>
                </Show>
            </div>

            <footer class="user-permissions__foot">
                <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={props.onClose}>
                    Close
                </button>
            </footer>
        </ModalShell>
    );
};

export default UserPermissionsModal;
