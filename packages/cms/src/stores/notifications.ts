/**
 * In-app notifications — the shared UNREAD state for the admin shell (sidebar
 * widget badge, /admin/notifications). Polled (`cms.notifications.count()`)
 * every 60 s while the tab is visible, on window focus, and after any read /
 * clear — polling rather than the admin WebSocket, which is staff-only (role
 * shells such as contributors use this too). Started/stopped by AdminLayout.
 */
import { createSignal, } from 'solid-js';
import { cms, } from '../services/cmsClient';

const [unread, setUnread,] = createSignal(0,);
const [enabled, setEnabled,] = createSignal(false,);
/** Bumped after every refresh — list views re-fetch on it. */
const [version, setVersion,] = createSignal(0,);

export { enabled as notificationsEnabled, unread as unreadNotifications, version as notificationsVersion, };

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Re-read the unread count (+ enabled). Never throws. */
export async function refreshNotifications(): Promise<void> {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
        const r = await cms.notifications.count();
        setUnread(r.unread,);
        setEnabled(r.enabled,);
    } catch {
        // No access / signed out → widget hidden.
        setEnabled(false,);
        setUnread(0,);
    }
    setVersion((v,) => v + 1,);
}

const onFocus = () => void refreshNotifications();

/** Start polling (idempotent). */
export function startNotificationPolling(): void {
    if (running || typeof window === 'undefined') return;
    running = true;
    void refreshNotifications();
    timer = setInterval(() => void refreshNotifications(), 60_000,);
    window.addEventListener('focus', onFocus,);
    document.addEventListener('visibilitychange', onFocus,);
}

/** Stop polling and reset (sign-out / leaving the admin). */
export function stopNotificationPolling(): void {
    if (!running) return;
    running = false;
    if (timer) clearInterval(timer,);
    timer = null;
    window.removeEventListener('focus', onFocus,);
    document.removeEventListener('visibilitychange', onFocus,);
    setUnread(0,);
    setEnabled(false,);
}
