import type {
    DiscussionQuery, DiscussionThreadItem, ForumAdminThreadsQuery, ForumCategory, ForumCategoryBody, ForumCategoryThreadsResponse, ForumSettings, ForumSettingsBody,
    ForumThread, ForumThreadAction, ForumThreadActResponse, ForumThreadCreateBody, ForumThreadDetail, ForumThreadUpdateBody,
    PageMeta, Paginated,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /forum — categories, threads and the forum settings. A thread's replies are
 * comments: read/write them with `cms.discussions.list('forum_thread:<id>')`
 * / `cms.discussions.create({ target: 'forum_thread:<id>', … })`.
 * 404s when the forum feature is off.
 */
export class ForumModule extends ModuleBase {
    protected readonly module = 'forum';

    settings(): Promise<ForumSettings> {
        return this.get('/forum/settings', { options: { cache: false, }, },);
    }

    updateSettings(body: ForumSettingsBody,): Promise<ForumSettings> {
        return this.mutate('PUT', '/forum/settings', { body, invalidates: ['forum',], },);
    }

    readonly categories = {
        /** Categories the caller may read (counts + latest thread). */
        list: (): Promise<ForumCategory[]> => this.get('/forum/categories', { options: { cache: false, }, },),
        create: (body: ForumCategoryBody,): Promise<ForumCategory> =>
            this.mutate('POST', '/forum/categories', { body, invalidates: ['forum',], },),
        update: (id: string, body: Partial<ForumCategoryBody>,): Promise<ForumCategory> =>
            this.mutate('PUT', '/forum/categories/:id', { params: { id, }, body, invalidates: ['forum',], },),
        remove: (id: string,): Promise<{ deleted: true; }> =>
            this.mutate('DELETE', '/forum/categories/:id', { params: { id, }, invalidates: ['forum',], },),
        reorder: (ids: string[],): Promise<{ reordered: true; }> =>
            this.mutate('POST', '/forum/categories/reorder', { body: { ids, }, invalidates: ['forum',], },),
        /** One category's threads (pinned first, then by last activity). */
        threads: (slug: string, query: { page?: number; limit?: number; } = {},): Promise<{ data: ForumCategoryThreadsResponse; meta: PageMeta; }> =>
            // The payload is one object (category + threads); pagination rides on meta.
            this.getPaged<ForumCategoryThreadsResponse>('/forum/categories/:slug/threads', {
                params: { slug, }, query, options: { cache: false, },
            },) as unknown as Promise<{ data: ForumCategoryThreadsResponse; meta: PageMeta; }>,
    };

    readonly threads = {
        /** The thread page by its URL parts (counts a view). */
        get: (category: string, thread: string,): Promise<ForumThreadDetail> =>
            this.get('/forum/t/:category/:thread', { params: { category, thread, }, options: { cache: false, }, },),
        byId: (id: string,): Promise<ForumThreadDetail> =>
            this.get('/forum/threads/:id', { params: { id, }, options: { cache: false, }, },),
        create: (body: ForumThreadCreateBody,): Promise<ForumThreadDetail> =>
            this.mutate('POST', '/forum/threads', { body, invalidates: ['forum',], },),
        update: (id: string, body: ForumThreadUpdateBody,): Promise<ForumThreadDetail> =>
            this.mutate('PUT', '/forum/threads/:id', { params: { id, }, body, invalidates: ['forum',], },),
        act: (id: string, action: ForumThreadAction,): Promise<ForumThreadActResponse> =>
            this.mutate('POST', '/forum/threads/:id/:action', { params: { id, action, }, invalidates: ['forum',], },),
        /** Newest threads (optionally in one `category`). Shortcut over `cms.discussions.query`. */
        latest: (q: Omit<DiscussionQuery, 'sort' | 'kind'> = {},): Promise<Paginated<DiscussionThreadItem>> =>
            this.getPaged<DiscussionThreadItem>('/discussions/query', { query: { ...q, kind: 'thread', sort: 'latest', } as Record<string, unknown>, },),
        /** Hottest threads (default window 7d). Shortcut over `cms.discussions.query`. */
        hot: (q: Omit<DiscussionQuery, 'sort' | 'kind'> = {},): Promise<Paginated<DiscussionThreadItem>> =>
            this.getPaged<DiscussionThreadItem>('/discussions/query', { query: { ...q, kind: 'thread', sort: 'hot', } as Record<string, unknown>, },),
        /** Every thread (moderators). */
        adminList: (query: ForumAdminThreadsQuery = {},): Promise<Paginated<ForumThread>> =>
            this.getPaged<ForumThread>('/forum/threads', { query: query as Record<string, unknown>, options: { cache: false, }, },),
    };
}
