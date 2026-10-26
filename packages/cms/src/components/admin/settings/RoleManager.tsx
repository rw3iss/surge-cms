/**
 * Settings → Permissions → Roles. Built-in roles are fixed; custom roles
 * inherit everything their base role (member-level only) can do, then get
 * their own grants in the permission list below. Subscriptions give roles
 * (Users → Settings → Subscriptions).
 */
import { createResource, createSignal, For, Show, type Component, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import type { RoleDef, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ConfirmModal from '../common/ConfirmModal';
import { FormField, FormRowAction, } from '../forms';
import '../subscriptions/Subscriptions.scss';

/** "Page after sign-in" as typed → stored: no leading slash. */
const cleanRoute = (v: string,) => v.trim().replace(/^\/+/, '',);
/** How a role's landing page reads in the table. */
const routeLabel = (r: RoleDef,) => (r.loginRoute == null ? 'inherits' : r.loginRoute === '' ? 'Homepage' : `/${r.loginRoute}`);

const RoleManager: Component<{ onChanged?: () => void; }> = (props,) => {
    const toast = useToast();
    const [roles, { refetch, },] = createResource(() => cms.roles.list().catch(() => [] as RoleDef[]),);
    const [draft, setDraft,] = createStore({ key: '', label: '', description: '', baseRole: 'member', loginRoute: '', loginPriority: 0, },);
    /** Editing a built-in role: only its page after sign-in may change. */
    const [editingSystem, setEditingSystem,] = createSignal(false,);
    const [editingKey, setEditingKey,] = createSignal<string | null>(null,);
    const [deleting, setDeleting,] = createSignal<RoleDef | null>(null,);
    const [busy, setBusy,] = createSignal(false,);

    const baseOptions = () => (roles() ?? []).filter((r,) => !isStaffRole(r.key,) && r.key !== editingKey(),);
    const changed = async () => {
        await refetch();
        props.onChanged?.();
    };

    const reset = () => {
        setEditingKey(null,);
        setEditingSystem(false,);
        setDraft({ key: '', label: '', description: '', baseRole: 'member', loginRoute: '', loginPriority: 0, },);
    };

    const submit = async () => {
        setBusy(true,);
        try {
            const login = { loginRoute: cleanRoute(draft.loginRoute,), loginPriority: Number(draft.loginPriority,) || 0, };
            if (editingKey() && editingSystem()) {
                await cms.roles.update(editingKey()!, login,);
                toast.success('Role updated.',);
            } else if (editingKey()) {
                await cms.roles.update(editingKey()!, { label: draft.label, description: draft.description, baseRole: draft.baseRole || null, ...login, },);
                toast.success('Role updated.',);
            } else {
                await cms.roles.create({ key: draft.key, label: draft.label, description: draft.description || undefined, baseRole: draft.baseRole || null, ...login, },);
                toast.success('Role created.',);
            }
            reset();
            await changed();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not save the role.',);
        } finally {
            setBusy(false,);
        }
    };

    const doDelete = async () => {
        const r = deleting();
        if (!r) return;
        try {
            await cms.roles.remove(r.key,);
            toast.success('Role deleted.',);
            await changed();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not delete the role.',);
        } finally {
            setDeleting(null,);
        }
    };

    return (
        <section class="admin-section role-manager">
            <header class="admin-section__header"><h2>Roles</h2></header>
            <p class="form-help-muted">
                Built-in roles are fixed. A custom role has everything its <strong>base role</strong> has, plus whatever you grant it below.
                Custom roles build on member-level roles only — they never get staff (admin/editor) access.
            </p>
            <div class="admin-table-container">
                <table class="admin-table">
                    <thead><tr><th>Role</th><th>Based on</th><th>Users</th><th>After sign-in</th><th>Description</th><th /></tr></thead>
                    <tbody>
                        <For each={roles() ?? []}>
                            {(r,) => (
                                <tr>
                                    <td><strong>{r.label}</strong> <code>{r.key}</code>{r.isSystem ? ' · built-in' : ''}</td>
                                    <td>{r.baseRole ?? '—'}</td>
                                    <td>{r.userCount ?? 0}</td>
                                    <td><code>{routeLabel(r,)}</code>{r.loginPriority ? <span class="form-help-muted"> · priority {r.loginPriority}</span> : ''}</td>
                                    <td class="form-help-muted">{r.description}</td>
                                    <td class="role-manager__actions">
                                        <button
                                            type="button"
                                            class="ui-button ui-button--secondary ui-button--sm"
                                            onClick={() => {
                                                setEditingKey(r.key,);
                                                setEditingSystem(r.isSystem,);
                                                setDraft({
                                                    key: r.key, label: r.label, description: r.description ?? '', baseRole: r.baseRole ?? '',
                                                    loginRoute: r.loginRoute ?? '', loginPriority: r.loginPriority ?? 0,
                                                },);
                                            }}
                                        >
                                            Edit
                                        </button>
                                        <Show when={!r.isSystem}>
                                            {' '}<button type="button" class="ui-button ui-button--danger ui-button--sm" onClick={() => setDeleting(r,)}>Delete</button>
                                        </Show>
                                    </td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
            </div>

            <div class="role-manager__form">
                <FormField label="Key" hint={editingKey() ? 'Fixed once created.' : 'e.g. premium_member'}>
                    <input type="text" value={draft.key} disabled={Boolean(editingKey(),)} onBlur={(e,) => setDraft('key', e.currentTarget.value.trim().toLowerCase(),)} />
                </FormField>
                <FormField label="Label">
                    <input type="text" value={draft.label} disabled={editingSystem()} onBlur={(e,) => setDraft('label', e.currentTarget.value,)} />
                </FormField>
                <FormField label="Based on">
                    {/* `selected` per option, not just the select's value: clicking Edit
                        re-renders the options (the edited role drops out) AFTER the value
                        was set, and the browser then fell back to the first option. */}
                    <select value={draft.baseRole ?? ''} disabled={editingSystem()} onChange={(e,) => setDraft('baseRole', e.currentTarget.value,)}>
                        <option value="" selected={!draft.baseRole}>— none —</option>
                        <For each={baseOptions()}>{(r,) => <option value={r.key} selected={r.key === draft.baseRole}>{r.label}</option>}</For>
                    </select>
                </FormField>
                <FormField label="Description">
                    <input type="text" value={draft.description} disabled={editingSystem()} onBlur={(e,) => setDraft('description', e.currentTarget.value,)} />
                </FormField>
                <FormField
                    label="Page after sign-in"
                    tooltip="Where users with this role land after signing in. Among a user's roles (main and additional), the one with the highest priority decides."
                    hint="A site path without the leading slash — e.g. admin, profile?tab=membership. Empty = the homepage."
                >
                    <input
                        type="text"
                        value={draft.loginRoute}
                        placeholder="(homepage)"
                        onBlur={(e,) => { const v = cleanRoute(e.currentTarget.value,); e.currentTarget.value = v; setDraft('loginRoute', v,); }}
                    />
                </FormField>
                <FormField label="Priority" hint="Higher wins.">
                    <input type="number" step="1" value={draft.loginPriority} onBlur={(e,) => setDraft('loginPriority', Number(e.currentTarget.value,) || 0,)} />
                </FormField>
                <FormRowAction>
                    <button type="button" class="ui-button ui-button--primary ui-button--sm" onClick={submit} disabled={busy()}>
                        {editingKey() ? 'Save role' : '+ Add role'}
                    </button>
                    <Show when={editingKey()}>
                        <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={reset}>Cancel</button>
                    </Show>
                </FormRowAction>
            </div>

            <ConfirmModal
                open={deleting() !== null}
                title="Delete role"
                message={`Delete the "${deleting()?.label ?? ''}" role? Refused while users have it or a membership level gives it.`}
                confirmLabel="Delete"
                danger
                onConfirm={doDelete}
                onCancel={() => setDeleting(null,)}
            />
        </section>
    );
};

export default RoleManager;
