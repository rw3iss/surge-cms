/**
 * Forum access levels. A viewer's LEVEL is comparable with the subscription
 * tier ranks: anonymous = -1, a signed-in member with no paid tier = 0 (Free),
 * a subscriber = their tier's rank, staff = Infinity. The forum's read rule
 * and every category's read/post minimum compare against it.
 */
import type { ForumSettings, } from '@sitesurge/types';
import { viewerRank, } from '../postGate';
import { isStaffViewer, type Viewer, } from '../discussions/viewer';

export async function viewerLevel(v: Viewer,): Promise<number> {
    if (!v.id) return -1;
    if (isStaffViewer(v,)) return Infinity;
    const rank = await viewerRank(v as never,).catch(() => null);
    return Math.max(0, rank ?? 0,);
}

/** The forum-wide read floor as a level. */
export function forumReadFloor(s: ForumSettings,): number {
    return s.readAccess === 'public' ? -1 : s.readAccess === 'members' ? 0 : s.readMinRank;
}

export interface CategoryRanks { read_min_rank: number | null; post_min_rank: number | null; locked: boolean; }

export function canReadCategory(level: number, s: ForumSettings, c: CategoryRanks,): boolean {
    return level >= Math.max(forumReadFloor(s,), c.read_min_rank ?? -1,);
}

/** May start threads here (permission checked separately). */
export function canPostCategory(level: number, s: ForumSettings, c: CategoryRanks,): boolean {
    if (level === Infinity) return true;
    if (c.locked || level < 0) return false;
    return canReadCategory(level, s, c,) && level >= Math.max(s.threadMinRank, c.post_min_rank ?? 0,);
}

export function canReplyCategory(level: number, s: ForumSettings, c: CategoryRanks,): boolean {
    if (level === Infinity) return true;
    if (c.locked || level < 0) return false;
    return canReadCategory(level, s, c,) && level >= Math.max(s.replyMinRank, c.post_min_rank ?? 0,);
}
