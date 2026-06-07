import type { User, } from '@rw/cms-shared';
import { query, } from '../db';

export type ContentAccessLevel = 'public' | 'member' | 'patron';

export interface ContentAccessResult {
    allowed: boolean;
    reason?: string;
}

/**
 * Check whether a user has access to content at a given access level.
 *
 * - 'public': always allowed
 * - 'member': requires any authenticated user
 * - 'patron': requires user with an active Patreon membership
 */
export async function checkContentAccess(
    accessLevel: ContentAccessLevel,
    user?: User | null,
): Promise<ContentAccessResult> {
    if (accessLevel === 'public') {
        return { allowed: true, };
    }

    if (!user) {
        return {
            allowed: false,
            reason: accessLevel === 'patron' ?
                'This content is available to Patreon supporters only' :
                'Sign in to access this content',
        };
    }

    if (accessLevel === 'member') {
        return { allowed: true, };
    }

    // accessLevel === 'patron'
    // Admins always get access
    if (user.role === 'admin') {
        return { allowed: true, };
    }

    // Check if user has patreon_tier set on their profile
    if (user.patreonTier) {
        return { allowed: true, };
    }

    // Check the patreon_memberships table for an active membership
    const membershipResult = await query(
        `SELECT patron_status FROM patreon_memberships
     WHERE user_id = $1 AND patron_status = 'active_patron'
     LIMIT 1`,
        [user.id,],
    );

    if (membershipResult.rows.length > 0) {
        return { allowed: true, };
    }

    return {
        allowed: false,
        reason: 'This content is available to Patreon supporters only',
    };
}
