/**
 * Live room protocol — the WebSocket at `LIVE_ROOM_PATH?post=<postId>`.
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
    role: string | null;
    text: string;
    at: string;
}

/** Client → server. `token` = the caller's JWT access token when signed in. */
export type LiveClientCommand =
    | { type: 'join'; token?: string; }
    | { type: 'ping'; }
    | { type: 'chat'; text: string; token?: string; }
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
    | { type: 'welcome'; state: LiveRoomState; history: LiveChatMessage[]; you: { userId: string | null; name: string | null; isHost: boolean; canChat: boolean; }; }
    | { type: 'state'; state: LiveRoomState; }
    | { type: 'chat'; message: LiveChatMessage; }
    | { type: 'chat_deleted'; id: string; }
    | { type: 'reaction'; emoji: string; userId: string | null; }
    | { type: 'viewers'; count: number; }
    | { type: 'ended'; state: LiveRoomState; }
    | { type: 'pong'; }
    | { type: 'error'; code: LiveErrorCode; message: string; command?: LiveCommandType; };

export type LiveErrorCode =
    | 'unauthorized' | 'forbidden' | 'not_live' | 'chat_off' | 'chat_restricted'
    | 'rate_limited' | 'invalid' | 'ended' | 'not_found' | 'server_error';

/** Emoji a viewer may send (anything else is refused). */
export const LIVE_REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🔥',] as const;
