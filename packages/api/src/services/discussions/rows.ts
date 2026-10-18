/**
 * Comment rows: the SELECT (with the author card joined in) and the mapper to
 * the wire `Comment`. One place, so every list — item, profile, moderation,
 * discovery — shows the same author card.
 */
import type { Comment, CommentAuthor, CommentStatus, } from '@sitesurge/types';
import { renderMarkdown, stripMarkdown, } from '@sitesurge/types';
import { ENTITLED_STATUSES, } from '../permissions/subjects';

export interface CommentRow {
    id: string;
    target_type: string;
    target_id: string;
    parent_id: string | null;
    root_id: string | null;
    depth: number;
    author_id: string | null;
    guest_name: string | null;
    guest_email: string | null;
    guest_ip: string | null;
    body: string;
    status: CommentStatus;
    is_opening: boolean;
    edited_at: Date | null;
    edit_count: number;
    reaction_counts: Record<string, number>;
    reply_count: number;
    created_at: Date;
    updated_at: Date;
    // Author card (joined).
    a_name?: string | null;
    a_handle?: string | null;
    a_public?: boolean | null;
    a_avatar?: string | null;
    a_role?: string | null;
    a_joined?: Date | null;
    a_activity?: number | null;
    a_tier?: string | null;
}

/**
 * Entitled subscription statuses as a SQL array literal — built from
 * `permissions/subjects.ENTITLED_STATUSES`, so the two cannot drift.
 */
export const ENTITLED_SQL = `ARRAY[${ENTITLED_STATUSES.map((s,) => `'${s.replace(/'/g, "''",)}'`).join(',',)}]`;

/**
 * The author-card columns (`a_*`), for ANY query that joins the author as
 * `users u` + `user_activity ua` (see `authorJoin`). ONE definition shared by
 * comment rows, discovery threads and forum threads, so a change to the card
 * (e.g. hiding the tier for private profiles) is made once.
 */
export function authorColumns(authorIdExpr: string,): string {
    return `
    u.display_name AS a_name, u.handle AS a_handle, u.profile_public AS a_public,
    u.avatar_url AS a_avatar, u.role AS a_role, u.created_at AS a_joined,
    COALESCE(ua.total, 0) AS a_activity,
    (SELECT sp.name FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.user_id = ${authorIdExpr} AND s.status = ANY(${ENTITLED_SQL})
      ORDER BY sp.sort_order DESC LIMIT 1) AS a_tier`;
}

/** `LEFT JOIN users u` + `user_activity ua` for the author id expression. */
export function authorJoin(authorIdExpr: string,): string {
    return `
    LEFT JOIN users u ON u.id = ${authorIdExpr}
    LEFT JOIN user_activity ua ON ua.user_id = ${authorIdExpr}`;
}

/** `SELECT ${COMMENT_COLUMNS} FROM comments c ${AUTHOR_JOIN}`. */
export const COMMENT_COLUMNS = `
    c.*,${authorColumns('c.author_id',)}`;

export const AUTHOR_JOIN = authorJoin('c.author_id',);

/**
 * Visible-body fields are blanked for deleted comments, and for hidden/pending
 * ones a non-moderator (other than the author) may not see — the MAPPER
 * enforces it, so a caller that forgets `visibilityClause` fails closed.
 */
export interface MapOpts {
    viewerId?: string | null;
    moderator?: boolean;
    myReactions?: Set<string>;
    /** Author may still edit (edit window + permission resolved by the caller). */
    canEditOwn?: boolean;
    canDeleteOwn?: boolean;
}

export function mapAuthor(r: CommentRow,): CommentAuthor {
    if (!r.author_id) {
        const deleted = !r.guest_name && r.guest_ip === null && r.guest_email === null;
        return {
            id: null, name: r.guest_name || (deleted ? 'Deleted user' : 'Anonymous'), handle: null, avatarUrl: null,
            role: null, tierName: null, activityCount: 0, joinedAt: null, isGuest: true,
        };
    }
    return {
        id: r.author_id,
        name: r.a_name || 'Member',
        // A hidden member page: name only, no link.
        handle: r.a_public === false ? null : (r.a_handle ?? null),
        avatarUrl: r.a_avatar ?? null,
        role: r.a_role ?? null,
        tierName: r.a_tier ?? null,
        activityCount: Number(r.a_activity ?? 0,),
        joinedAt: r.a_joined ? new Date(r.a_joined,).toISOString() : null,
        isGuest: false,
    };
}

export function mapComment(r: CommentRow, o: MapOpts = {},): Comment {
    const own = Boolean(o.viewerId,) && r.author_id === o.viewerId;
    const deleted = r.status === 'deleted';
    // Fail closed: moderators see every body; the author sees their own
    // (pending/hidden) one; everyone else only a visible comment's.
    const showBody = Boolean(o.moderator,) || (!deleted && (own || r.status === 'visible'));
    return {
        id: r.id,
        targetType: r.target_type,
        targetId: r.target_id,
        parentId: r.parent_id,
        rootId: r.root_id,
        depth: Number(r.depth,),
        author: deleted && !o.moderator ? { ...mapAuthor(r,), name: '[deleted]', handle: null, avatarUrl: null, } : mapAuthor(r,),
        body: showBody && (own || o.moderator) ? r.body : null,
        bodyHtml: showBody ? renderMarkdown(r.body,) : null,
        status: r.status,
        isOpening: Boolean(r.is_opening,),
        editedAt: r.edited_at ? new Date(r.edited_at,).toISOString() : null,
        editCount: Number(r.edit_count ?? 0,),
        reactions: r.reaction_counts ?? {},
        myReactions: o.myReactions ? [...o.myReactions,] : [],
        replyCount: Number(r.reply_count ?? 0,),
        createdAt: new Date(r.created_at,).toISOString(),
        canEdit: !deleted && (Boolean(o.moderator,) || (own && Boolean(o.canEditOwn,))),
        canDelete: !deleted && (Boolean(o.moderator,) || (own && Boolean(o.canDeleteOwn,))),
    };
}

/** Plain-text excerpt for lists away from the item. */
export function excerptOf(body: string, max = 200,): string {
    const t = stripMarkdown(body,).replace(/\s+/g, ' ',).trim();
    return t.length > max ? `${t.slice(0, max - 1,).trimEnd()}…` : t;
}
