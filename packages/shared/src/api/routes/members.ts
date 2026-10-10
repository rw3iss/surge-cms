/**
 * /api/v1/members — public member pages (`/members/:handle`). Core (not
 * feature-gated); the comments list needs the discussions engine.
 */
import type { CommentWithTarget, UserActivity, } from '../../types/discussions';

export interface MembersHandleParams { handle: string; }

/** GET /members/:handle — the public profile. 404 when unknown or hidden. */
export interface MemberProfile {
    id: string;
    handle: string;
    name: string;
    avatarUrl: string | null;
    joinedAt: string;
    /** Only for staff accounts (shown as a badge); null for members. */
    role: string | null;
    /** Current subscription tier name, when any. */
    tierName: string | null;
    bio: string | null;
    /** Zeros when the discussions engine is off. */
    activity: UserActivity;
    /** Comments and/or the Forum are on — show the Comments tab. */
    commentsEnabled: boolean;
    /** The page is hidden from others (only the member or staff see this). */
    hidden: boolean;
}
export type MembersProfileResponse = MemberProfile;

/** GET /members/:handle/comments — their visible comments + forum posts, newest first. */
export interface MembersCommentsQuery {
    page?: number;
    limit?: number;
}
/** Items the viewer may see (gated items are left out). Pagination rides on `meta`. */
export type MembersCommentsResponse = CommentWithTarget[];
