/**
 * AdminPresence — the sidebar "connected users" widget. Collapsed, it shows a
 * live count ("2 users connected"); clicked, it expands UPWARD into a list of
 * each connected admin/editor with their role, an active/idle dot, a short
 * "last active" time, and the page they're on. The current user is included
 * and labelled "(you)". Data comes from the `adminChannel` singleton.
 */
import { Component, createMemo, createSignal, For, Show, } from 'solid-js';
import type { AdminPresenceUser, } from '@sitesurge/types';
import { adminChannel, } from '../../../services/adminChannel';
import './AdminPresence.scss';

/** Compact relative time — "now", "10s ago", "5m ago", "2h ago", "3d ago". */
function agoShort(iso: string, now: number,): string {
    const s = Math.max(0, Math.floor((now - new Date(iso,).getTime()) / 1000,),);
    if (s < 5) return 'now';
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60,);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60,);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24,)}d ago`;
}

/** Friendly label for an admin path (`/admin/pages/123` → "Pages"). */
function pageLabel(path: string | null,): string {
    if (!path) return 'Admin';
    const seg = path.replace(/^\/admin\/?/, '',).split('/',)[0] || '';
    if (!seg) return 'Dashboard';
    return seg.charAt(0,).toUpperCase() + seg.slice(1,).replace(/-/g, ' ',);
}

const AdminPresence: Component = () => {
    const [expanded, setExpanded,] = createSignal(false,);

    const users = createMemo(() => adminChannel.presence(),);
    const count = createMemo(() => users().length,);
    const isSelf = (u: AdminPresenceUser,) => u.userId === adminChannel.selfUserId();

    return (
        <div class={`admin-presence ${expanded() ? 'admin-presence--expanded' : ''}`}>
            <Show when={expanded()}>
                <div class="admin-presence__list" role="list">
                    <For
                        each={users()}
                        fallback={<div class="admin-presence__empty">No one else is here.</div>}
                    >
                        {(u,) => (
                            <div class="admin-presence__item" role="listitem">
                                <div class="admin-presence__item-row">
                                    <span
                                        class={`admin-presence__dot ${
                                            u.active ? 'admin-presence__dot--active' : 'admin-presence__dot--idle'
                                        }`}
                                        title={u.active ? 'Active' : 'Idle'}
                                    />
                                    <span class="admin-presence__name">
                                        {u.displayName}
                                        <Show when={isSelf(u,)}><span class="admin-presence__you"> (you)</span></Show>
                                    </span>
                                    <span class="admin-presence__role">{u.role}</span>
                                    <span class="admin-presence__ago">{agoShort(u.lastActiveAt, adminChannel.nowTick(),)}</span>
                                </div>
                                <div class="admin-presence__item-page" title={u.page ?? ''}>
                                    {pageLabel(u.page,)}
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </Show>

            <button
                class="admin-presence__header"
                onClick={() => setExpanded((v,) => !v)}
                title={expanded() ? 'Collapse' : 'Show connected users'}
            >
                <Show
                    when={adminChannel.loaded()}
                    fallback={<span class="admin-presence__status">Loading…</span>}
                >
                    <span
                        class={`admin-presence__dot ${
                            adminChannel.connected() ? 'admin-presence__dot--active' : 'admin-presence__dot--idle'
                        }`}
                    />
                    <span class="admin-presence__status">
                        {count()} user{count() === 1 ? '' : 's'} connected
                    </span>
                </Show>
                <Show when={expanded()}>
                    <span
                        class="admin-presence__close"
                        role="button"
                        aria-label="Collapse connected users"
                        onClick={(e,) => { e.stopPropagation(); setExpanded(false,); }}
                    >
                        ×
                    </span>
                </Show>
            </button>
        </div>
    );
};

export default AdminPresence;
