/**
 * Admin Channel presence registry — the in-memory source of truth for who is
 * connected to the admin right now. Keyed by CONNECTION (a user may have several
 * tabs); `roster()` aggregates connections down to one entry per user.
 *
 * The map below holds only THIS process's connections. When the server runs
 * more than one process (`CLUSTER_WORKERS`), each owns a different slice of the
 * sockets, so `roster()` merges the local map with every peer's published slice
 * (`peers.ts`). Without that merge two staff users on two workers would not see
 * each other — and it would fail silently, the roster simply looking short.
 *
 * With a single process there are no peers and this behaves exactly as it did
 * when it was purely in-memory.
 */
import type { WebSocket, } from 'ws';
import type { AdminPresenceUser, UserRole, } from '@sitesurge/types';
import { getActiveTimeoutMs, } from './config';
import { remoteConnections, type PeerConnection, } from './peers';

export interface AdminConnection {
    connectionId: string;
    userId: string;
    displayName: string;
    email: string;
    role: UserRole;
    /** Current admin path, or null before the first `hello`. */
    page: string | null;
    /** Human label for `page`, resolved client-side (or null). */
    pageLabel: string | null;
    /** Epoch ms of last activity (navigation / focus / input). */
    lastActiveAt: number;
    /** Last active/inactive signal the client reported (tab focus/idle). */
    reportedActive: boolean;
    socket: WebSocket;
}

const connections = new Map<string, AdminConnection>();

export function addConnection(c: AdminConnection,): void {
    connections.set(c.connectionId, c,);
}

export function removeConnection(connectionId: string,): void {
    connections.delete(connectionId,);
}

/** Update a connection's page/label + mark it active (a navigation IS activity). */
export function touch(connectionId: string, patch: { page?: string | null; label?: string | null; } = {},): void {
    const c = connections.get(connectionId,);
    if (!c) return;
    if (patch.page !== undefined) c.page = patch.page;
    if (patch.label !== undefined) c.pageLabel = patch.label;
    c.reportedActive = true;
    c.lastActiveAt = Date.now();
}

/** Apply an explicit active/inactive signal (tab focus / blur / idle timer). */
export function setReportedActive(connectionId: string, active: boolean,): void {
    const c = connections.get(connectionId,);
    if (!c) return;
    c.reportedActive = active;
    if (active) c.lastActiveAt = Date.now();
}

export function allSockets(): WebSocket[] {
    return [...connections.values(),].map((c,) => c.socket,);
}

export function connectionCount(): number {
    return connections.size;
}

/** This process's slice, in the shape peers publish (no socket — not serialisable). */
export function localSnapshot(): PeerConnection[] {
    return [...connections.values(),].map((c,) => ({
        connectionId: c.connectionId,
        userId: c.userId,
        displayName: c.displayName,
        email: c.email,
        role: c.role,
        page: c.page,
        pageLabel: c.pageLabel,
        lastActiveAt: c.lastActiveAt,
        reportedActive: c.reportedActive,
    }),);
}

/**
 * Aggregate connections into one presence row per user. A user is `active` if
 * ANY of their connections is reported-active AND within the idle timeout; their
 * `page` + `lastActiveAt` come from their most-recently-active connection.
 */
export async function roster(): Promise<AdminPresenceUser[]> {
    const timeoutMs = await getActiveTimeoutMs();
    const now = Date.now();
    const byUser = new Map<string, AdminPresenceUser & { _lastMs: number; }>();

    // Local connections plus every peer process's. Aggregating by userId
    // already handles the same person appearing twice, so a user with tabs on
    // two workers collapses to one row exactly as multiple tabs on one worker do.
    const all: PeerConnection[] = [...localSnapshot(), ...(await remoteConnections()),];

    for (const c of all) {
        const active = c.reportedActive && (now - c.lastActiveAt) <= timeoutMs;
        const existing = byUser.get(c.userId,);
        if (!existing) {
            byUser.set(c.userId, {
                userId: c.userId,
                displayName: c.displayName,
                email: c.email,
                role: c.role,
                page: c.page,
                pageLabel: c.pageLabel,
                lastActiveAt: new Date(c.lastActiveAt,).toISOString(),
                active,
                _lastMs: c.lastActiveAt,
            },);
        } else {
            if (c.lastActiveAt > existing._lastMs) {
                existing.page = c.page;
                existing.pageLabel = c.pageLabel;
                existing._lastMs = c.lastActiveAt;
                existing.lastActiveAt = new Date(c.lastActiveAt,).toISOString();
            }
            existing.active = existing.active || active;
        }
    }

    return [...byUser.values(),]
        .map(({ _lastMs, ...u },) => u)
        .sort((a, b,) => a.displayName.localeCompare(b.displayName,));
}

/** A cheap signature of the roster, so the sweep only broadcasts on change. */
export async function rosterSignature(): Promise<string> {
    const users = await roster();
    return users.map((u,) => `${u.userId}:${u.active ? 1 : 0}:${u.page ?? ''}:${u.pageLabel ?? ''}`).join('|',);
}
