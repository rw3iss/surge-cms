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
import { FormField, } from '../forms';
import '../subscriptions/Subscriptions.scss';

const RoleManager: Component<{ onChanged?: () => void; }> = (props,) => {
    const toast = useToast();
    const [roles, { refetch, },] = createResource(() => cms.roles.list().catch(() => [] as RoleDef[]),);
    const [draft, setDraft,] = createStore({ key: '', label: '', description: '', baseRole: 'member', },);
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
        setDraft({ key: '', label: '', description: '', baseRole: 'member', },);
    };

    const submit = async () => {
        setBusy(true,);
        try {
            if (editingKey()) {
                await cms.roles.update(editingKey()!, { label: draft.label, description: draft.description, baseRole: draft.baseRole || null, },);
                toast.success('Role updated.',);
            } else {
                await cms.roles.create({ key: draft.key, label: draft.label, description: draft.description || undefined, baseRole: draft.baseRole || null, },);
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
                    <thead><tr><th>Role</th><th>Based on</th><th>Users</th><th>Description</th><th /></tr></thead>
                    <tbody>
                        <For each={roles() ?? []}>
                            {(r,) => (
                                <tr>
                                    <td><strong>{r.label}</strong> <code>{r.key}</code>{r.isSystem ? ' · built-in' : ''}</td>
                                    <td>{r.baseRole ?? '—'}</td>
                                    <td>{r.userCount ?? 0}</td>
                                    <td class="form-help-muted">{r.description}</td>
                                    <td style={{ 'text-align': 'right', 'white-space': 'nowrap', }}>
                                        <Show when={!r.isSystem}>
                                            <button
                                                type="button"
                                                class="ui-button ui-button--secondary ui-button--sm"
                                                onClick={() => {
                                                    setEditingKey(r.key,);
                                                    setDraft({ key: r.key, label: r.label, description: r.description ?? '', baseRole: r.baseRole ?? '', },);
                                                }}
                                            >
                                                Edit
                                            </button>{' '}
                                            <button type="button" class="ui-button ui-button--danger ui-button--sm" onClick={() => setDeleting(r,)}>Delete</button>
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
                    <input type="text" value={draft.label} onBlur={(e,) => setDraft('label', e.currentTarget.value,)} />
                </FormField>
                <FormField label="Based on">
                    <select value={draft.baseRole} onChange={(e,) => setDraft('baseRole', e.currentTarget.value,)}>
                        <For each={baseOptions()}>{(r,) => <option value={r.key}>{r.label}</option>}</For>
                    </select>
                </FormField>
                <FormField label="Description">
                    <input type="text" value={draft.description} onBlur={(e,) => setDraft('description', e.currentTarget.value,)} />
                </FormField>
                <div class="u-flex-row u-gap-sm">
                    <button type="button" class="ui-button ui-button--primary ui-button--sm" onClick={submit} disabled={busy()}>
                        {editingKey() ? 'Save role' : '+ Add role'}
                    </button>
                    <Show when={editingKey()}>
                        <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={reset}>Cancel</button>
                    </Show>
                </div>
            </div>

            <ConfirmModal
                open={deleting() !== null}
                title="Delete role"
                message={`Delete the "${deleting()?.label ?? ''}" role? Refused while users have it or a subscription gives it.`}
                confirmLabel="Delete"
                danger
                onConfirm={doDelete}
                onCancel={() => setDeleting(null,)}
            />
        </section>
    );
};

export default RoleManager;
