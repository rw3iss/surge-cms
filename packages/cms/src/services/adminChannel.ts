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

// ─── Page-label resolution ───────────────────────────────────────────────
// The label shown for a user in the presence list. Primary source is the URL
// (deterministic + always unique); we opportunistically enrich with the page's
// document.title, but ONLY when the destination page actually SETS a title after
// navigation (many editors don't, and their title stays stale) — the
// `navTitleBaseline` guard prevents mislabeling a page with the previous one's.

const SECTION_LABELS: Record<string, string> = {
    '': 'Dashboard',
    pages: 'Pages',
    posts: 'Posts',
    campaigns: 'Campaigns',
    forms: 'Forms',
    media: 'Media',
    entities: 'Entities',
    users: 'Users',
    messages: 'Messages',
    social: 'Social',
    'mailing-lists': 'Mailing Lists',
    'mail-templates': 'Mail Templates',
    mail: 'Mail',
    shop: 'Shop',
    plugins: 'Plugins',
    settings: 'Settings',
    help: 'Help',
};

let navTitleBaseline = '';
let sentLabel = '';
let titleObserver: MutationObserver | null = null;
let labelRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function adminSegments(path: string,): string[] {
    return path.replace(/^\/admin\/?/, '',).split('/',).filter(Boolean,);
}

function sectionLabel(path: string,): string {
    const seg = adminSegments(path,)[0] ?? '';
    return SECTION_LABELS[seg] ?? (seg ? seg.charAt(0,).toUpperCase() + seg.slice(1,).replace(/-/g, ' ',) : 'Dashboard');
}

/** Does this segment look like an opaque id (uuid / number / long token)? */
function idLike(seg: string,): boolean {
    return /^[0-9a-f]{8}-[0-9a-f-]{4,}$/i.test(seg,) || /^\d+$/.test(seg,) || seg.length >= 20;
}

/** Abbreviate an id-like segment to 8 chars; leave slugs/words intact. */
function abbrevSeg(seg: string,): string {
    return idLike(seg,) ? seg.replace(/-/g, '',).slice(0, 8,) : seg;
}

/** Deterministic path-based label — "Forms", "Forms: a1b2c3d4", "Shop: products/12". */
function pathLabel(path: string,): string {
    const segs = adminSegments(path,);
    const section = sectionLabel(path,);
    const rest = segs.slice(1,);
    if (rest.length === 0) return section;
    return `${section}: ${rest.map(abbrevSeg,).join('/',)}`;
}

/** The page-specific part of a document.title (before the " - Admin …" suffix),
 *  or null if it's generic ("New X" / "Edit X") or empty. */
function specificFromTitle(title: string,): string | null {
    if (!title) return null;
    const first = title.split(/\s+[–—-]\s+/,)[0]?.trim();
    if (!first) return null;
    if (/^(new|edit)\b/i.test(first,)) return null;
    return first;
}

/** Best label for a page: an actively-set specific title, else the path label. */
function labelFor(path: string,): string {
    const title = typeof document !== 'undefined' ? document.title : '';
    const fresh = title && title !== navTitleBaseline;
    const specific = fresh ? specificFromTitle(title,) : null;
    if (specific) {
        const section = sectionLabel(path,);
        return specific.toLowerCase().startsWith(section.toLowerCase(),) ? specific : `${section}: ${specific}`;
    }
    return pathLabel(path,);
}

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
        const label = labelFor(currentPage() ?? '',);
        sentLabel = label;
        navTitleBaseline = typeof document !== 'undefined' ? document.title : '';
        send({ type: 'hello', page: currentPage(), label, },);
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
    // Re-resolve the label whenever the page updates its <title> (e.g. a name
    // lands after an async fetch), so other users see the specific title.
    if (typeof document !== 'undefined' && document.head && !titleObserver) {
        let lastTitle = document.title;
        titleObserver = new MutationObserver(() => {
            if (document.title !== lastTitle) {
                lastTitle = document.title;
                pushPageLabel();
            }
        },);
        // Watch the whole <head> subtree — @solidjs/meta swaps the <title> node
        // rather than mutating its text, so observing the element alone misses it.
        titleObserver.observe(document.head, { childList: true, characterData: true, subtree: true, },);
    }
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
    if (labelRefreshTimer) { clearTimeout(labelRefreshTimer,); labelRefreshTimer = null; }
    if (titleObserver) { titleObserver.disconnect(); titleObserver = null; }
    try { socket?.close(); } catch { /* ignore */ }
    socket = null;
    setConnected(false,);
    setLoaded(false,);
    setPresence([],);
}

/** Re-resolve MY label for the current page and push it if it changed. Called
 *  after navigation + whenever the page sets/updates its <title>. */
function pushPageLabel(): void {
    const page = currentPage();
    const label = labelFor(page ?? '',);
    if (label === sentLabel) return;
    sentLabel = label;
    send({ type: 'navigate', page, label, },);
}

/** Report a navigation to a new admin page (also counts as activity). */
function notifyNavigate(page: string,): void {
    // Snapshot the outgoing title BEFORE the destination renders, so a page that
    // never sets its own title can't be mislabeled with the previous page's.
    navTitleBaseline = typeof document !== 'undefined' ? document.title : '';
    setCurrentPage(page,);
    registerActivity();
    sentLabel = '';
    // Immediate path-based label, then a short retry to pick up a title the
    // destination sets on mount (async data → name may land later still, which
    // the title observer catches).
    pushPageLabel();
    if (labelRefreshTimer) clearTimeout(labelRefreshTimer,);
    labelRefreshTimer = setTimeout(pushPageLabel, 500,);
}
