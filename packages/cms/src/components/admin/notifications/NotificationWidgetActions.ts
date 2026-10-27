/**
 * Shared helpers for in-app notifications (sidebar widget + /admin/notifications):
 * acting on a notification (mark read + go to its target), labels, times.
 */
import type { UserNotification, } from '@sitesurge/types';
import { NOTIFICATION_TYPES, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { refreshNotifications, } from '../../../stores/notifications';

/** "now", "5m", "2h", "3d", else a date. */
export function timeAgo(iso: string,): string {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso,).getTime()) / 1000,),);
    if (s < 45) return 'now';
    const m = Math.floor(s / 60,);
    if (m < 60) return `${Math.max(1, m,)}m ago`;
    const h = Math.floor(m / 60,);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24,);
    if (d < 7) return `${d}d ago`;
    return new Date(iso,).toLocaleDateString(undefined, { dateStyle: 'medium', },);
}

export function typeLabel(key: string,): string {
    return NOTIFICATION_TYPES.find((t,) => t.key === key,)?.label ?? key.replace(/_/g, ' ',);
}

/**
 * Where a notification leads: a same-origin URL becomes a router path; another
 * origin opens in a new tab; none → the notifications page.
 */
export function targetOf(n: Pick<UserNotification, 'url'>,): { path: string; external: boolean; } {
    if (!n.url) return { path: '/admin/notifications', external: false, };
    try {
        const u = new URL(n.url, window.location.origin,);
        if (u.origin === window.location.origin) return { path: `${u.pathname}${u.search}${u.hash}`, external: false, };
        return { path: u.href, external: true, };
    } catch {
        return { path: '/admin/notifications', external: false, };
    }
}

/** Act on a notification: mark it read, then go to its target. */
export async function actOn(n: UserNotification, navigate: (path: string,) => void,): Promise<void> {
    if (!n.readAt) {
        await cms.notifications.markRead([n.id,],).catch(() => undefined,);
        void refreshNotifications();
    }
    const t = targetOf(n,);
    if (t.external) window.open(t.path, '_blank', 'noopener',);
    else navigate(t.path,);
}
