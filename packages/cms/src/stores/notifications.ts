/**
 * In-app notifications — the shared UNREAD state for the admin shell (sidebar
 * widget badge, /admin/notifications). Polled (`cms.notifications.count()`)
 * every 60 s while the tab is visible, on window focus, and after any read /
 * clear (forced) — polling rather than the admin WebSocket, which is staff-only (role
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

/** Focus + visibilitychange fire together — one request is enough. */
const MIN_GAP_MS = 2_000;
let lastAt = 0;
let inFlight: Promise<void> | null = null;

/**
 * Re-read the unread count (+ enabled). Never throws.
 * The list views re-fetch on `version`, which moves only when the count (or
 * the switch) CHANGED, or when `force` is set (after a read / clear) — a
 * quiet minute no longer re-downloads the open list.
 */
export async function refreshNotifications(opts: { force?: boolean; } = {},): Promise<void> {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (!opts.force && (inFlight || Date.now() - lastAt < MIN_GAP_MS)) return inFlight ?? undefined;
    lastAt = Date.now();
    const run = (async () => {
        const before = [unread(), enabled(),].join();
        try {
            const r = await cms.notifications.count();
            setUnread(r.unread,);
            setEnabled(r.enabled,);
        } catch {
            // No access / signed out → widget hidden.
            setEnabled(false,);
            setUnread(0,);
        }
        if (opts.force || before !== [unread(), enabled(),].join()) setVersion((v,) => v + 1,);
    })();
    inFlight = run;
    try {
        await run;
    } finally {
        if (inFlight === run) inFlight = null;
    }
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
    lastAt = 0;
    setUnread(0,);
    setEnabled(false,);
}

/**
 * Sign-out on a shared browser: remove this browser's desktop subscription
 * from the server (while the session still exists), so the next person at
 * this computer does not get the previous user's alerts. The browser-side
 * subscription stays — the next user who turns desktop alerts on takes it over.
 * Never throws. Call BEFORE the logout request.
 */
export async function releaseDesktopNotifications(): Promise<void> {
    try {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager?.getSubscription();
        if (sub) await cms.notifications.pushUnsubscribe(sub.endpoint,);
    } catch { /* best effort */ }
}
