import type {
    DiscussionCommentItem, DiscussionQuery, Paginated,
    CommentsSettings, CommentsSettingsBody, CommentsThreadUpdateBody, CommentThreadSettings,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /comments — the Comments feature: an item's switches (Enable commenting,
 * Allow anonymous, Lock) and the feature settings. Comment CRUD itself is
 * `cms.discussions`. 404s when the feature is off.
 */
export class CommentsModule extends ModuleBase {
    protected readonly module = 'comments';

    /** An item's switches + comment count (`targetType` = `post` | `event`). */
    thread(targetType: string, targetId: string,): Promise<CommentThreadSettings> {
        return this.get('/comments/threads/:targetType/:targetId', { params: { targetType, targetId, }, options: { cache: false, }, },);
    }

    updateThread(targetType: string, targetId: string, body: CommentsThreadUpdateBody,): Promise<CommentThreadSettings> {
        return this.mutate('PUT', '/comments/threads/:targetType/:targetId', {
            params: { targetType, targetId, }, body, invalidates: ['comments',],
        },);
    }

    /** Newest comments site-wide (or on `targetType` / `targetId`). Shortcut over `cms.discussions.query`. */
    latest(q: Omit<DiscussionQuery, 'sort' | 'kind'> = {},): Promise<Paginated<DiscussionCommentItem>> {
        return this.getPaged<DiscussionCommentItem>('/discussions/query', {
            query: { ...q, kind: 'comment', sort: 'latest', } as Record<string, unknown>,
        },);
    }

    /** Hottest comments (default window 7d). Shortcut over `cms.discussions.query`. */
    hot(q: Omit<DiscussionQuery, 'sort' | 'kind'> = {},): Promise<Paginated<DiscussionCommentItem>> {
        return this.getPaged<DiscussionCommentItem>('/discussions/query', {
            query: { ...q, kind: 'comment', sort: 'hot', } as Record<string, unknown>,
        },);
    }

    settings(): Promise<CommentsSettings> {
        return this.get('/comments/settings', { options: { cache: false, }, },);
    }

    updateSettings(body: CommentsSettingsBody,): Promise<CommentsSettings> {
        return this.mutate('PUT', '/comments/settings', { body, invalidates: ['comments',], },);
    }
}
