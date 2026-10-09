/**
 * Live room WebSocket — `/ws/live?post=<postId>` (LIVE_ROOM_PATH).
 *
 * Upgrade: the session cookie (optional — anonymous viewers may watch) decides
 * whether the viewer may SEE the room (live-type, published or staff, not
 * private-for-anonymous, not subscription-locked). Refusals happen AFTER the
 * handshake, as an `error` event + a close code the client can act on:
 *   4400 bad request · 4401 sign in needed · 4403 locked / not allowed
 *   4404 not a live post · 4410 the show has ended (an `ended` event first)
 *
 * Commands: every command is authorised by ITS OWN `token` (a ticket from
 * `POST /posts/:id/live/ticket`), not by the socket's cookie. No token =
 * anonymous. A bad command answers `{type:'error', code, message, command}`
 * and never closes the socket.
 *
 * Fan-out: events go to this process's sockets directly and to other workers
 * through Redis (`store.ts`).
 */
import { randomUUID, } from 'crypto';
import type { Server, } from 'http';
import type { Socket, } from 'net';
import { WebSocket, WebSocketServer, } from 'ws';
import type { LiveChatMessage, LiveClientCommand, LiveCommandType, LiveErrorCode, LiveServerEvent, } from '@sitesurge/types';
import { LIVE_ROOM_PATH, } from '@sitesurge/types';
import { config, } from '../../config';
import { logger, } from '../../utils/logger';
import { registerUpgrade, userFromUpgrade, } from '../ws/upgrade';
import { identityFor, isHost, viewAccess, } from './access';
import { chatDecision, decideCommand, HOST_COMMANDS, parseCommand, validateChatText, } from './authz';
import { chatLimiter, reactionLimiter, } from './rateLimit';
import { applyHostCommand, effectiveStatus, loadLivePost, toState, type LivePostRow, } from './state';
import * as store from './store';
import { verifyTicket, } from './tickets';

export const CLOSE = { badRequest: 4400, unauthorized: 4401, forbidden: 4403, notFound: 4404, ended: 4410, } as const;

interface Conn {
    id: string;
    ws: WebSocket & { isAlive?: boolean; };
    postId: string;
}

let wss: WebSocketServer | null = null;
const rooms = new Map<string, Set<Conn>>();
const chatRate = chatLimiter();
const reactRate = reactionLimiter();
let heartbeat: ReturnType<typeof setInterval> | null = null;
const viewerTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Per-process cache of the room row, refreshed on every state event. */
const rowCache = new Map<string, { at: number; row: LivePostRow; }>();
const ROW_TTL_MS = 5_000;

async function roomRow(postId: string, fresh = false,): Promise<LivePostRow | null> {
    const hit = rowCache.get(postId,);
    if (!fresh && hit && Date.now() - hit.at < ROW_TTL_MS) return hit.row;
    const row = await loadLivePost(postId,);
    if (row) rowCache.set(postId, { at: Date.now(), row, },);
    else rowCache.delete(postId,);
    return row;
}

function send(ws: WebSocket, event: LiveServerEvent,): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event,),);
}

function sendError(ws: WebSocket, code: LiveErrorCode, message: string, command?: LiveCommandType,): void {
    send(ws, { type: 'error', code, message, ...(command ? { command, } : {}), },);
}

/** Deliver to this process's sockets in the room (no Redis). */
function deliverLocal(postId: string, event: LiveServerEvent,): void {
    const room = rooms.get(postId,);
    if (!room) return;
    const payload = JSON.stringify(event,);
    for (const c of room) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload,);
    if (event.type === 'state' || event.type === 'ended') {
        rowCache.delete(postId,);
    }
    if (event.type === 'ended') {
        for (const c of [...room,]) c.ws.close(CLOSE.ended, 'ended',);
    }
}

/** Deliver everywhere: our sockets, then the other workers. */
async function broadcast(postId: string, event: LiveServerEvent,): Promise<void> {
    deliverLocal(postId, event,);
    await store.publish(postId, event,);
}

/** Recount viewers (debounced per room) and tell every process's sockets. */
function scheduleViewers(postId: string,): void {
    if (viewerTimers.has(postId,)) return;
    viewerTimers.set(postId, setTimeout(() => {
        viewerTimers.delete(postId,);
        void (async () => {
            await store.setLocalViewers(postId, rooms.get(postId,)?.size ?? 0,);
            const count = await store.totalViewers(postId,);
            await broadcast(postId, { type: 'viewers', count, },);
        })();
    }, 500,),);
}

async function stateEvent(row: LivePostRow,): Promise<LiveServerEvent> {
    const state = toState(row, await store.totalViewers(row.id,),);
    return state.status === 'ended' ? { type: 'ended', state, } : { type: 'state', state, };
}

async function handleCommand(conn: Conn, raw: string,): Promise<void> {
    const cmd = parseCommand(raw,);
    if (!cmd) return sendError(conn.ws, 'invalid', 'Malformed command',);
    if (cmd.type === 'ping') return send(conn.ws, { type: 'pong', },);

    const token = (cmd as { token?: unknown; }).token;
    let userId: string | null = null;
    if (token !== undefined && token !== null && token !== '') {
        const t = verifyTicket(conn.postId, token,);
        if (!t) return sendError(conn.ws, 'unauthorized', 'Ticket expired or invalid — fetch a new one', cmd.type,);
        userId = t.userId;
    }
    const { identity, user, } = await identityFor(userId,);

    const row = await roomRow(conn.postId, HOST_COMMANDS.has(cmd.type,),);
    if (!row) return sendError(conn.ws, 'not_found', 'Room not found', cmd.type,);
    const status = effectiveStatus(row,);
    const policy = toState(row, 0,);
    const decision = decideCommand(cmd, identity, { status, chatMode: policy.chatMode, reactionsEnabled: policy.reactionsEnabled, },);
    if (!decision.ok) return sendError(conn.ws, decision.code, decision.message, cmd.type,);

    switch (cmd.type) {
        case 'join': {
            const history = await store.getHistory(conn.postId,);
            send(conn.ws, {
                type: 'welcome',
                state: toState(row, await store.totalViewers(conn.postId,),),
                history,
                you: {
                    userId: identity.userId,
                    name: user?.displayName || null,
                    isHost: identity.isHost,
                    canChat: chatDecision(identity, { status, chatMode: policy.chatMode, reactionsEnabled: policy.reactionsEnabled, },).ok,
                },
            },);
            return;
        }
        case 'chat': {
            const v = validateChatText(cmd.text,);
            if (!v.ok) return sendError(conn.ws, 'invalid', v.message, 'chat',);
            if (!chatRate.take(identity.userId!,)) return sendError(conn.ws, 'rate_limited', 'Slow down', 'chat',);
            const message: LiveChatMessage = {
                id: randomUUID(),
                userId: identity.userId,
                name: user?.displayName || 'Member',
                role: user?.role ?? null,
                text: v.text,
                at: new Date().toISOString(),
            };
            await store.pushHistory(conn.postId, message,);
            await broadcast(conn.postId, { type: 'chat', message, },);
            return;
        }
        case 'react': {
            if (!reactRate.take(identity.userId ?? `anon:${conn.id}`,)) return sendError(conn.ws, 'rate_limited', 'Slow down', 'react',);
            await broadcast(conn.postId, { type: 'reaction', emoji: cmd.emoji, userId: identity.userId, },);
            return;
        }
        case 'delete_message': {
            await store.deleteHistory(conn.postId, cmd.id,);
            await broadcast(conn.postId, { type: 'chat_deleted', id: cmd.id, },);
            return;
        }
        default: {
            // Host commands (already authorised): write the row, re-read, broadcast.
            const next = await applyHostCommand(conn.postId, cmd as LiveClientCommand,);
            if (!next) return sendError(conn.ws, 'not_found', 'Room not found', cmd.type,);
            rowCache.set(conn.postId, { at: Date.now(), row: next, },);
            await broadcast(conn.postId, await stateEvent(next,),);
        }
    }
}

function onConnection(ws: Conn['ws'], postId: string, welcome: LiveServerEvent,): void {
    const conn: Conn = { id: randomUUID(), ws, postId, };
    let room = rooms.get(postId,);
    if (!room) rooms.set(postId, (room = new Set()),);
    room.add(conn,);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; },);
    send(ws, welcome,);
    scheduleViewers(postId,);

    ws.on('message', (data,) => {
        void handleCommand(conn, data.toString(),).catch((err,) => {
            logger.warn('Live room command failed', { postId, error: (err as Error).message, },);
            sendError(ws, 'server_error', 'Something went wrong',);
        },);
    },);
    const leave = () => {
        const r = rooms.get(postId,);
        if (!r?.delete(conn,)) return;
        if (r.size === 0) rooms.delete(postId,);
        scheduleViewers(postId,);
    };
    ws.on('close', leave,);
    ws.on('error', leave,);
}

/** Accept the handshake, send one event, then close with `code`. */
function rejectAfterHandshake(ws: WebSocket, code: number, event: LiveServerEvent,): void {
    send(ws, event,);
    ws.close(code, event.type,);
}

function startHeartbeat(): void {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
        for (const room of rooms.values()) {
            for (const c of room) {
                if (c.ws.isAlive === false) {
                    c.ws.terminate();
                    continue;
                }
                c.ws.isAlive = false;
                try { c.ws.ping(); } catch { /* ignore */ }
            }
        }
        void store.refreshViewers();
        chatRate.prune();
        reactRate.prune();
    }, 15_000,);
    heartbeat.unref?.();
}

/** Attach the live-room endpoint to the HTTP server. Idempotent. */
export function attachLiveRooms(server: Server,): void {
    if (wss) return;
    if (config.clusterWorkers > 1) {
        void store.initFanout(`w${process.env.NODE_APP_WORKER_ID ?? process.pid}`, deliverLocal,);
    }
    wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024, },);

    registerUpgrade(server, LIVE_ROOM_PATH, (req, socket, head, url,) => {
        void (async () => {
            const postId = url.searchParams.get('post',) ?? '';
            const [user, row,] = await Promise.all([userFromUpgrade(req,), loadLivePost(postId,).catch(() => null),],);
            const access = await viewAccess(row, user,).catch(() => 'not_found' as const);
            wss!.handleUpgrade(req, socket as Socket, head, (ws,) => {
                void (async () => {
                    if (!postId) return rejectAfterHandshake(ws, CLOSE.badRequest, { type: 'error', code: 'invalid', message: 'post is required', },);
                    if (access === 'not_found' || !row) {
                        return rejectAfterHandshake(ws, CLOSE.notFound, { type: 'error', code: 'not_found', message: 'No live show here', },);
                    }
                    if (access === 'unauthorized') {
                        return rejectAfterHandshake(ws, CLOSE.unauthorized, { type: 'error', code: 'unauthorized', message: 'Sign in to watch', },);
                    }
                    if (access === 'forbidden') {
                        return rejectAfterHandshake(ws, CLOSE.forbidden, { type: 'error', code: 'forbidden', message: 'This show is for subscribers', },);
                    }
                    const viewers = await store.totalViewers(row.id,);
                    if (effectiveStatus(row,) === 'ended') {
                        return rejectAfterHandshake(ws, CLOSE.ended, { type: 'ended', state: toState(row, viewers,), },);
                    }
                    const { identity, } = await identityFor(user?.id ?? null,);
                    const state = toState(row, viewers,);
                    const welcome: LiveServerEvent = {
                        type: 'welcome',
                        state,
                        history: await store.getHistory(row.id,),
                        you: {
                            userId: user?.id ?? null,
                            name: user?.displayName || null,
                            isHost: user ? await isHost(user,) : false,
                            canChat: chatDecision(identity, state,).ok,
                        },
                    };
                    onConnection(ws as Conn['ws'], row.id, welcome,);
                })().catch((err,) => {
                    logger.warn('Live room connect failed', { error: (err as Error).message, },);
                    try { ws.close(1011, 'server_error',); } catch { /* gone */ }
                },);
            },);
        })();
    },);
    startHeartbeat();
    logger.info(`Live rooms WebSocket attached at ${LIVE_ROOM_PATH}`,);
}

export async function shutdownLiveRooms(): Promise<void> {
    if (heartbeat) clearInterval(heartbeat,);
    heartbeat = null;
    for (const room of rooms.values()) for (const c of room) try { c.ws.close(1001, 'shutdown',); } catch { /* gone */ }
    await store.shutdownStore();
}
