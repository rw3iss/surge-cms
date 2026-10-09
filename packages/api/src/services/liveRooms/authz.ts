/**
 * Live-room command policy — PURE, so the whole authorisation matrix is unit
 * tested without a socket, a database or Redis.
 *
 *   ping / join            anyone, any time (join = re-send the welcome)
 *   chat                   a SIGNED-IN ticket; mode `off` refuses everyone,
 *                          `public`/`members` = any signed-in user,
 *                          `subscribers` = any paid tier (rank > 0) or staff.
 *                          Anonymous viewers may only watch and react.
 *   react                  anyone (anonymous too) while the show is live and
 *                          reactions are on; emoji from LIVE_REACTIONS only
 *   host commands          signed in + `posts.live:host`
 *   delete_message         signed in + `posts.live:chat_moderate`
 *
 * An ended show accepts nothing but `ping`.
 */
import type { LiveChatMode, LiveClientCommand, LiveCommandType, LiveErrorCode, LiveStatus, } from '@sitesurge/types';
import { LIVE_REACTIONS, } from '@sitesurge/types';

export interface LiveIdentity {
    userId: string | null;
    /** `posts.live:host` */
    isHost: boolean;
    /** `posts.live:chat_moderate` */
    canModerate: boolean;
    /** Subscription rank (services/postGate `viewerRank`): Infinity = staff, null = no tier. */
    rank: number | null;
}

export interface LiveRoomPolicyState {
    status: LiveStatus;
    chatMode: LiveChatMode;
    reactionsEnabled: boolean;
}

export type Decision = { ok: true; } | { ok: false; code: LiveErrorCode; message: string; };

const OK: Decision = { ok: true, };
const deny = (code: LiveErrorCode, message: string,): Decision => ({ ok: false, code, message, });

export const HOST_COMMANDS: ReadonlySet<LiveCommandType> = new Set([
    'start', 'pause', 'resume', 'end', 'mute', 'unmute', 'chat_mode', 'reactions',
],);

const CHAT_MODES: readonly LiveChatMode[] = ['off', 'public', 'members', 'subscribers',];

export const CHAT_MAX = 500;

/** Can this identity post chat right now? (Also drives `welcome.you.canChat`.) */
export function chatDecision(id: LiveIdentity, room: LiveRoomPolicyState,): Decision {
    if (room.status === 'ended') return deny('ended', 'The show has ended',);
    if (room.chatMode === 'off') return deny('chat_off', 'Chat is off',);
    if (!id.userId) return deny('unauthorized', 'Sign in to chat',);
    if (room.chatMode === 'subscribers' && !(id.isHost || (id.rank !== null && id.rank > 0))) {
        return deny('chat_restricted', 'Chat is for subscribers only',);
    }
    return OK;
}

export function decideCommand(cmd: LiveClientCommand, id: LiveIdentity, room: LiveRoomPolicyState,): Decision {
    if (cmd.type === 'ping') return OK;
    if (room.status === 'ended') return deny('ended', 'The show has ended',);
    if (cmd.type === 'join') return OK;

    if (HOST_COMMANDS.has(cmd.type,)) {
        if (!id.userId) return deny('unauthorized', 'Sign in to host',);
        if (!id.isHost) return deny('forbidden', 'Only a host can do that',);
        switch (cmd.type) {
            case 'start':
                return room.status === 'idle' ? OK : deny('invalid', `Cannot start a show that is ${room.status}`,);
            case 'pause':
                return room.status === 'live' ? OK : deny('not_live', 'The show is not live',);
            case 'resume':
                return room.status === 'paused' ? OK : deny('invalid', 'The show is not paused',);
            case 'end':
                return cmd.confirm === true ? OK : deny('invalid', 'Ending a show needs confirm: true',);
            case 'chat_mode':
                return CHAT_MODES.includes(cmd.mode,) ? OK : deny('invalid', `mode must be one of ${CHAT_MODES.join(', ',)}`,);
            case 'reactions':
                return typeof cmd.enabled === 'boolean' ? OK : deny('invalid', 'enabled must be a boolean',);
            default:
                return OK; // mute / unmute
        }
    }

    switch (cmd.type) {
        case 'chat':
            return chatDecision(id, room,);
        case 'react':
            if (!(LIVE_REACTIONS as readonly string[]).includes(cmd.emoji,)) return deny('invalid', 'Unknown reaction',);
            if (!room.reactionsEnabled) return deny('forbidden', 'Reactions are off',);
            if (room.status !== 'live') return deny('not_live', 'The show is not live',);
            return OK;
        case 'delete_message':
            if (!id.userId) return deny('unauthorized', 'Sign in to moderate',);
            if (!id.canModerate) return deny('forbidden', 'Only a moderator can delete messages',);
            return typeof cmd.id === 'string' && cmd.id ? OK : deny('invalid', 'id is required',);
        default:
            return deny('invalid', 'Unknown command',);
    }
}

/** Trim + length-check a chat message. Raw text is sent; clients render it as TEXT. */
export function validateChatText(text: unknown,): { ok: true; text: string; } | { ok: false; message: string; } {
    if (typeof text !== 'string') return { ok: false, message: 'text is required', };
    // Drop control characters except newlines/tabs.
    const t = text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '',).trim();
    if (t.length < 1) return { ok: false, message: 'Message is empty', };
    if (t.length > CHAT_MAX) return { ok: false, message: `Message is longer than ${CHAT_MAX} characters`, };
    return { ok: true, text: t, };
}

/** Parse + shape-check a raw socket message. */
export function parseCommand(raw: string,): LiveClientCommand | null {
    let v: unknown;
    try {
        v = JSON.parse(raw,);
    } catch {
        return null;
    }
    if (!v || typeof v !== 'object' || typeof (v as { type?: unknown; }).type !== 'string') return null;
    return v as LiveClientCommand;
}
