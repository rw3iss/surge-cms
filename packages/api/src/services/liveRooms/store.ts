/**
 * Cross-process live-room plumbing over Redis (same client pattern as
 * services/adminChannel/peers.ts — the raw client stays inside this module):
 *
 *   live:room:<postId>     pub/sub channel — every room event, fanned out to
 *                          the other serving workers (`{ o: originId, e }`;
 *                          a process ignores its own messages because it has
 *                          already delivered locally). Only subscribed when
 *                          CLUSTER_WORKERS > 1.
 *   live:chat:<postId>     list — the last 50 chat messages (newest first)
 *   live:viewers:<postId>  hash — `<processId> → "<count>:<updatedAtMs>"`;
 *                          stale fields (a dead worker) are ignored when summed
 *
 * Redis is a convenience here: when it is down, history falls back to this
 * process's memory and the viewer count to the local one.
 */
import type Redis from 'ioredis';
import type { LiveChatMessage, LiveServerEvent, } from '@sitesurge/types';
import { getRedis, } from '../cache';
import { logger, } from '../../utils/logger';

export const LIVE_KEYS = {
    channel: (postId: string,) => `live:room:${postId}`,
    channelPattern: 'live:room:*',
    history: (postId: string,) => `live:chat:${postId}`,
    viewers: (postId: string,) => `live:viewers:${postId}`,
} as const;

export const HISTORY_MAX = 50;
const HISTORY_TTL_SEC = 7 * 86400;
const VIEWER_FRESH_MS = 45_000;
const VIEWER_TTL_SEC = 3600;

let selfId = `p${process.pid}`;
let subscriber: Redis | null = null;
let fanout = false;
const localHistory = new Map<string, LiveChatMessage[]>();

export function processId(): string {
    return selfId;
}

/** Subscribe to other workers' room events (clustered only). Never throws. */
export async function initFanout(id: string, onRemote: (postId: string, event: LiveServerEvent,) => void,): Promise<void> {
    selfId = id;
    if (fanout) return;
    try {
        subscriber = getRedis().duplicate();
        await subscriber.psubscribe(LIVE_KEYS.channelPattern,);
        subscriber.on('pmessage', (_p, channel, message,) => {
            try {
                const { o, e, } = JSON.parse(message,) as { o: string; e: LiveServerEvent; };
                if (o === selfId) return;
                onRemote(channel.slice('live:room:'.length,), e,);
            } catch { /* a bad message must not break the room */ }
        },);
        fanout = true;
        logger.info(`Live rooms: cross-process fan-out enabled (${selfId})`,);
    } catch (err) {
        logger.warn('Live rooms: cross-process fan-out unavailable', { error: (err as Error).message, },);
    }
}

export async function publish(postId: string, event: LiveServerEvent,): Promise<void> {
    if (!fanout) return;
    try {
        await getRedis().publish(LIVE_KEYS.channel(postId,), JSON.stringify({ o: selfId, e: event, },),);
    } catch (err) {
        logger.debug('Live rooms: publish failed', { error: (err as Error).message, },);
    }
}

// ─── Chat history ────────────────────────────────────────────────

export async function pushHistory(postId: string, msg: LiveChatMessage,): Promise<void> {
    const mem = [msg, ...(localHistory.get(postId,) ?? []),].slice(0, HISTORY_MAX,);
    localHistory.set(postId, mem,);
    try {
        const r = getRedis();
        const key = LIVE_KEYS.history(postId,);
        await r.multi().lpush(key, JSON.stringify(msg,),).ltrim(key, 0, HISTORY_MAX - 1,).expire(key, HISTORY_TTL_SEC,).exec();
    } catch { /* memory copy stands in */ }
}

/** Oldest first. */
export async function getHistory(postId: string,): Promise<LiveChatMessage[]> {
    try {
        const rows = await getRedis().lrange(LIVE_KEYS.history(postId,), 0, HISTORY_MAX - 1,);
        const out: LiveChatMessage[] = [];
        for (const r of rows) {
            try { out.push(JSON.parse(r,) as LiveChatMessage,); } catch { /* skip */ }
        }
        return out.reverse();
    } catch {
        return [...(localHistory.get(postId,) ?? []),].reverse();
    }
}

/** Remove one message by id. Returns true when it existed. */
export async function deleteHistory(postId: string, id: string,): Promise<boolean> {
    const mem = localHistory.get(postId,) ?? [];
    let found = mem.some((m,) => m.id === id);
    localHistory.set(postId, mem.filter((m,) => m.id !== id),);
    try {
        const r = getRedis();
        const key = LIVE_KEYS.history(postId,);
        const rows = await r.lrange(key, 0, -1,);
        for (const row of rows) {
            try {
                if ((JSON.parse(row,) as LiveChatMessage).id === id) {
                    await r.lrem(key, 1, row,);
                    found = true;
                }
            } catch { /* skip */ }
        }
    } catch { /* memory copy stands in */ }
    return found;
}

// ─── Viewers ─────────────────────────────────────────────────────

const localViewers = new Map<string, number>();

export async function setLocalViewers(postId: string, count: number,): Promise<void> {
    if (count > 0) localViewers.set(postId, count,);
    else localViewers.delete(postId,);
    try {
        const r = getRedis();
        const key = LIVE_KEYS.viewers(postId,);
        if (count > 0) {
            await r.multi().hset(key, selfId, `${count}:${Date.now()}`,).expire(key, VIEWER_TTL_SEC,).exec();
        } else {
            await r.hdel(key, selfId,);
        }
    } catch { /* local count stands in */ }
}

/** Sum of every live process's viewers for a room. */
export async function totalViewers(postId: string,): Promise<number> {
    try {
        const all = await getRedis().hgetall(LIVE_KEYS.viewers(postId,),);
        const now = Date.now();
        let sum = 0;
        for (const [field, v,] of Object.entries(all,)) {
            const [count, at,] = v.split(':',).map(Number,);
            if (field === selfId) continue; // ours is authoritative locally
            if (now - at < VIEWER_FRESH_MS) sum += count || 0;
        }
        return sum + (localViewers.get(postId,) ?? 0);
    } catch {
        return localViewers.get(postId,) ?? 0;
    }
}

/** Re-stamp this process's viewer fields (heartbeat). */
export async function refreshViewers(): Promise<void> {
    for (const [postId, count,] of localViewers) await setLocalViewers(postId, count,);
}

export async function shutdownStore(): Promise<void> {
    for (const postId of [...localViewers.keys(),]) await setLocalViewers(postId, 0,);
    try { subscriber?.disconnect(); } catch { /* closing anyway */ }
    subscriber = null;
    fanout = false;
}
