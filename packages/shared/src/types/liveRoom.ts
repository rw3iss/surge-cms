/**
 * Live room protocol — the WebSocket at `LIVE_ROOM_PATH?post=<postId>`.
 *
 * Command `token` = the room ticket from `POST /posts/:id/live/ticket`
 * (`cms.posts.liveTicket`), NOT the JWT (the session cookie is httpOnly).
 *
 * One room per live post. The socket authenticates from the session cookie at
 * the upgrade (anonymous viewers may join to watch/read chat); EVERY command
 * also carries the caller's access token (`token`) when they have one, and the
 * server re-verifies it per command — so a command is authorised by who sends
 * it, not by who opened the socket. Rooms fan out across server processes via
 * Redis. Ended shows have no room: clients must not connect.
 */
import type { LiveChatMode, LiveStatus, } from './postTypes';

export const LIVE_ROOM_PATH = '/ws/live';

export interface LiveRoomState {
    postId: string;
    status: LiveStatus;
    /** Stream audio muted by the host. */
    muted: boolean;
    chatMode: LiveChatMode;
    reactionsEnabled: boolean;
    archiveVideo: boolean;
    startedAt: string | null;
    endedAt: string | null;
    viewers: number;
    /** Provider stream not connected yet (stub). */
    providerConnected: boolean;
}

export interface LiveChatMessage {
    id: string;
    userId: string | null;
    name: string;
    /** Public member handle (for @mentions / profile links). */
    handle?: string | null;
    /** Sender's role — staff roles show a "Staff" badge. */
    role: string | null;
    /** May contain `@name` / `@handle` mentions (rendered + highlighted by the client). */
    text: string;
    at: string;
    /** The message this one replies to (excerpt, so a deleted original still reads). */
    replyTo?: LiveChatReplyRef | null;
    /** Emoji → count (LIVE_REACTIONS only). */
    reactions?: Record<string, number>;
}

export interface LiveChatReplyRef {
    id: string;
    name: string;
    /** First 140 characters of the original. */
    text: string;
}

/**
 * A viewer's moderation KEY: `u:<userId>` for a signed-in user, `a:<anonId>`
 * for a guest (a random id the browser keeps in localStorage and sends as
 * `?anon=` on connect). Mute/silence/kick/ban act on the key.
 */
export type LiveViewerKey = string;

/** One connected socket in a live room (staff view: GET /posts/:id/live/viewers). */
export interface LiveViewer {
    connId: string;
    key: LiveViewerKey;
    userId: string | null;
    name: string;
    handle: string | null;
    role: string | null;
    avatarUrl: string | null;
    anonymous: boolean;
    connectedAt: string;
    /** Can't chat (until unmuted). */
    muted: boolean;
    /** Can't chat or react until this time (ISO), or null. */
    silencedUntil: string | null;
}

export type LiveModerationAction = 'mute' | 'unmute' | 'silence' | 'unsilence' | 'kick' | 'ban' | 'unban';

/** POST /posts/:id/live/moderate */
export interface LiveModerateBody {
    key: LiveViewerKey;
    action: LiveModerationAction;
    /** silence: minutes (>= 5, default 5, max 7 days). ban: minutes until it ends — omit for a permanent ban. */
    minutes?: number;
    reason?: string;
}

/** A viewer's own moderation state (welcome + `moderated` events). */
export interface LiveModerationState {
    muted: boolean;
    silencedUntil: string | null;
}

/** A ban from every live show (GET /posts/live/bans). */
export interface LiveBan {
    key: LiveViewerKey;
    name: string;
    handle: string | null;
    anonymous: boolean;
    reason: string | null;
    bannedBy: string | null;
    createdAt: string;
    /** When the ban ends; null = permanent. */
    expiresAt?: string | null;
    /** The show the ban was made in (title), when known. */
    fromShow?: string | null;
}

/** Longest time-limited ban, minutes (365 days). */
export const LIVE_BAN_MAX_MINUTES = 365 * 24 * 60;

/** Minimum silence duration, minutes. */
export const LIVE_SILENCE_MIN_MINUTES = 5;

/** Client → server. `token` = the caller's JWT access token when signed in. */
export type LiveClientCommand =
    | { type: 'join'; token?: string; }
    | { type: 'ping'; }
    | { type: 'chat'; text: string; replyTo?: string; token?: string; }
    /** Toggle the caller's reaction on a chat message (signed in). */
    | { type: 'react_message'; id: string; emoji: string; token?: string; }
    | { type: 'react'; emoji: string; token?: string; }
    // Host commands (staff with `posts:write`):
    | { type: 'start'; token?: string; }
    | { type: 'pause'; token?: string; }
    | { type: 'resume'; token?: string; }
    | { type: 'end'; confirm: true; token?: string; }
    | { type: 'mute'; token?: string; }
    | { type: 'unmute'; token?: string; }
    | { type: 'chat_mode'; mode: LiveChatMode; token?: string; }
    | { type: 'reactions'; enabled: boolean; token?: string; }
    | { type: 'delete_message'; id: string; token?: string; };

export type LiveCommandType = LiveClientCommand['type'];

/** Server → client. */
export type LiveServerEvent =
    | {
        type: 'welcome'; state: LiveRoomState; history: LiveChatMessage[];
        you: {
            userId: string | null; name: string | null; isHost: boolean; canChat: boolean;
            handle?: string | null; canModerate?: boolean; moderation?: LiveModerationState;
        };
    }
    | { type: 'state'; state: LiveRoomState; }
    | { type: 'chat'; message: LiveChatMessage; }
    | { type: 'chat_deleted'; id: string; }
    | { type: 'chat_reactions'; id: string; reactions: Record<string, number>; }
    /** Sent only to the moderated viewer's sockets; `kicked`/`banned` are followed by a 4403 close. */
    | { type: 'moderated'; action: 'muted' | 'unmuted' | 'silenced' | 'unsilenced' | 'kicked' | 'banned'; until?: string | null; message: string; }
    | { type: 'reaction'; emoji: string; userId: string | null; }
    | { type: 'viewers'; count: number; }
    | { type: 'ended'; state: LiveRoomState; }
    | { type: 'pong'; }
    | { type: 'error'; code: LiveErrorCode; message: string; command?: LiveCommandType; };

export type LiveErrorCode =
    | 'unauthorized' | 'forbidden' | 'not_live' | 'chat_off' | 'chat_restricted'
    | 'rate_limited' | 'invalid' | 'ended' | 'not_found' | 'server_error'
    | 'muted' | 'silenced' | 'banned' | 'kicked';

/** Emoji a viewer may send (anything else is refused). */
export const LIVE_REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🔥',] as const;
