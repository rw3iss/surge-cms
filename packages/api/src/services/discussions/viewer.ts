/** Who is reading or writing: the signed-in user, or nobody. */
import { isStaffRole, } from '@sitesurge/types';
import * as permissions from '../permissions';

export interface Viewer {
    id?: string | null;
    role?: string | null;
}

export const viewerOf = (user: { id?: string; role?: string; } | null | undefined,): Viewer =>
    ({ id: user?.id ?? null, role: user?.role ?? null, });

export const isStaffViewer = (v: Viewer,): boolean => Boolean(v.id,) && isStaffRole(v.role ?? undefined,);

export async function isModerator(v: Viewer,): Promise<boolean> {
    if (!v.id) return false;
    return permissions.can(v, 'discussions:moderate',).catch(() => false);
}
