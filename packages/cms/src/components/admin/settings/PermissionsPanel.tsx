/**
 * Settings → Permissions.
 *
 * Permissions are grouped by the feature that registered them, because that is
 * how an operator thinks about them ("what can editors do in the shop") and it
 * keeps a long list navigable as features are installed.
 *
 * Each row edits the permission's DEFAULT rule. Per-user exceptions live in the
 * user's own modal — a permission can have many users, and cramming a user
 * picker into every row buries the rule that actually matters.
 */
import { Component, createMemo, createResource, createSignal, For, Show, } from 'solid-js';
import type { PermissionWithGrants, } from '@sitesurge/types';
import { PERMISSION_PRECEDENCE, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import { FormField, } from '../forms';
import CollapsiblePanel from '../common/CollapsiblePanel';
import ConfirmModal from '../common/ConfirmModal';
import './PermissionsPanel.scss';

/** Roles a grant can target. `anonymous` is included so a permission can be
 *  opened to logged-out visitors without setting it to "everyone". */
const ROLES = ['anonymous', 'member', 'editor', 'admin', 'sysadmin',];

const ACCESS_LABELS: Record<string, string> = {
    everyone: 'Everyone',
    roles: 'Specific roles',
    nobody: 'Nobody by default',
};

const PermissionsPanel: Component = () => {
    const toast = useToast();
    const [search, setSearch,] = createSignal('',);
    const [pendingDelete, setPendingDelete,] = createSignal<string | null>(null,);
    const [creating, setCreating,] = createSignal(false,);

    const [permissions, { refetch, },] = createResource(async () => {
        try {
            return await cms.permissions.list();
        } catch {
            return [] as PermissionWithGrants[];
        }
    },);

    /** Group by feature, filtered by the search box. */
    const groups = createMemo(() => {
        const q = search().toLowerCase().trim();
        const list = (permissions() ?? []).filter((p,) =>
            !q
            || p.key.toLowerCase().includes(q,)
            || p.label.toLowerCase().includes(q,)
            || (p.description ?? '').toLowerCase().includes(q,));
        const byFeature = new Map<string, PermissionWithGrants[]>();
        for (const p of list) {
            const g = byFeature.get(p.feature,) ?? [];
            g.push(p,);
            byFeature.set(p.feature, g,);
        }
        // `core` first — it is the set every install has.
        return [...byFeature.entries(),].sort(([a,], [b,],) =>
            (a === 'core' ? -1 : b === 'core' ? 1 : a.localeCompare(b,)));
    },);

    const save = async (key: string, patch: Record<string, unknown>,) => {
        try {
            await cms.permissions.update(key, patch,);
            await refetch();
            toast.success('Permission updated.',);
        } catch (e: any) {
            toast.error(e?.message || 'Could not update the permission.',);
        }
    };

    /** Toggle a role in the default list. */
    const toggleRole = async (p: PermissionWithGrants, role: string,) => {
        const next = p.defaultRoles.includes(role,)
            ? p.defaultRoles.filter((r,) => r !== role)
            : [...p.defaultRoles, role,];
        await save(p.key, { defaultRoles: next, },);
    };

    const removeUserGrant = async (key: string, userId: string,) => {
        try {
            await cms.permissions.removeGrant(key, 'user', userId,);
            await refetch();
            toast.success('Grant removed.',);
        } catch (e: any) {
            toast.error(e?.message || 'Could not remove the grant.',);
        }
    };

    const doDelete = async () => {
        const key = pendingDelete();
        if (!key) return;
        try {
            await cms.permissions.remove(key,);
            await refetch();
            toast.success('Permission deleted.',);
        } catch (e: any) {
            toast.error(e?.message || 'Could not delete the permission.',);
        } finally {
            setPendingDelete(null,);
        }
    };

    return (
        <div class="permissions-panel">
            <div class="permissions-panel__intro">
                <p class="form-help-muted">
                    Permissions sit on top of roles. A route still requires its normal
                    sign-in level; a permission narrows who may act within it.
                </p>
                <ol class="permissions-panel__precedence">
                    <For each={PERMISSION_PRECEDENCE}>{(line,) => <li>{line}</li>}</For>
                </ol>
            </div>

            <div class="permissions-panel__toolbar">
                <input
                    type="search"
                    class="permissions-panel__search"
                    placeholder="Search permissions…"
                    value={search()}
                    onInput={(e,) => setSearch(e.currentTarget.value,)}
                />
                <button
                    type="button"
                    class="ui-button ui-button--secondary ui-button--sm"
                    onClick={() => setCreating(true,)}
                >
                    + New permission
                </button>
            </div>

            <Show
                when={!permissions.loading}
                fallback={<p class="form-help-muted">Loading permissions…</p>}
            >
                <Show
                    when={groups().length > 0}
                    fallback={
                        <p class="form-help-muted">
                            No permissions match. Features register theirs when enabled.
                        </p>
                    }
                >
                    <For each={groups()}>
                        {([feature, items,],) => (
                            <CollapsiblePanel
                                title={feature === 'core' ? 'Core' : feature}
                                subtitle={`${items.length} permission${items.length !== 1 ? 's' : ''}`}
                                defaultOpen={feature === 'core'}
                            >
                                <For each={items}>
                                    {(p,) => (
                                        <div class="permission-row">
                                            <div class="permission-row__head">
                                                <div>
                                                    <div class="permission-row__label">{p.label}</div>
                                                    <code class="permission-row__key">{p.key}</code>
                                                    <Show when={p.description}>
                                                        <div class="permission-row__desc">{p.description}</div>
                                                    </Show>
                                                </div>
                                                <Show when={!p.isSystem}>
                                                    <button
                                                        type="button"
                                                        class="ui-button ui-button--danger ui-button--sm"
                                                        onClick={() => setPendingDelete(p.key,)}
                                                    >
                                                        Delete
                                                    </button>
                                                </Show>
                                            </div>

                                            <div class="permission-row__controls">
                                                <FormField label="Available to">
                                                    <select
                                                        value={p.defaultAccess}
                                                        onChange={(e,) =>
                                                            save(p.key, { defaultAccess: e.currentTarget.value, },)}
                                                    >
                                                        <For each={Object.entries(ACCESS_LABELS,)}>
                                                            {([v, label,],) => <option value={v}>{label}</option>}
                                                        </For>
                                                    </select>
                                                </FormField>

                                                {/* Only meaningful for the `roles` rule — for the
                                                    other two the list is ignored, so showing it
                                                    would imply it still applies. */}
                                                <Show when={p.defaultAccess === 'roles'}>
                                                    <div class="permission-row__roles">
                                                        <For each={ROLES}>
                                                            {(role,) => (
                                                                <button
                                                                    type="button"
                                                                    class={`permission-chip${
                                                                        p.defaultRoles.includes(role,)
                                                                            ? ' permission-chip--on' : ''
                                                                    }`}
                                                                    onClick={() => toggleRole(p, role,)}
                                                                >
                                                                    {role}
                                                                </button>
                                                            )}
                                                        </For>
                                                    </div>
                                                </Show>
                                            </div>

                                            {/* Exceptions, so it is obvious at a glance that a
                                                permission has per-user overrides at all. */}
                                            <Show when={p.userGrants.length > 0 || p.roleGrants.length > 0}>
                                                <div class="permission-row__grants">
                                                    <span class="permission-row__grants-label">Exceptions:</span>
                                                    <For each={p.roleGrants}>
                                                        {(g,) => (
                                                            <span class={`permission-chip permission-chip--${g.granted ? 'allow' : 'deny'}`}>
                                                                {g.granted ? '✓' : '✕'} role: {g.role}
                                                                <button
                                                                    type="button"
                                                                    class="permission-chip__x"
                                                                    aria-label={`Remove ${g.role}`}
                                                                    onClick={async () => {
                                                                        await cms.permissions.removeGrant(p.key, 'role', g.role,);
                                                                        await refetch();
                                                                    }}
                                                                >×</button>
                                                            </span>
                                                        )}
                                                    </For>
                                                    <For each={p.userGrants}>
                                                        {(g,) => (
                                                            <span class={`permission-chip permission-chip--${g.granted ? 'allow' : 'deny'}`}>
                                                                {g.granted ? '✓' : '✕'} {g.displayName || g.email || g.userId.slice(0, 8,)}
                                                                <button
                                                                    type="button"
                                                                    class="permission-chip__x"
                                                                    aria-label="Remove grant"
                                                                    onClick={() => removeUserGrant(p.key, g.userId,)}
                                                                >×</button>
                                                            </span>
                                                        )}
                                                    </For>
                                                </div>
                                            </Show>
                                        </div>
                                    )}
                                </For>
                            </CollapsiblePanel>
                        )}
                    </For>
                </Show>
            </Show>

            <Show when={creating()}>
                <NewPermissionForm
                    onClose={() => setCreating(false,)}
                    onCreated={async () => { setCreating(false,); await refetch(); }}
                />
            </Show>

            <ConfirmModal
                open={pendingDelete() !== null}
                title="Delete permission"
                message={`Delete ${pendingDelete()}? Any grants on it are removed too.`}
                confirmLabel="Delete"
                danger
                onConfirm={doDelete}
                onCancel={() => setPendingDelete(null,)}
            />
        </div>
    );
};

/** Create a permission by hand — for a plugin or an integration that checks
 *  its own key without registering it in code. */
const NewPermissionForm: Component<{ onClose: () => void; onCreated: () => void; }> = (props,) => {
    const toast = useToast();
    const [key, setKey,] = createSignal('',);
    const [label, setLabel,] = createSignal('',);
    const [saving, setSaving,] = createSignal(false,);

    const submit = async () => {
        setSaving(true,);
        try {
            await cms.permissions.create({ key: key().trim(), label: label().trim() || key().trim(), },);
            toast.success('Permission created.',);
            props.onCreated();
        } catch (e: any) {
            toast.error(e?.message || 'Could not create the permission.',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="permissions-panel__new">
            <FormField label="Key" hint="feature:action — e.g. reports:export">
                <input
                    type="text" value={key()} placeholder="reports:export"
                    onInput={(e,) => setKey(e.currentTarget.value,)}
                />
            </FormField>
            <FormField label="Label">
                <input
                    type="text" value={label()} placeholder="Export reports"
                    onInput={(e,) => setLabel(e.currentTarget.value,)}
                />
            </FormField>
            <div class="permissions-panel__new-actions">
                <button
                    type="button" class="ui-button ui-button--primary ui-button--sm"
                    disabled={!key().trim() || saving()}
                    onClick={submit}
                >{saving() ? 'Creating…' : 'Create'}</button>
                <button
                    type="button" class="ui-button ui-button--ghost ui-button--sm"
                    onClick={props.onClose}
                >Cancel</button>
            </div>
        </div>
    );
};

export default PermissionsPanel;
