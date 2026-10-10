/**
 * GET /api/v1/discussions/query — discovery over comments and forum threads:
 * latest / hot / top lists to show anywhere (home page, sidebars, newsletters,
 * entity blocks, `{{ hotThreads(5) }}`). Every item is filtered by what the
 * viewer may read (gated posts, private forum categories).
 * Plan: docs/plans/completed/2026-10-10-comments-and-forum.md → "Discovery".
 */
import type { CommentAuthor, CommentWithTarget, } from '../../types/discussions';

export type DiscussionQueryKind = 'comment' | 'thread' | 'both';
export type DiscussionQuerySort = 'latest' | 'hot' | 'top';
export type DiscussionQueryWindow = '24h' | '7d' | '30d' | 'all';

export interface DiscussionQuery {
    /** Default `both`. */
    kind?: DiscussionQueryKind;
    /** Default `latest`. `hot` = activity weighted by age; `top` = most replies + reactions. */
    sort?: DiscussionQuerySort;
    /** Default `7d` for hot/top, `all` for latest. */
    window?: DiscussionQueryWindow;
    /** Comments on one target type (`post`, `event`, `forum_thread`). */
    targetType?: string;
    /** …and one item (needs `targetType`). */
    targetId?: string;
    /** Forum category slug (threads, and replies inside them). */
    category?: string;
    /** Author's public handle. */
    author?: string;
    /** One thread by slug or id (what `{{forumThread('slug')}}` uses). */
    thread?: string;
    minReactions?: number;
    /** Include replies (not just top-level comments). Default true. */
    includeReplies?: boolean;
    page?: number;
    /** ≤ 50. Default 10. */
    limit?: number;
}

/** A comment in a discovery list. `url` = the item URL + `#comment-<id>`. */
export interface DiscussionCommentItem extends CommentWithTarget {
    kind: 'comment';
    url: string;
    /** The hot score (sort = hot) or activity total (top); 0 for latest. */
    score: number;
}

/** A forum thread in a discovery list. */
export interface DiscussionThreadItem {
    kind: 'thread';
    id: string;
    title: string;
    slug: string;
    url: string;
    category: { slug: string; name: string; };
    author: CommentAuthor;
    /** Plain-text excerpt of the opening post (≤ 200 chars). */
    excerpt: string;
    replyCount: number;
    viewCount: number;
    reactionCount: number;
    pinned: boolean;
    locked: boolean;
    lastReplyAt: string | null;
    createdAt: string;
    score: number;
}

export type DiscussionItem = DiscussionCommentItem | DiscussionThreadItem;

/** Items; pagination rides on `meta` (`total` is an upper bound — items the
 *  viewer may not read are dropped after counting). */
export type DiscussionsQueryResponse = DiscussionItem[];
