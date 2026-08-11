/**
 * Admin Channel client — a module-level singleton that maintains the staff
 * presence WebSocket (`/ws/admin`) and exposes reactive Solid signals for the
 * sidebar presence UI.
 *
 * Responsibilities:
 *   - Connect (cookie-authenticated, same origin) with auto-reconnect backoff.
 *   - Track the current admin page + fan navigation to the server.
 *   - Accurately report active/idle: an idle timer (server-configured), plus
 *     tab-visibility + window-focus listeners, so switching tabs/windows or
 *     going idle flips the user to "inactive" and returning flips them back.
 *   - Detect when another active admin is on the SAME page (conflict warning).
 *
 * Kept framework-light: plain signals, no component lifecycle — the single
 * instance lives for the admin session and is driven by `AdminLayout`.
 */
import { createSignal, } from 'solid-js';
import {
    ADMIN_CHANNEL_DEFAULT_TIMEOUT_MS,
    ADMIN_CHANNEL_PATH,
    type AdminChannelClientMessage,
    type AdminChannelServerMessage,
    type AdminPresenceUser,
} from '@sitesurge/types';

const [presence, setPresence,] = createSignal<AdminPresenceUser[]>([],);
const [connected, setConnected,] = createSignal(false,);
const [loaded, setLoaded,] = createSignal(false,);
const [activeTimeoutMs, setActiveTimeoutMs,] = createSignal(ADMIN_CHANNEL_DEFAULT_TIMEOUT_MS,);
const [selfUserId, setSelfUserId,] = createSignal<string | null>(null,);
const [currentPage, setCurrentPage,] = createSignal<string | null>(null,);
// Ticks every few seconds so relative-time labels ("10s ago") stay fresh.
const [nowTick, setNowTick,] = createSignal(Date.now(),);

let socket: WebSocket | null = null;
let started = false;
let intentionalClose = false;
let reconnectDelay = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let lastActivitySent = 0;
let locallyActive = true;

/** Reactive accessors consumed by the presence UI. */
export const adminChannel = {
    presence,
    connected,
    loaded,
    activeTimeoutMs,
    selfUserId,
    currentPage,
    nowTick,
    /** Other users the server reports as active on MY current page. */
    samePageUsers,
    connect,
    disconnect,
    notifyNavigate,
};

function wsUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}${ADMIN_CHANNEL_PATH}`;
}

function send(msg: AdminChannelClientMessage,): void {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg,),);
    }
}

/** Other active users whose page equals mine — the conflict set. */
function samePageUsers(): AdminPresenceUser[] {
    const me = selfUserId();
    const page = currentPage();
    if (!page) return [];
    return presence().filter((u,) => u.userId !== me && u.active && u.page === page,);
}

function scheduleReconnect(): void {
    if (intentionalClose || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openSocket();
    }, reconnectDelay,);
    reconnectDelay = Math.min(reconnectDelay * 2, 15000,);
}

function openSocket(): void {
    try {
        socket = new WebSocket(wsUrl(),);
    } catch {
        scheduleReconnect();
        return;
    }

    socket.onopen = () => {
        reconnectDelay = 1000;
        setConnected(true,);
        locallyActive = true;
        send({ type: 'hello', page: currentPage(), },);
        send({ type: 'list', },);
        armIdleTimer();
    };

    socket.onmessage = (ev,) => {
        let msg: AdminChannelServerMessage;
        try {
            msg = JSON.parse(ev.data,) as AdminChannelServerMessage;
        } catch {
            return;
        }
        if (msg.type === 'welcome') {
            setSelfUserId(msg.self.userId,);
            setActiveTimeoutMs(msg.activeTimeoutMs || ADMIN_CHANNEL_DEFAULT_TIMEOUT_MS,);
            armIdleTimer();
        } else if (msg.type === 'presence') {
            setPresence(msg.users,);
            setLoaded(true,);
        }
    };

    socket.onclose = () => {
        setConnected(false,);
        socket = null;
        scheduleReconnect();
    };
    socket.onerror = () => {
        try { socket?.close(); } catch { /* ignore */ }
    };
}

// ─── Activity / idle tracking ────────────────────────────────────────────

function armIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer,);
    idleTimer = setTimeout(() => goInactive(), activeTimeoutMs(),);
}

function goInactive(): void {
    if (!locallyActive) return;
    locallyActive = false;
    send({ type: 'inactive', },);
}

/** Called on any admin activity (input, focus, navigation). Debounced. */
function registerActivity(): void {
    if (!locallyActive) {
        locallyActive = true;
        send({ type: 'active', },);
        lastActivitySent = Date.now();
    }
    armIdleTimer();
}

function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
        // Give the configured grace period, then mark inactive if still away.
        if (hiddenTimer) clearTimeout(hiddenTimer,);
        hiddenTimer = setTimeout(() => goInactive(), activeTimeoutMs(),);
    } else {
        if (hiddenTimer) { clearTimeout(hiddenTimer,); hiddenTimer = null; }
        registerActivity();
    }
}

function onWindowFocus(): void {
    if (hiddenTimer) { clearTimeout(hiddenTimer,); hiddenTimer = null; }
    registerActivity();
}

function onWindowBlur(): void {
    if (hiddenTimer) clearTimeout(hiddenTimer,);
    hiddenTimer = setTimeout(() => goInactive(), activeTimeoutMs(),);
}

/** Throttled DOM-activity handler (mousemove/keydown/etc). */
function onDomActivity(): void {
    const now = Date.now();
    if (now - lastActivitySent < 2000 && locallyActive) {
        armIdleTimer(); // cheap: just push the idle deadline out
        return;
    }
    lastActivitySent = now;
    registerActivity();
}

const DOM_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart',] as const;

function attachListeners(): void {
    document.addEventListener('visibilitychange', onVisibilityChange,);
    window.addEventListener('focus', onWindowFocus,);
    window.addEventListener('blur', onWindowBlur,);
    for (const e of DOM_EVENTS) window.addEventListener(e, onDomActivity, { passive: true, },);
}

function detachListeners(): void {
    document.removeEventListener('visibilitychange', onVisibilityChange,);
    window.removeEventListener('focus', onWindowFocus,);
    window.removeEventListener('blur', onWindowBlur,);
    for (const e of DOM_EVENTS) window.removeEventListener(e, onDomActivity,);
}

// ─── Public lifecycle ────────────────────────────────────────────────────

/** Start the channel (idempotent). Call once the admin shell mounts. */
function connect(initialPage?: string,): void {
    if (started) return;
    started = true;
    intentionalClose = false;
    if (initialPage !== undefined) setCurrentPage(initialPage,);
    attachListeners();
    openSocket();
    tickTimer = setInterval(() => setNowTick(Date.now(),), 5000,);
}

/** Tear down the channel (admin shell unmount / logout). */
function disconnect(): void {
    intentionalClose = true;
    started = false;
    detachListeners();
    if (reconnectTimer) { clearTimeout(reconnectTimer,); reconnectTimer = null; }
    if (idleTimer) { clearTimeout(idleTimer,); idleTimer = null; }
    if (hiddenTimer) { clearTimeout(hiddenTimer,); hiddenTimer = null; }
    if (tickTimer) { clearInterval(tickTimer,); tickTimer = null; }
    try { socket?.close(); } catch { /* ignore */ }
    socket = null;
    setConnected(false,);
    setLoaded(false,);
    setPresence([],);
}

/** Report a navigation to a new admin page (also counts as activity). */
function notifyNavigate(page: string,): void {
    setCurrentPage(page,);
    registerActivity();
    send({ type: 'navigate', page, },);
}
