/**
 * ONE `upgrade` dispatcher for every WebSocket endpoint on the HTTP server.
 *
 * Each endpoint (`/ws/admin`, `/ws/live`, …) registers a handler for its exact
 * pathname. A single `server.on('upgrade')` listener routes by pathname, so two
 * endpoints can never fight over a socket, and an upgrade to an unknown path is
 * refused instead of hanging until the client times out (only when no other,
 * foreign `upgrade` listener exists — something outside this module may still
 * own that path).
 *
 * Also hosts the cookie-JWT identity lookup every endpoint authenticates with.
 */
import type { IncomingMessage, Server, } from 'http';
import type { Duplex, } from 'stream';
import jwt from 'jsonwebtoken';
import { config, } from '../../config';
import { query, } from '../../db';

export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer, url: URL,) => void;

const handlers = new Map<string, UpgradeHandler>();
const attached = new WeakSet<Server>();

export function registerUpgrade(server: Server, pathname: string, handler: UpgradeHandler,): void {
    handlers.set(pathname, handler,);
    if (attached.has(server,)) return;
    attached.add(server,);
    const dispatch = (req: IncomingMessage, socket: Duplex, head: Buffer,) => {
        let url: URL;
        try {
            url = new URL(req.url ?? '', 'http://localhost',);
        } catch {
            url = new URL('http://localhost/',);
        }
        const h = handlers.get(url.pathname,);
        if (h) {
            h(req, socket, head, url,);
            return;
        }
        // Not ours. Refuse only when nobody else listens for upgrades.
        if (server.listenerCount('upgrade',) <= 1) {
            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n',);
            socket.destroy();
        }
    };
    server.on('upgrade', dispatch,);
}

/** Refuse an upgrade with a plain HTTP status. */
export function refuseUpgrade(socket: Duplex, status: number, text: string,): void {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`,);
    socket.destroy();
}

export function parseCookies(header?: string,): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(';',)) {
        const i = part.indexOf('=',);
        if (i === -1) continue;
        const k = part.slice(0, i,).trim();
        if (!k) continue;
        try {
            out[k] = decodeURIComponent(part.slice(i + 1,).trim(),);
        } catch {
            out[k] = part.slice(i + 1,).trim();
        }
    }
    return out;
}

export interface WsUser {
    id: string;
    userId: string;
    displayName: string;
    email: string;
    role: string;
}

/** Load an active, unbanned user by id (null otherwise). */
export async function loadWsUser(userId: string,): Promise<WsUser | null> {
    try {
        const r = await query<Record<string, unknown>>(
            `SELECT id, email, display_name, role, is_active, is_banned FROM users WHERE id = $1`,
            [userId,],
        );
        const row = r.rows[0];
        if (!row || !row.is_active || row.is_banned) return null;
        return {
            id: row.id as string,
            userId: row.id as string,
            displayName: (row.display_name as string) || '',
            email: (row.email as string) || '',
            role: row.role as string,
        };
    } catch {
        return null;
    }
}

/** The upgrade's `accessToken` cookie JWT → its user, or null (anonymous / invalid). */
export async function userFromUpgrade(req: IncomingMessage,): Promise<WsUser | null> {
    try {
        const token = parseCookies(req.headers.cookie,).accessToken;
        if (!token || !config.jwt.secret) return null;
        const decoded = jwt.verify(token, config.jwt.secret,) as { userId: string; };
        return await loadWsUser(decoded.userId,);
    } catch {
        return null;
    }
}
