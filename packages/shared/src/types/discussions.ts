/**
 * Discussions — the shared engine behind Comments and the Forum.
 *
 * A comment belongs to a TARGET (`targetType` + `targetId`): a post, an event,
 * a forum thread, or any entity type later. Replies nest via `parentId`. A
 * forum thread's opening post and its replies are comments too, so editing,
 * reactions, moderation and activity counts are one implementation.
 * Plan: docs/plans/2026-10-10-comments-and-forum.md
 */

/** visible · pending (awaiting approval) · hidden (moderated) · deleted (soft). */
export type CommentStatus = 'visible' | 'pending' | 'hidden' | 'deleted';

/** Target types the engine knows. Any entity type key may be added later. */
export type CommentTargetType = 'post' | 'event' | 'forum_thread' | (string & {});

/** `post:<uuid>` — the compact target reference used on the wire. */
export type CommentTargetRef = `${string}:${string}`;

/** Who wrote a comment, as shown on its author card. */
export interface CommentAuthor {
    /** NULL for an anonymous (guest) comment or a deleted account. */
    id: string | null;
    name: string;
    /** Public member page handle (`/members/:handle`); null for guests or a hidden page. */
    handle: string | null;
    avatarUrl: string | null;
    /** Built-in or custom role key (shown as a badge for staff). */
    role: string | null;
    /** Name of the member's current subscription tier, when they have one. */
    tierName: string | null;
    /** Visible comments + forum threads + forum replies across the site. */
    activityCount: number;
    joinedAt: string | null;
    isGuest: boolean;
}

export interface Comment {
    id: string;
    targetType: CommentTargetType;
    targetId: string;
    parentId: string | null;
    rootId: string | null;
    depth: number;
    author: CommentAuthor;
    /** Markdown source; null when deleted. Returned to the author/staff for editing. */
    body: string | null;
    /** Rendered (safe) HTML of the body; null when deleted. */
    bodyHtml: string | null;
    status: CommentStatus;
    /** The first post of a forum thread. */
    isOpening: boolean;
    editedAt: string | null;
    editCount: number;
    /** Reaction kind → count. */
    reactions: Record<string, number>;
    /** Reaction kinds the current viewer has applied. */
    myReactions: string[];
    replyCount: number;
    createdAt: string;
    /** May the current viewer edit / delete it. */
    canEdit: boolean;
    canDelete: boolean;
    /** Nested replies (list endpoints return a tree under each top-level comment). */
    replies?: Comment[];
}

/** What a comment is attached to, for lists shown away from the item. */
export interface CommentTargetSummary {
    type: CommentTargetType;
    id: string;
    title: string;
    /** Public URL of the item (the comment adds `#comment-<id>`). */
    url: string;
}

/** A comment shown OUTSIDE its item (profile tab, moderation, discovery). */
export interface CommentWithTarget extends Comment {
    target: CommentTargetSummary | null;
    /** Plain-text excerpt (≤ 200 chars). */
    excerpt: string;
}

/** Per-item comment settings + counters (comments feature). */
export interface CommentThreadSettings {
    targetType: CommentTargetType;
    targetId: string;
    enabled: boolean;
    allowAnonymous: boolean;
    locked: boolean;
    commentCount: number;
    lastCommentAt: string | null;
}

/** Engine-wide settings (`discussions_settings`). */
export interface DiscussionsSettings {
    reactionsEnabled: boolean;
    /** Allowed reaction kinds, in display order. */
    reactions: string[];
    /** Max body length in characters. */
    maxLength: number;
    /** Minutes after posting an author may still edit; 0 = always. */
    editWindowMinutes: number;
}

export const DEFAULT_DISCUSSIONS_SETTINGS: DiscussionsSettings = {
    reactionsEnabled: true,
    reactions: ['👍', '❤️', '😂', '😮', '😢', '🔥',],
    maxLength: 10_000,
    editWindowMinutes: 0,
};

/** Comments-feature settings (`comments_settings`). */
export interface CommentsSettings {
    /** Hold anonymous comments for approval before they show. */
    approveAnonymous: boolean;
    /** Hold EVERY new comment for approval. */
    approveAll: boolean;
    /** Email a member when someone replies to their comment. */
    notifyOnReply: boolean;
    /** Default for "Enable commenting" on NEW posts / events. */
    enableByDefault: boolean;
}

export const DEFAULT_COMMENTS_SETTINGS: CommentsSettings = {
    approveAnonymous: true,
    approveAll: false,
    notifyOnReply: true,
    enableByDefault: false,
};

/** One row of the moderation queue. */
export interface ModerationItem extends CommentWithTarget {
    reportCount: number;
    reports: { id: string; reason: string | null; reporterName: string | null; createdAt: string; }[];
    guestEmail: string | null;
    guestIp: string | null;
}

/** Per-user activity counters. */
export interface UserActivity {
    comments: number;
    forumThreads: number;
    forumReplies: number;
    total: number;
    lastActiveAt: string | null;
}
