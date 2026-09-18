/**
 * Cross-process presence for the Admin Channel.
 *
 * The registry holds the connections belonging to THIS process. That was the
 * whole picture while the server was a single process; with `CLUSTER_WORKERS`
 * greater than 1 each worker owns a different slice of the WebSocket
 * connections, so two staff users on two workers would not see each other —
 * which defeats the point of a feature whose job is to warn about concurrent
 * edits. It would fail quietly, too: the roster would simply look short.
 *
 * So each process publishes its own slice to Redis and reads everyone else's.
 *
 * DESIGN NOTES
 *
 * - **A key per process, not a shared list.** A process can die without
 *   cleaning up. Each writes only its own key with a TTL, so a crashed
 *   worker's users disappear on their own instead of haunting the roster
 *   forever. The heartbeat that refreshes the TTL is the liveness signal.
 * - **Publish-then-notify.** The snapshot is written first and the
 *   notification sent second, so a peer woken by the notification always reads
 *   fresh data rather than racing the write.
 * - **Notifications carry no payload.** A peer recomputes from Redis instead of
 *   trusting what it was handed, so a lost or duplicated message can't corrupt
 *   anyone's view — it just causes a redundant recompute.
 * - **Inert unless clustered.** With one process there are no peers, so this
 *   stays switched off and the Admin Channel behaves exactly as before.
 *
 * This is the same shared-state mechanism a multi-NODE deployment needs, so it
 * also removes the single-node restriction the registry used to document.
 */
import type Redis from 'ioredis';
import type { UserRole, } from '@sitesurge/types';
import { getRedis, } from '../cache';
import { logger, } from '../../utils/logger';

/** One process's slice of the roster, as published to Redis. */
export interface PeerConnection {
    connectionId: string;
    userId: string;
    displayName: string;
    email: string;
    // Kept as the real union, not `string`: these round-trip through JSON,
    // and widening here would push a cast onto every consumer.
    role: UserRole;
    page: string | null;
    pageLabel: string | null;
    lastActiveAt: number;
    reportedActive: boolean;
}

const KEY_PREFIX = 'adminchannel:peer:';
const CHANNEL = 'adminchannel:changed';

/** Refresh cadence for our own key. */
const HEARTBEAT_MS = 10_000;
/**
 * TTL on a process's key. Comfortably more than the heartbeat so an ordinary
 * scheduling hiccup does not blink a live worker's users out of the roster,
 * but short enough that a dead worker clears quickly.
 */
const KEY_TTL_MS = HEARTBEAT_MS * 3;

let enabled = false;
let selfId = '';
let subscriber: Redis | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
/** Called when a peer reports a change; set by the channel server. */
let onPeerChange: (() => void) | null = null;
/** Most recent local snapshot, re-published by the heartbeat. */
let lastLocal: PeerConnection[] = [];

export function isEnabled(): boolean {
    return enabled;
}

/**
 * Turn on cross-process presence. Safe to call more than once.
 *
 * `id` must be unique per process; the cluster worker id plus the pid is both
 * unique and recognisable in `redis-cli KEYS`.
 */
export async function initPeers(id: string, onChange: () => void,): Promise<void> {
    if (enabled) return;
    selfId = id;
    onPeerChange = onChange;

    try {
        // A connection in subscriber mode cannot run ordinary commands, so the
        // subscription needs its own.
        subscriber = getRedis().duplicate();
        await subscriber.subscribe(CHANNEL,);
        subscriber.on('message', (_channel, message,) => {
            // Our own notification comes back to us; ignore it, we have already
            // broadcast locally.
            if (message === selfId) return;
            try { onPeerChange?.(); } catch { /* a bad peer must not break us */ }
        },);

        heartbeat = setInterval(() => { void publish(lastLocal,); }, HEARTBEAT_MS,);
        heartbeat.unref();

        enabled = true;
        logger.info(`Admin Channel: cross-process presence enabled (${selfId})`,);
    } catch (err) {
        // Presence is a convenience. If Redis pub/sub is unavailable the
        // channel still works per-process — degraded, not broken.
        logger.warn('Admin Channel: cross-process presence unavailable', {
            error: (err as Error).message,
        },);
        enabled = false;
    }
}

/** Publish this process's slice and wake the others. */
export async function publish(local: PeerConnection[],): Promise<void> {
    lastLocal = local;
    if (!enabled) return;
    try {
        const redis = getRedis();
        const key = `${KEY_PREFIX}${selfId}`;
        if (local.length === 0) {
            // An empty slice is deleted rather than stored, so `KEYS` only ever
            // lists processes that actually hold connections.
            await redis.del(key,);
        } else {
            await redis.set(key, JSON.stringify(local,), 'PX', KEY_TTL_MS,);
        }
        await redis.publish(CHANNEL, selfId,);
    } catch (err) {
        logger.debug('Admin Channel: presence publish failed', { error: (err as Error).message, },);
    }
}

/** Every OTHER process's connections. Never throws — a failure reads as "no peers". */
export async function remoteConnections(): Promise<PeerConnection[]> {
    if (!enabled) return [];
    try {
        const redis = getRedis();
        const keys = await redis.keys(`${KEY_PREFIX}*`,);
        const others = keys.filter((k,) => k !== `${KEY_PREFIX}${selfId}`);
        if (others.length === 0) return [];
        const values = await redis.mget(...others,);
        const out: PeerConnection[] = [];
        for (const v of values) {
            if (!v) continue;
            try {
                const parsed = JSON.parse(v,) as PeerConnection[];
                if (Array.isArray(parsed,)) out.push(...parsed,);
            } catch { /* a corrupt slice is skipped, not fatal */ }
        }
        return out;
    } catch (err) {
        logger.debug('Admin Channel: peer read failed', { error: (err as Error).message, },);
        return [];
    }
}

/** Drop our key so a clean shutdown does not leave users on the roster for a TTL. */
export async function shutdownPeers(): Promise<void> {
    if (heartbeat) clearInterval(heartbeat,);
    heartbeat = null;
    if (!enabled) return;
    enabled = false;
    try {
        await getRedis().del(`${KEY_PREFIX}${selfId}`,);
        await getRedis().publish(CHANNEL, `${selfId}:gone`,);
    } catch { /* shutting down anyway */ }
    try { subscriber?.disconnect(); } catch { /* already closed */ }
    subscriber = null;
}
