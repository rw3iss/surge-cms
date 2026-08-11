/**
 * Admin Channel WebSocket server — attached to the main HTTP server on
 * `/ws/admin`. Staff-only: the upgrade is authenticated from the `accessToken`
 * cookie (same JWT the REST API uses) and rejected for non-staff roles.
 *
 * Protocol (JSON): the client sends `hello`/`navigate`/`active`/`inactive`/
 * `list`/`ping`; the server replies `welcome` (once, with the idle timeout),
 * then fans out `presence` (the full roster) to every connection on any change.
 * A periodic sweep pings for liveness AND re-broadcasts when derived active/idle
 * state changes (so an idle transition propagates even if a client goes silent).
 */
import { randomUUID, } from 'crypto';
import type { IncomingMessage, Server, } from 'http';
import type { Socket, } from 'net';
import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer, } from 'ws';
import {
    ADMIN_CHANNEL_PATH,
    type AdminChannelClientMessage,
    isStaffRole,
    type UserRole,
} from '@sitesurge/types';
import { config, } from '../../config';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { getActiveTimeoutMs, } from './config';
import * as registry from './registry';

let wss: WebSocketServer | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let lastSignature = '';

interface AuthedUser {
    userId: string;
    displayName: string;
    email: string;
    role: UserRole;
}

/** Liveness flag stashed on each socket for the heartbeat sweep. */
interface LiveSocket extends WebSocket {
    isAlive?: boolean;
}

function parseCookies(header?: string,): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(';',)) {
        const i = part.indexOf('=',);
        if (i === -1) continue;
        const k = part.slice(0, i,).trim();
        if (!k) continue;
        out[k] = decodeURIComponent(part.slice(i + 1,).trim(),);
    }
    return out;
}

/** Verify the upgrade's cookie JWT → a staff user, or null to reject. */
async function authenticateUpgrade(req: IncomingMessage,): Promise<AuthedUser | null> {
    try {
        const token = parseCookies(req.headers.cookie,).accessToken;
        if (!token || !config.jwt.secret) return null;
        const decoded = jwt.verify(token, config.jwt.secret,) as { userId: string; };
        const r = await query<Record<string, unknown>>(
            `SELECT id, email, display_name, role, is_active, is_banned FROM users WHERE id = $1`,
            [decoded.userId,],
        );
        const row = r.rows[0];
        if (!row || !row.is_active || row.is_banned) return null;
        if (!isStaffRole(row.role as string,)) return null;
        return {
            userId: row.id as string,
            displayName: (row.display_name as string) || 'User',
            email: (row.email as string) || '',
            role: row.role as UserRole,
        };
    } catch {
        return null;
    }
}

function send(ws: WebSocket, payload: unknown,): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload,),);
}

async function broadcastPresence(): Promise<void> {
    const users = await registry.roster();
    const payload = JSON.stringify({ type: 'presence', users, },);
    for (const ws of registry.allSockets()) {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload,);
    }
    lastSignature = users.map((u,) => `${u.userId}:${u.active ? 1 : 0}:${u.page ?? ''}:${u.pageLabel ?? ''}`).join('|',);
}

/** Heartbeat (drop dead sockets) + re-broadcast when active/idle state drifts. */
function startSweep(): void {
    if (sweepTimer) return;
    sweepTimer = setInterval(() => {
        void (async () => {
            for (const ws of registry.allSockets() as LiveSocket[]) {
                if (ws.isAlive === false) {
                    ws.terminate();
                    continue;
                }
                ws.isAlive = false;
                try { ws.ping(); } catch { /* ignore */ }
            }
            const sig = await registry.rosterSignature();
            if (sig !== lastSignature) await broadcastPresence();
        })();
    }, 10_000,);
    sweepTimer.unref?.();
}

async function onConnection(ws: LiveSocket, user: AuthedUser,): Promise<void> {
    const connectionId = randomUUID();
    registry.addConnection({
        connectionId,
        userId: user.userId,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        page: null,
        pageLabel: null,
        lastActiveAt: Date.now(),
        reportedActive: true,
        socket: ws,
    },);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; },);

    const [timeoutMs, rosterNow,] = await Promise.all([getActiveTimeoutMs(), registry.roster(),],);
    const self = rosterNow.find((u,) => u.userId === user.userId,) ?? {
        userId: user.userId, displayName: user.displayName, email: user.email, role: user.role,
        page: null, lastActiveAt: new Date().toISOString(), active: true,
    };
    send(ws, { type: 'welcome', self: { ...self, isSelf: true, }, activeTimeoutMs: timeoutMs, },);
    await broadcastPresence();

    ws.on('message', (raw,) => {
        void (async () => {
            let msg: AdminChannelClientMessage;
            try {
                msg = JSON.parse(raw.toString(),) as AdminChannelClientMessage;
            } catch {
                return;
            }
            switch (msg.type) {
                case 'hello':
                case 'navigate':
                    registry.touch(connectionId, { page: msg.page ?? null, label: msg.label ?? null, },);
                    await broadcastPresence();
                    break;
                case 'active':
                    registry.setReportedActive(connectionId, true,);
                    await broadcastPresence();
                    break;
                case 'inactive':
                    registry.setReportedActive(connectionId, false,);
                    await broadcastPresence();
                    break;
                case 'list':
                    send(ws, { type: 'presence', users: await registry.roster(), },);
                    break;
                case 'ping':
                    send(ws, { type: 'pong', },);
                    break;
            }
        })();
    },);

    ws.on('close', () => {
        registry.removeConnection(connectionId,);
        void broadcastPresence();
    },);
    ws.on('error', () => {
        registry.removeConnection(connectionId,);
    },);
}

/** Attach the channel to the HTTP server. Idempotent. */
export function attachAdminChannel(server: Server,): void {
    if (wss) return;
    wss = new WebSocketServer({ noServer: true, },);
    server.on('upgrade', (req, socket, head,) => {
        let pathname = '';
        try {
            pathname = new URL(req.url ?? '', 'http://localhost',).pathname;
        } catch {
            pathname = req.url ?? '';
        }
        if (pathname !== ADMIN_CHANNEL_PATH) return; // not ours — leave for others

        void (async () => {
            const user = await authenticateUpgrade(req,);
            if (!user) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n',);
                socket.destroy();
                return;
            }
            wss!.handleUpgrade(req, socket as Socket, head, (ws,) => {
                void onConnection(ws as LiveSocket, user,);
            },);
        })();
    },);
    startSweep();
    logger.info(`Admin Channel WebSocket attached at ${ADMIN_CHANNEL_PATH}`,);
}
