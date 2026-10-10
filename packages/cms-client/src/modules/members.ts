import type { CommentWithTarget, MemberProfile, MembersCommentsQuery, Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /members — public member pages (`/members/:handle`). */
export class MembersModule extends ModuleBase {
    protected readonly module = 'members';

    /** A member's public profile (404 when unknown or hidden). */
    profile(handle: string,): Promise<MemberProfile> {
        return this.get<MemberProfile>('/members/:handle', { params: { handle, }, options: { cache: false, }, },);
    }

    /** Their visible comments + forum posts, newest first (gated items left out). */
    comments(handle: string, query: MembersCommentsQuery = {},): Promise<Paginated<CommentWithTarget>> {
        return this.getPaged<CommentWithTarget>('/members/:handle/comments', {
            params: { handle, }, query: query as Record<string, unknown>, options: { cache: false, },
        },);
    }
}
