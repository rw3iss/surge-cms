/**
 * Live room client — the WebSocket at `LIVE_ROOM_PATH?post=<id>` (see
 * `@sitesurge/types` `types/liveRoom.ts`). Framework-free: used by the public
 * live show (`components/live/LiveShow`) AND the admin live console.
 *
 *   - Fetches a room ticket (`cms.posts.liveTicket`) before connecting and
 *     refreshes it ~2 minutes before it expires. EVERY outgoing command carries
 *     the current ticket as `token` (the server authorises each command by its
 *     sender; the session cookie is httpOnly, so page JS cannot send the JWT).
 *   - Sends `join` on every open, pings every 25s.
 *   - Reconnects with backoff (1s → 30s) unless `close()` was called or the
 *     show ended (an `ended` event, or an `ended` error) — ended shows have no
 *     room, so reconnecting would only loop.
 *   - Queues commands while not open; chat older than 10s is dropped on flush
 *     (a stale message arriving minutes later reads as a bug).
 *   - Never throws to the caller: problems surface as a synthetic
 *     `{ type: 'error', code: 'server_error', message }` event.
 */
import { LIVE_ROOM_PATH, type LiveClientCommand, type LiveServerEvent, } from '@sitesurge/types';
import { cms, } from './cmsClient';

/** `Omit` that distributes over a union (plain `Omit` collapses it). */
export type DistributiveOmit<T, K extends PropertyKey,> = T extends unknown ? Omit<T, K> : never;

export type LiveRoomStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface LiveRoomOptions {
    onEvent: (e: LiveServerEvent,) => void;
    onStatus?: (s: LiveRoomStatus,) => void;
}

export interface LiveRoomConnection {
    send: (cmd: DistributiveOmit<LiveClientCommand, 'token'>,) => void;
    close: () => void;
}

export const PING_INTERVAL_MS = 25_000;
export const TICKET_REFRESH_LEAD_MS = 2 * 60_000;
export const MIN_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;
export const CHAT_QUEUE_MAX_AGE_MS = 10_000;
/** Retry delay when a ticket fetch fails. */
const TICKET_RETRY_MS = 30_000;
/** Never schedule a refresh sooner than this (a clock-skewed `expiresAt`). */
const MIN_REFRESH_DELAY_MS = 5_000;

type OutCommand = DistributiveOmit<LiveClientCommand, 'token'>;

function roomUrl(postId: string,): string {
    const loc = (globalThis as { location?: Location; }).location;
    const proto = loc?.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${loc?.host ?? ''}${LIVE_ROOM_PATH}?post=${encodeURIComponent(postId,)}`;
}

export function connectLiveRoom(postId: string, opts: LiveRoomOptions,): LiveRoomConnection {
    let ws: WebSocket | null = null;
    let closed = false;
    let ended = false;
    let attempt = 0;
    let token: string | undefined;
    let tokenExpiresAt = 0;
    let ticketTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const queue: { cmd: OutCommand; at: number; }[] = [];

    const emit = (e: LiveServerEvent,) => {
        try {
            opts.onEvent(e,);
        } catch (err) {
            console.warn('[liveRoom] onEvent handler threw', err,);
        }
    };
    const fail = (message: string,) => emit({ type: 'error', code: 'server_error', message, },);
    const setStatus = (s: LiveRoomStatus,) => {
        try {
            opts.onStatus?.(s,);
        } catch (err) {
            console.warn('[liveRoom] onStatus handler threw', err,);
        }
    };
    const done = () => closed || ended;

    const clearTimers = () => {
        if (ticketTimer) clearTimeout(ticketTimer,);
        if (pingTimer) clearInterval(pingTimer,);
        if (reconnectTimer) clearTimeout(reconnectTimer,);
        ticketTimer = pingTimer = reconnectTimer = null;
    };

    const scheduleTicket = (delay: number,) => {
        if (ticketTimer) clearTimeout(ticketTimer,);
        ticketTimer = setTimeout(() => void refreshTicket(), delay,);
    };

    /** Fetch a ticket and schedule the next refresh. Resolves false on failure. */
    const refreshTicket = async (): Promise<boolean> => {
        if (done()) return false;
        try {
            const t = await cms.posts.liveTicket(postId,);
            if (done()) return false;
            token = t.token;
            tokenExpiresAt = new Date(t.expiresAt,).getTime() || Date.now() + TICKET_REFRESH_LEAD_MS * 2;
            scheduleTicket(Math.max(MIN_REFRESH_DELAY_MS, tokenExpiresAt - Date.now() - TICKET_REFRESH_LEAD_MS,),);
            return true;
        } catch (err) {
            if (done()) return false;
            fail(`Could not get a live room ticket: ${err instanceof Error ? err.message : String(err,)}`,);
            scheduleTicket(TICKET_RETRY_MS,);
            return false;
        }
    };

    const rawSend = (cmd: OutCommand,) => {
        try {
            ws!.send(JSON.stringify(token ? { ...cmd, token, } : cmd,),);
        } catch (err) {
            fail(`Could not send "${cmd.type}": ${err instanceof Error ? err.message : String(err,)}`,);
        }
    };

    const flushQueue = () => {
        const now = Date.now();
        const pending = queue.splice(0,);
        for (const { cmd, at, } of pending) {
            // join is re-sent on every open; a stale ping is pointless.
            if (cmd.type === 'join' || cmd.type === 'ping') continue;
            if (cmd.type === 'chat' && now - at > CHAT_QUEUE_MAX_AGE_MS) continue;
            rawSend(cmd,);
        }
    };

    const scheduleReconnect = () => {
        if (done()) return;
        setStatus('reconnecting',);
        const delay = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** attempt,);
        attempt++;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void open();
        }, delay,);
    };

    const finish = () => {
        clearTimers();
        queue.length = 0;
        const sock = ws;
        ws = null;
        if (sock && (sock.readyState === 0 || sock.readyState === 1)) {
            try {
                sock.close(1000,);
            } catch { /* already closing */ }
        }
        setStatus('closed',);
    };

    const open = async () => {
        if (done()) return;
        // A ticket that lapsed while we were disconnected must be renewed first.
        if (!token || Date.now() >= tokenExpiresAt - MIN_REFRESH_DELAY_MS) await refreshTicket();
        if (done()) return;
        let sock: WebSocket;
        try {
            sock = new WebSocket(roomUrl(postId,),);
        } catch (err) {
            fail(`Could not open the live room: ${err instanceof Error ? err.message : String(err,)}`,);
            scheduleReconnect();
            return;
        }
        ws = sock;
        sock.addEventListener('open', () => {
            if (ws !== sock) return;
            attempt = 0;
            setStatus('open',);
            rawSend({ type: 'join', },);
            flushQueue();
            if (pingTimer) clearInterval(pingTimer,);
            pingTimer = setInterval(() => {
                if (ws === sock && sock.readyState === 1) rawSend({ type: 'ping', },);
            }, PING_INTERVAL_MS,);
        },);
        sock.addEventListener('message', (msg: MessageEvent,) => {
            if (ws !== sock) return;
            let event: LiveServerEvent;
            try {
                event = JSON.parse(String(msg.data,),) as LiveServerEvent;
            } catch {
                return;
            }
            if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;
            const terminal = event.type === 'ended' || (event.type === 'error' && event.code === 'ended');
            emit(event,);
            if (terminal && !ended) {
                ended = true;
                finish();
            }
        },);
        // No 'error' listener: a 'close' always follows and handles the reconnect.
        sock.addEventListener('close', (ev: CloseEvent,) => {
            if (ws !== sock) return;
            ws = null;
            if (pingTimer) clearInterval(pingTimer,);
            pingTimer = null;
            if (done()) return;
            // 44xx = the server REFUSED the join (no such live post 4404, ended
            // 4410, sign-in needed 4401, tier too low 4403, bad request 4400).
            // It already sent the reason as an event; retrying would only loop.
            if (ev && ev.code >= 4400 && ev.code < 4500) {
                ended = true;
                finish();
                return;
            }
            scheduleReconnect();
        },);
    };

    setStatus('connecting',);
    void open();

    return {
        send(cmd,) {
            if (done()) return;
            if (ws && ws.readyState === 1) rawSend(cmd,);
            else queue.push({ cmd, at: Date.now(), },);
        },
        close() {
            if (closed) return;
            closed = true;
            if (!ended) finish();
        },
    };
}
