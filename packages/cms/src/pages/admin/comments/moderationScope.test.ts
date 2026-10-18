import { describe, expect, it, } from 'vitest';
import { isForumOnlyModerator, moderationViewScope, } from './moderationScope';

describe('moderation view scope', () => {
    it('a forum-only moderator opens on the forum view', () => {
        expect(isForumOnlyModerator({ 'forum:moderate': true, },),).toBe(true,);
        expect(moderationViewScope(undefined, true,),).toBe('forum',);
    });
    it('a full moderator keeps the URL scope (comments by default)', () => {
        expect(isForumOnlyModerator({ 'forum:moderate': true, 'discussions:moderate': true, },),).toBe(false,);
        expect(isForumOnlyModerator(null,),).toBe(false,);
        expect(moderationViewScope(undefined, false,),).toBe('comments',);
        expect(moderationViewScope('forum', false,),).toBe('forum',);
    });
});
