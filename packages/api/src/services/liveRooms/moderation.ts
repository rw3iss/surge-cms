/**
 * Live-room moderation — who is watching, and what a moderator did to them.
 *
 *   live:presence:<postId>  hash — `<connId> → JSON PresenceEntry` (one field
 *                           per socket, every process; re-stamped on the
 *                           heartbeat, stale entries of a dead worker ignored)
 *   live:mod:<postId>       hash — `<viewerKey> → JSON ModEntry` (mute /
 *                           silence / kick for THIS show)
 *   live_bans (table)       bans from EVERY live show, by user, guest key or
 *                           guest IP hash (a guest who clears localStorage
 *                           gets a new key but keeps the IP)
 *   live:mr:<postId>        hash — `<msgId>|<emoji>|<userId>` toggles, and
 *   live:mrc:<postId>       hash — `<msgId>|<emoji>` → count (chat reactions)
 *
 * Viewer key: `u:<userId>` signed in, `a:<anonId>` guest (`?anon=` on connect).
 * Redis is a convenience: when it is down, this process's memory stands in.
 */
import { createHash, } from 'crypto';
import type { IncomingMessage, } from 'http';
import type { LiveModerationState, LiveViewer, } from '@sitesurge/types';
import { config, } from '../../config';
import { query, } from '../../db';
import { getRedis, } from '../cache';

const PRESENCE_FRESH_MS = 45_000;
const ROOM_TTL_SEC = 7 * 86400;

const K = {
    presence: (postId: string,) => `live:presence:${postId}`,
    mod: (postId: string,) => `live:mod:${postId}`,
    msgReact: (postId: string,) => `live:mr:${postId}`,
    msgReactCount: (postId: string,) => `live:mrc:${postId}`,
};

// ─── Viewer identity ─────────────────────────────────────────────

const ANON_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** The moderation key for a socket. A missing/odd guest id gets a per-socket one. */
export function viewerKey(userId: string | null, anonId: string | null, connId: string,): string {
    if (userId) return `u:${userId}`;
    return `a:${anonId && ANON_RE.test(anonId,) ? anonId : `c-${connId}`}`;
}

export function guestName(key: string,): string {
    return `Guest ${key.slice(-4,).toUpperCase()}`;
}

/** The client IP behind Cloudflare/nginx, hashed (never stored raw). */
export function ipHashOf(req: IncomingMessage,): string | null {
    const h = req.headers;
    const first = (v: string | string[] | undefined,) => (Array.isArray(v,) ? v[0] : v)?.split(',',)[0]?.trim();
    const ip = first(h['cf-connecting-ip'],) || first(h['x-real-ip'],) || first(h['x-forwarded-for'],) || req.socket.remoteAddress;
    if (!ip) return null;
    return createHash('sha256',).update(`live-ip:${config.jwt.secret}:${ip}`,).digest('hex',).slice(0, 32,);
}

// ─── Presence ────────────────────────────────────────────────────

export interface PresenceEntry extends Omit<LiveViewer, 'muted' | 'silencedUntil'> {
    ipHash: string | null;
    at: number;
}

const localPresence = new Map<string, Map<string, PresenceEntry>>();

export async function putPresence(postId: string, e: PresenceEntry,): Promise<void> {
    let m = localPresence.get(postId,);
    if (!m) localPresence.set(postId, (m = new Map()),);
    m.set(e.connId, e,);
    try {
        await getRedis().multi().hset(K.presence(postId,), e.connId, JSON.stringify(e,),).expire(K.presence(postId,), 3600,).exec();
    } catch { /* local copy stands in */ }
}

export async function dropPresence(postId: string, connId: string,): Promise<void> {
    const m = localPresence.get(postId,);
    m?.delete(connId,);
    if (m && m.size === 0) localPresence.delete(postId,);
    try { await getRedis().hdel(K.presence(postId,), connId,); } catch { /* ignore */ }
}

/** Re-stamp this process's entries (heartbeat). */
export async function refreshPresence(): Promise<void> {
    const now = Date.now();
    for (const [postId, m,] of localPresence) {
        for (const e of m.values()) {
            e.at = now;
            await putPresence(postId, e,);
        }
    }
}

export async function presence(postId: string,): Promise<PresenceEntry[]> {
    const local = [...(localPresence.get(postId,)?.values() ?? []),];
    try {
        const all = await getRedis().hgetall(K.presence(postId,),);
        const now = Date.now();
        const byId = new Map(local.map((e,) => [e.connId, e,]),);
        for (const v of Object.values(all,)) {
            try {
                const e = JSON.parse(v,) as PresenceEntry;
                if (!byId.has(e.connId,) && now - e.at < PRESENCE_FRESH_MS) byId.set(e.connId, e,);
            } catch { /* skip */ }
        }
        return [...byId.values(),];
    } catch {
        return local;
    }
}

// ─── Per-show moderation ─────────────────────────────────────────

export interface ModEntry {
    muted?: boolean;
    /** epoch ms */
    silencedUntil?: number | null;
    kicked?: boolean;
}

const localMod = new Map<string, Map<string, ModEntry>>();

export async function getMods(postId: string,): Promise<Map<string, ModEntry>> {
    try {
        const all = await getRedis().hgetall(K.mod(postId,),);
        const out = new Map<string, ModEntry>();
        for (const [k, v,] of Object.entries(all,)) {
            try { out.set(k, JSON.parse(v,) as ModEntry,); } catch { /* skip */ }
        }
        return out;
    } catch {
        return new Map(localMod.get(postId,) ?? [],);
    }
}

export async function getMod(postId: string, key: string,): Promise<ModEntry> {
    try {
        const v = await getRedis().hget(K.mod(postId,), key,);
        return v ? JSON.parse(v,) as ModEntry : {};
    } catch {
        return localMod.get(postId,)?.get(key,) ?? {};
    }
}

export async function setMod(postId: string, key: string, entry: ModEntry,): Promise<void> {
    const empty = !entry.muted && !entry.kicked && !(entry.silencedUntil && entry.silencedUntil > Date.now());
    let m = localMod.get(postId,);
    if (!m) localMod.set(postId, (m = new Map()),);
    if (empty) m.delete(key,);
    else m.set(key, entry,);
    try {
        const r = getRedis();
        if (empty) await r.hdel(K.mod(postId,), key,);
        else await r.multi().hset(K.mod(postId,), key, JSON.stringify(entry,),).expire(K.mod(postId,), ROOM_TTL_SEC,).exec();
    } catch { /* local copy stands in */ }
}

/** A viewer's state as the client sees it (expired silences read as none). */
export function modState(e: ModEntry | undefined, now = Date.now(),): LiveModerationState {
    const until = e?.silencedUntil && e.silencedUntil > now ? new Date(e.silencedUntil,).toISOString() : null;
    return { muted: !!e?.muted, silencedUntil: until, };
}

/** Which keys does a command's sender answer to? (socket key + ticket user). */
export function keysFor(connKey: string, userId: string | null,): string[] {
    const u = userId ? `u:${userId}` : null;
    return u && u !== connKey ? [connKey, u,] : [connKey,];
}

export type ModRefusal = { code: 'muted' | 'silenced'; message: string; } | null;

/**
 * PURE — may this sender chat / react? Silence blocks everything; mute blocks chat.
 */
export function moderationRefusal(entries: ModEntry[], what: 'chat' | 'react', now = Date.now(),): ModRefusal {
    for (const e of entries) {
        if (e.silencedUntil && e.silencedUntil > now) {
            const mins = Math.max(1, Math.ceil((e.silencedUntil - now) / 60_000,),);
            return { code: 'silenced', message: `A moderator silenced you — ${mins} min left`, };
        }
    }
    if (what === 'chat' && entries.some((e,) => e.muted)) return { code: 'muted', message: 'A moderator muted you in this chat', };
    return null;
}

// ─── Global bans ─────────────────────────────────────────────────

interface BanSets { users: Set<string>; anon: Set<string>; ips: Set<string>; at: number; }
let bans: BanSets | null = null;
const BAN_TTL_MS = 30_000;

async function banSets(): Promise<BanSets> {
    if (bans && Date.now() - bans.at < BAN_TTL_MS) return bans;
    const r = await query<{ user_id: string | null; anon_key: string | null; ip_hash: string | null; }>(
        `SELECT user_id, anon_key, ip_hash FROM live_bans`,
    );
    const next: BanSets = { users: new Set(), anon: new Set(), ips: new Set(), at: Date.now(), };
    for (const b of r.rows) {
        if (b.user_id) next.users.add(b.user_id,);
        if (b.anon_key) next.anon.add(b.anon_key,);
        if (b.ip_hash) next.ips.add(b.ip_hash,);
    }
    bans = next;
    return next;
}

/** Banned from every live show? An IP ban applies to guests only (shared IPs). */
export async function isBanned(key: string, ipHash: string | null,): Promise<boolean> {
    try {
        const s = await banSets();
        if (key.startsWith('u:',)) return s.users.has(key.slice(2,),);
        return s.anon.has(key,) || (!!ipHash && s.ips.has(ipHash,));
    } catch {
        return false; // fail open: a DB blip must not lock everyone out
    }
}

export async function addBan(key: string, ipHash: string | null, by: string | null, reason: string | null,): Promise<void> {
    if (key.startsWith('u:',)) {
        await query(
            `INSERT INTO live_bans (user_id, reason, created_by) VALUES ($1, $2, $3)
             ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE SET reason = EXCLUDED.reason`,
            [key.slice(2,), reason, by,],
        );
    } else {
        await query(`INSERT INTO live_bans (anon_key, ip_hash, reason, created_by) VALUES ($1, $2, $3, $4)`, [key, ipHash, reason, by,],);
    }
    bans = null;
}

export async function removeBan(key: string,): Promise<void> {
    if (key.startsWith('u:',)) await query(`DELETE FROM live_bans WHERE user_id = $1`, [key.slice(2,),],);
    else await query(`DELETE FROM live_bans WHERE anon_key = $1`, [key,],);
    bans = null;
}

// ─── Chat message reactions ──────────────────────────────────────

const localReact = new Map<string, Set<string>>();
const localReactCount = new Map<string, Map<string, number>>();

/** Toggle a user's emoji on a message; returns the message's new counts. */
export async function toggleMessageReaction(postId: string, msgId: string, emoji: string, userId: string,): Promise<Record<string, number>> {
    const field = `${msgId}|${emoji}|${userId}`;
    const countField = `${msgId}|${emoji}`;
    try {
        const r = getRedis();
        const added = await r.hsetnx(K.msgReact(postId,), field, '1',);
        if (added) await r.hincrby(K.msgReactCount(postId,), countField, 1,);
        else {
            await r.hdel(K.msgReact(postId,), field,);
            const n = await r.hincrby(K.msgReactCount(postId,), countField, -1,);
            if (n <= 0) await r.hdel(K.msgReactCount(postId,), countField,);
        }
        await r.multi().expire(K.msgReact(postId,), ROOM_TTL_SEC,).expire(K.msgReactCount(postId,), ROOM_TTL_SEC,).exec();
    } catch {
        let set = localReact.get(postId,);
        if (!set) localReact.set(postId, (set = new Set()),);
        let counts = localReactCount.get(postId,);
        if (!counts) localReactCount.set(postId, (counts = new Map()),);
        if (set.has(field,)) {
            set.delete(field,);
            counts.set(countField, Math.max(0, (counts.get(countField,) ?? 1) - 1,),);
        } else {
            set.add(field,);
            counts.set(countField, (counts.get(countField,) ?? 0) + 1,);
        }
    }
    return (await messageReactions(postId,)).get(msgId,) ?? {};
}

/** msgId → { emoji → count } for a room. */
export async function messageReactions(postId: string,): Promise<Map<string, Record<string, number>>> {
    let raw: Record<string, string | number>;
    try {
        raw = await getRedis().hgetall(K.msgReactCount(postId,),);
    } catch {
        raw = Object.fromEntries(localReactCount.get(postId,) ?? [],);
    }
    const out = new Map<string, Record<string, number>>();
    for (const [f, v,] of Object.entries(raw,)) {
        const n = Number(v,);
        if (!(n > 0)) continue;
        const [msgId, emoji,] = f.split('|',);
        const rec = out.get(msgId,) ?? {};
        rec[emoji] = n;
        out.set(msgId, rec,);
    }
    return out;
}
