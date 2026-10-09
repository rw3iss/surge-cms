/**
 * Who may see a live room, and what an identity may do in it.
 */
import { isStaffRole, } from '@sitesurge/types';
import { can, } from '../permissions';
import { gateFor, tiersById, viewerRank, } from '../postGate/index';
import { loadWsUser, type WsUser, } from '../ws/upgrade';
import type { LiveIdentity, } from './authz';
import { isLivePost, type LivePostRow, } from './state';

export type ViewAccess = 'ok' | 'not_found' | 'unauthorized' | 'forbidden';

type Viewer = { id: string; role: string; } | null | undefined;

/** May this viewer watch the room? (Ended shows are handled by the caller.) */
export async function viewAccess(row: LivePostRow | null, user: Viewer,): Promise<ViewAccess> {
    if (!row || !isLivePost(row,)) return 'not_found';
    const staff = !!user && isStaffRole(user.role,);
    if (row.status !== 'published' && !staff) return 'not_found';
    if (row.isPrivate && !user) return 'unauthorized';
    if (row.requiredTierId && !staff) {
        const rank = await viewerRank(user ? { id: user.id, role: user.role as never, } : null,);
        const gate = gateFor(row, rank, await tiersById(),);
        if (gate.state === 'locked') return gate.requiredTier && !user ? 'unauthorized' : 'forbidden';
    }
    return 'ok';
}

export async function isHost(user: Viewer,): Promise<boolean> {
    if (!user) return false;
    return can({ id: user.id, role: user.role, }, 'posts.live:host',);
}

const IDENTITY_TTL_MS = 30_000;
const identityCache = new Map<string, { at: number; value: { identity: LiveIdentity; user: WsUser | null; }; }>();

/**
 * Resolve a ticket's user id to a live identity (permissions + rank). Cached
 * for 30s per user so a busy chat does not run three permission checks per
 * message. A banned/deactivated user resolves to anonymous.
 */
export async function identityFor(userId: string | null,): Promise<{ identity: LiveIdentity; user: WsUser | null; }> {
    const anon = { identity: { userId: null, isHost: false, canModerate: false, rank: null, }, user: null, };
    if (!userId) return anon;
    const hit = identityCache.get(userId,);
    if (hit && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.value;
    const user = await loadWsUser(userId,);
    if (!user) return anon;
    const subject = { id: user.id, role: user.role, };
    const [host, moderate, rank,] = await Promise.all([
        can(subject, 'posts.live:host',),
        can(subject, 'posts.live:chat_moderate',),
        viewerRank({ id: user.id, role: user.role as never, },),
    ],);
    const value = { identity: { userId: user.id, isHost: host, canModerate: moderate, rank, }, user, };
    identityCache.set(userId, { at: Date.now(), value, },);
    if (identityCache.size > 5000) identityCache.clear();
    return value;
}
