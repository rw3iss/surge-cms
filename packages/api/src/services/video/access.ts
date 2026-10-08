/**
 * Who may watch the FULL version of a video.
 *
 * Two levels only (by design — page/post-level gating decides who reaches a
 * page; the video itself only knows public vs private):
 *   public  → everyone
 *   private → `media.private:view` (staff by default; grant it to a
 *             subscription tier to make that tier's members subscribers)
 */
import type { MediaAccessLevel, } from '@sitesurge/types';
import { can, } from '../permissions';

export interface Viewer {
    id?: string | null;
    role?: string | null;
}

export const PRIVATE_VIEW_PERMISSION = 'media.private:view';

export async function canViewPrivate(viewer: Viewer | null | undefined,): Promise<boolean> {
    if (!viewer?.id) return false;
    return can({ id: viewer.id, role: viewer.role ?? null, }, PRIVATE_VIEW_PERMISSION,);
}

export async function canWatchFull(accessLevel: MediaAccessLevel, viewer: Viewer | null | undefined,): Promise<boolean> {
    return accessLevel === 'public' || canViewPrivate(viewer,);
}
