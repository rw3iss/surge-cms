/**
 * /api/v1/discussions — the engine (hidden `discussions` feature): comment
 * CRUD on any target, reactions, reports, moderation, engine settings.
 * Shared by Comments (posts/events) and the Forum (threads).
 */
import type {
    Comment, CommentStatus, CommentTargetRef, DiscussionsSettings, ModerationItem,
} from '../../types/discussions';

// ─── GET /discussions/comments ───────────────────────────────────────

export interface DiscussionsCommentsQuery {
    /** `post:<uuid>`, `event:<uuid>`, `forum_thread:<uuid>`. */
    target: CommentTargetRef;
    sort?: 'newest' | 'oldest' | 'top';
    /** Pages TOP-LEVEL comments; each comes with its whole reply tree. */
    page?: number;
    limit?: number;
}

/** Top-level comments with nested `replies`. Pagination rides on `meta`. */
export type DiscussionsCommentsResponse = Comment[];

// ─── POST /discussions/comments ──────────────────────────────────────

export interface DiscussionsCommentCreateBody {
    target: CommentTargetRef;
    parentId?: string | null;
    body: string;
    /** Anonymous comments only (where the item allows them). */
    guestName?: string;
    guestEmail?: string;
    /** Honeypot — must stay empty. */
    website?: string;
}

/** The created comment (status `pending` when it awaits approval). */
export type DiscussionsCommentCreateResponse = Comment;

// ─── PUT / DELETE /discussions/comments/:id ──────────────────────────

export interface DiscussionsCommentIdParams { id: string; }

export interface DiscussionsCommentUpdateBody { body: string; }
export type DiscussionsCommentUpdateResponse = Comment;
export interface DiscussionsCommentDeleteResponse { deleted: true; }

// ─── POST /discussions/comments/:id/reactions ────────────────────────

export interface DiscussionsReactBody { kind: string; }
export interface DiscussionsReactResponse { reactions: Record<string, number>; myReactions: string[]; }

// ─── POST /discussions/comments/:id/report ───────────────────────────

export interface DiscussionsReportBody { reason?: string; }
export interface DiscussionsReportResponse { reported: true; }

// ─── GET /discussions/comments/:id/history (moderators) ──────────────

export type DiscussionsHistoryResponse = { body: string; editedBy: string | null; editedAt: string; }[];

// ─── Moderation ──────────────────────────────────────────────────────

export interface DiscussionsModerationQuery {
    /** Default `queue` = pending + reported. */
    status?: 'queue' | 'pending' | 'reported' | 'hidden' | 'deleted' | 'visible' | 'all';
    /** `forum` = forum threads only, `comments` = everything else. */
    scope?: 'all' | 'comments' | 'forum';
    target?: CommentTargetRef;
    authorId?: string;
    search?: string;
    page?: number;
    limit?: number;
}
export type DiscussionsModerationResponse = ModerationItem[];

export type DiscussionsModerationAction = 'approve' | 'hide' | 'delete' | 'restore' | 'dismiss_reports';

export interface DiscussionsModerationActParams { id: string; action: DiscussionsModerationAction; }
export interface DiscussionsModerationActResponse { id: string; status: CommentStatus; }

export interface DiscussionsModerationBulkBody { ids: string[]; action: DiscussionsModerationAction; }
export interface DiscussionsModerationBulkResponse { updated: number; }

export interface DiscussionsModerationCountsResponse { pending: number; reported: number; }

// ─── Engine settings ─────────────────────────────────────────────────

export type DiscussionsSettingsResponse = DiscussionsSettings;
export type DiscussionsSettingsBody = Partial<DiscussionsSettings>;
