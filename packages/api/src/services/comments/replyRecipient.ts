/** Who gets the comment-reply email (pure — unit-tested). */

/** Targets the Comments feature owns (the forum notifies for its own). */
export const COMMENT_TARGETS: ReadonlySet<string> = new Set(['post', 'event',],);

export interface ReplyRecipientInput {
    reply: { authorId: string | null; status: string; targetType: string; parentId: string | null; };
    parent: { authorId: string | null; email: string | null; status: string; } | null;
    notifyOnReply: boolean;
}

/**
 * Who (if anyone) gets the reply email. Pure — unit-tested.
 * Only a VISIBLE reply on a post/event comment, to a member who is not the
 * replier, whose own comment still exists.
 */
export function replyRecipient(i: ReplyRecipientInput,): string | null {
    if (!i.notifyOnReply) return null;
    if (i.reply.status !== 'visible' || !i.reply.parentId) return null;
    if (!COMMENT_TARGETS.has(i.reply.targetType,)) return null;
    const p = i.parent;
    if (!p || !p.authorId || !p.email || p.status === 'deleted') return null;
    if (i.reply.authorId && i.reply.authorId === p.authorId) return null;
    return p.email;
}
