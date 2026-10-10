import type {
    Comment, CommentTargetRef, DiscussionsCommentCreateBody, DiscussionsCommentDeleteResponse, DiscussionsCommentsQuery,
    DiscussionsHistoryResponse, DiscussionsModerationAction, DiscussionsModerationActResponse,
    DiscussionsModerationBulkResponse, DiscussionsModerationCountsResponse, DiscussionsModerationQuery,
    DiscussionItem, DiscussionQuery, DiscussionsReactResponse, DiscussionsReportResponse, DiscussionsSettings, DiscussionsSettingsBody, ModerationItem,
    Paginated,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /discussions — the comment engine behind Comments AND the Forum: comments on
 * any item (`post:<id>`, `event:<id>`, `forum_thread:<id>`), reactions,
 * reports, moderation. 404s when neither feature is on.
 */
export class DiscussionsModule extends ModuleBase {
    protected readonly module = 'discussions';

    /** Top-level comments (paged) with nested `replies`. Never cached: per-viewer. */
    list(target: CommentTargetRef, query: Omit<DiscussionsCommentsQuery, 'target'> = {},): Promise<Paginated<Comment>> {
        return this.getPaged<Comment>('/discussions/comments', {
            query: { target, ...query, } as Record<string, unknown>, options: { cache: false, },
        },);
    }

    /** Post a comment/reply. Anonymous only where the item allows it (pass guestName). */
    create(body: DiscussionsCommentCreateBody,): Promise<Comment> {
        return this.mutate('POST', '/discussions/comments', { body, invalidates: ['discussions',], },);
    }

    update(id: string, body: string,): Promise<Comment> {
        return this.mutate('PUT', '/discussions/comments/:id', { params: { id, }, body: { body, }, invalidates: ['discussions',], },);
    }

    remove(id: string,): Promise<DiscussionsCommentDeleteResponse> {
        return this.mutate('DELETE', '/discussions/comments/:id', { params: { id, }, invalidates: ['discussions',], },);
    }

    /** Toggle one reaction kind. */
    react(id: string, kind: string,): Promise<DiscussionsReactResponse> {
        return this.mutate('POST', '/discussions/comments/:id/reactions', { params: { id, }, body: { kind, }, },);
    }

    report(id: string, reason?: string,): Promise<DiscussionsReportResponse> {
        return this.mutate('POST', '/discussions/comments/:id/report', { params: { id, }, body: { reason, }, },);
    }

    /** Edit history (moderators). */
    history(id: string,): Promise<DiscussionsHistoryResponse> {
        return this.get('/discussions/comments/:id/history', { params: { id, }, options: { cache: false, }, },);
    }

    /** Engine settings — reactions, max length, edit window. */
    settings(): Promise<DiscussionsSettings> {
        return this.get('/discussions/settings', { options: { cache: false, }, },);
    }

    updateSettings(body: DiscussionsSettingsBody,): Promise<DiscussionsSettings> {
        return this.mutate('PUT', '/discussions/settings', { body, invalidates: ['discussions',], },);
    }

    /**
     * Discovery: latest / hot / top comments and forum threads, filtered to
     * what the caller may read. `kind` = comment | thread | both (default);
     * `window` = 24h | 7d | 30d | all. Items are a union on `kind`.
     */
    query(q: DiscussionQuery = {},): Promise<Paginated<DiscussionItem>> {
        return this.getPaged<DiscussionItem>('/discussions/query', { query: q as Record<string, unknown>, },);
    }

    /** Newest comments + threads (`kind` narrows). */
    latest(q: Omit<DiscussionQuery, 'sort'> = {},): Promise<Paginated<DiscussionItem>> {
        return this.query({ ...q, sort: 'latest', },);
    }

    /** Hottest comments + threads — activity weighted by age (default window 7d). */
    hot(q: Omit<DiscussionQuery, 'sort'> = {},): Promise<Paginated<DiscussionItem>> {
        return this.query({ ...q, sort: 'hot', },);
    }

    /** Moderation (staff): the queue, single + bulk actions, badge counts. */
    readonly moderation = {
        list: (query: DiscussionsModerationQuery = {},): Promise<Paginated<ModerationItem>> =>
            this.getPaged<ModerationItem>('/discussions/moderation', { query: query as Record<string, unknown>, options: { cache: false, }, },),
        counts: (scope?: 'all' | 'comments' | 'forum',): Promise<DiscussionsModerationCountsResponse> =>
            this.get('/discussions/moderation/counts', { query: scope ? { scope, } : undefined, options: { cache: false, }, },),
        act: (id: string, action: DiscussionsModerationAction,): Promise<DiscussionsModerationActResponse> =>
            this.mutate('POST', '/discussions/moderation/:id/:action', { params: { id, action, }, invalidates: ['discussions',], },),
        bulk: (ids: string[], action: DiscussionsModerationAction,): Promise<DiscussionsModerationBulkResponse> =>
            this.mutate('POST', '/discussions/moderation/bulk', { body: { ids, action, }, invalidates: ['discussions',], },),
    };
}
