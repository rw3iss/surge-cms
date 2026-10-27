/**
 * A reusable USERS + ROLES picker: chosen users and roles as chips (×
 * removes), and one search box whose dropdown lists matching users (name /
 * email / handle, `cms.users.list`) and roles (`cms.roles.list`). Picking one
 * adds a chip. Controlled: `userIds` / `roles` in, `onChange` out.
 *
 * Used by Settings → Notifications (in-app recipients); fits anywhere a
 * "these people and these roles" list is needed.
 */
import { createResource, createSignal, For, onCleanup, Show, type Component, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import './UserRolePicker.scss';

export interface UserRolePickerValue { userIds: string[]; roles: string[]; }

interface UserHit { id: string; displayName?: string | null; email: string; handle?: string | null; role?: string; }

/** Name cache shared by every picker on the page (saved ids → labels). */
const nameCache = new Map<string, string>();
const labelOf = (u: UserHit,) => u.displayName || u.handle || u.email;

const UserRolePicker: Component<{
    userIds: string[];
    roles: string[];
    onChange: (v: UserRolePickerValue,) => void;
    placeholder?: string;
    disabled?: boolean;
}> = (props,) => {
    const [query, setQuery,] = createSignal('',);
    const [open, setOpen,] = createSignal(false,);
    const [hits, setHits,] = createSignal<UserHit[]>([],);
    const [searching, setSearching,] = createSignal(false,);
    const [roleList,] = createResource(() => cms.roles.list().catch(() => [],),);
    // Labels for already-saved user ids (once per id).
    const [names,] = createResource(
        () => props.userIds.filter((id,) => !nameCache.has(id,),).join(',',) || null,
        async (ids,) => {
            await Promise.all(ids.split(',',).map(async (id,) => {
                try {
                    const u = await cms.users.getById(id,) as unknown as UserHit;
                    nameCache.set(id, labelOf(u,),);
                } catch {
                    nameCache.set(id, 'Unknown user',);
                }
            },),);
            return nameCache.size;
        },
    );
    const userLabel = (id: string,) => { names(); return nameCache.get(id,) ?? '…'; };
    const roleLabel = (key: string,) => roleList()?.find((r,) => r.key === key,)?.label ?? key;

    // Search-as-you-type box: queries on input (debounced), so it does not
    // commit on blur like the other admin text inputs.
    let timer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(timer,),);
    const search = (q: string,) => {
        setQuery(q,);
        setOpen(true,);
        clearTimeout(timer,);
        if (!q.trim()) { setHits([],); return; }
        timer = setTimeout(async () => {
            setSearching(true,);
            try {
                const res = await cms.users.list({ search: q.trim(), limit: 8, },);
                setHits((res.data ?? []) as unknown as UserHit[],);
            } catch {
                setHits([],);
            } finally {
                setSearching(false,);
            }
        }, 250,);
    };

    const roleHits = () => {
        const q = query().trim().toLowerCase();
        return (roleList() ?? []).filter((r,) => r.key !== 'anonymous' && !props.roles.includes(r.key,)
            && (!q || r.key.includes(q,) || r.label.toLowerCase().includes(q,)),);
    };
    const userHits = () => hits().filter((u,) => !props.userIds.includes(u.id,),);

    const addUser = (u: UserHit,) => {
        nameCache.set(u.id, labelOf(u,),);
        props.onChange({ userIds: [...props.userIds, u.id,], roles: props.roles, },);
        setQuery('',);
        setHits([],);
    };
    const addRole = (key: string,) => {
        props.onChange({ userIds: props.userIds, roles: [...props.roles, key,], },);
        setQuery('',);
    };
    const removeUser = (id: string,) => props.onChange({ userIds: props.userIds.filter((x,) => x !== id,), roles: props.roles, },);
    const removeRole = (key: string,) => props.onChange({ userIds: props.userIds, roles: props.roles.filter((x,) => x !== key,), },);

    return (
        <div class="user-role-picker" classList={{ 'is-disabled': !!props.disabled, }}>
            <div class="user-role-picker__chips">
                <For each={props.roles}>
                    {(key,) => (
                        <span class="user-role-picker__chip user-role-picker__chip--role" title="Everyone with this role (main or additional)">
                            Role: {roleLabel(key,)}
                            <button type="button" aria-label={`Remove role ${roleLabel(key,)}`} onClick={() => removeRole(key,)} disabled={props.disabled}>×</button>
                        </span>
                    )}
                </For>
                <For each={props.userIds}>
                    {(id,) => (
                        <span class="user-role-picker__chip">
                            {userLabel(id,)}
                            <button type="button" aria-label={`Remove ${userLabel(id,)}`} onClick={() => removeUser(id,)} disabled={props.disabled}>×</button>
                        </span>
                    )}
                </For>
                <Show when={!props.userIds.length && !props.roles.length}>
                    <span class="form-help-muted user-role-picker__empty">Nobody yet.</span>
                </Show>
            </div>
            <div class="user-role-picker__search">
                <input
                    type="search"
                    value={query()}
                    placeholder={props.placeholder ?? 'Add a user (name, email, handle) or a role…'}
                    disabled={props.disabled}
                    onInput={(e,) => search(e.currentTarget.value,)}
                    onFocus={() => setOpen(true,)}
                    onBlur={() => setTimeout(() => setOpen(false,), 150,)}
                    onKeyDown={(e,) => { if (e.key === 'Escape') setOpen(false,); }}
                />
                <Show when={open() && (roleHits().length || userHits().length || searching() || query().trim())}>
                    <ul class="user-role-picker__menu" role="listbox">
                        <For each={roleHits()}>
                            {(r,) => (
                                <li>
                                    <button type="button" onMouseDown={(e,) => e.preventDefault()} onClick={() => addRole(r.key,)}>
                                        <span class="user-role-picker__kind">Role</span> {r.label} <code>{r.key}</code>
                                    </button>
                                </li>
                            )}
                        </For>
                        <For each={userHits()}>
                            {(u,) => (
                                <li>
                                    <button type="button" onMouseDown={(e,) => e.preventDefault()} onClick={() => addUser(u,)}>
                                        <span class="user-role-picker__kind">User</span> {labelOf(u,)}
                                        <span class="user-role-picker__meta">{u.email}{u.handle ? ` · @${u.handle}` : ''}</span>
                                    </button>
                                </li>
                            )}
                        </For>
                        <Show when={searching()}><li class="user-role-picker__note">Searching…</li></Show>
                        <Show when={!searching() && query().trim() && !userHits().length && !roleHits().length}>
                            <li class="user-role-picker__note">No matches.</li>
                        </Show>
                    </ul>
                </Show>
            </div>
        </div>
    );
};

export default UserRolePicker;
