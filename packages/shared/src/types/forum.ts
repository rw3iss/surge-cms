/**
 * Forum — categories and threads. A thread's opening post and its replies are
 * discussion comments (`target_type = 'forum_thread'`), so they share editing,
 * reactions, moderation and activity counts with Comments.
 * Plan: docs/plans/completed/2026-10-10-comments-and-forum.md
 */
import type { Comment, CommentAuthor, } from './discussions';

/** Who may read the forum at all. */
export type ForumReadAccess = 'public' | 'members' | 'tier';

export interface ForumSettings {
    title: string;
    description: string;
    /** public = anyone; members = signed in; tier = subscription rank ≥ readMinRank. */
    readAccess: ForumReadAccess;
    readMinRank: number;
    /** Minimum subscription rank to start threads / reply (0 = any signed-in member). */
    threadMinRank: number;
    replyMinRank: number;
    /** Hold every new thread + reply for approval. */
    approveAll: boolean;
    /** Hold a member's posts for approval until they have N approved forum posts (0 = off). */
    approveUntil: number;
    threadsPerPage: number;
    postsPerPage: number;
    showActivityCounts: boolean;
}

export const DEFAULT_FORUM_SETTINGS: ForumSettings = {
    title: 'Forum',
    description: '',
    readAccess: 'public',
    readMinRank: 0,
    threadMinRank: 0,
    replyMinRank: 0,
    approveAll: false,
    approveUntil: 0,
    threadsPerPage: 25,
    postsPerPage: 20,
    showActivityCounts: true,
};

export interface ForumCategory {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    sortOrder: number;
    parentId: string | null;
    /** Minimum subscription rank to read / post here (null = the forum default). */
    readMinRank: number | null;
    postMinRank: number | null;
    locked: boolean;
    threadCount: number;
    postCount: number;
    lastPostAt: string | null;
    lastThread: { id: string; slug: string; title: string; author: string | null; } | null;
    /** For the current viewer. */
    canPost: boolean;
}

export type ForumThreadStatus = 'visible' | 'pending' | 'hidden' | 'deleted';

export interface ForumThread {
    id: string;
    categoryId: string;
    category: { id: string; slug: string; name: string; };
    slug: string;
    title: string;
    /** `/forum/<category>/<thread>` */
    url: string;
    author: CommentAuthor;
    status: ForumThreadStatus;
    pinned: boolean;
    locked: boolean;
    replyCount: number;
    viewCount: number;
    reactionCount: number;
    lastReplyAt: string | null;
    lastReplyBy: { name: string; handle: string | null; } | null;
    createdAt: string;
    updatedAt: string;
    /** Plain-text start of the opening post (lists). */
    excerpt: string;
}

/** A thread page: the thread + its opening post. Replies come from cms.discussions.list(`forum_thread:<id>`). */
export interface ForumThreadDetail extends ForumThread {
    opening: Comment | null;
    canReply: boolean;
    canEdit: boolean;
    canModerate: boolean;
    /** Why the viewer cannot reply (locked, tier, signed out). */
    replyBlockedReason: string | null;
}
