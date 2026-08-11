/**
 * Admin Channel — real-time presence for logged-in admin/editor users.
 *
 * A WebSocket channel (`/ws/admin`, staff-only) broadcasts who is currently in
 * the admin, what page they're on, and whether they're active or idle — so
 * concurrent editors can see each other and avoid clobbering each other's work.
 * These types are the wire contract shared by the backend channel server and
 * the admin client module.
 */
import type { UserRole, } from './user';

/** One connected admin/editor's presence, aggregated across their connections. */
export interface AdminPresenceUser {
    userId: string;
    displayName: string;
    email: string;
    role: UserRole;
    /** The admin path they're currently viewing (e.g. `/admin/pages/123`). */
    page: string | null;
    /** A human label for `page` (e.g. "Forms: a1b2c3d4", "Shop: My Product"),
     *  resolved client-side. Falls back to a path-derived label if absent. */
    pageLabel?: string | null;
    /** ISO timestamp of their last activity (navigation / focus / input). */
    lastActiveAt: string;
    /** Derived by the server: reported-active AND within the idle timeout. */
    active: boolean;
    /** Set client-side so the UI can label / exclude the viewer's own row. */
    isSelf?: boolean;
}

/** Messages the CLIENT sends to the channel. */
export type AdminChannelClientMessage =
    | { type: 'hello'; page: string | null; label?: string | null; }
    | { type: 'navigate'; page: string | null; label?: string | null; }
    | { type: 'active'; }
    | { type: 'inactive'; }
    | { type: 'list'; }
    | { type: 'ping'; };

/** Messages the SERVER sends to a client. */
export type AdminChannelServerMessage =
    | { type: 'welcome'; self: AdminPresenceUser; activeTimeoutMs: number; }
    | { type: 'presence'; users: AdminPresenceUser[]; }
    | { type: 'pong'; };

/** `GET /admin-channel/presence` — a staff-only REST snapshot (WS fallback). */
export interface AdminChannelPresenceResponse {
    users: AdminPresenceUser[];
    activeTimeoutMs: number;
}

/** WebSocket path the channel listens on (behind the same origin as the API). */
export const ADMIN_CHANNEL_PATH = '/ws/admin';

/** Default idle timeout (ms) before a connected user is shown as idle. */
export const ADMIN_CHANNEL_DEFAULT_TIMEOUT_MS = 60_000;
