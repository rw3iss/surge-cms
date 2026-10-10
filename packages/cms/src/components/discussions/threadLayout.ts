/**
 * Flatten a comment tree into display rows: replies indent up to
 * `MAX_INDENT` levels; anything deeper renders at that level with a
 * "↪ replying to Name" line, so a long back-and-forth never squeezes into a
 * sliver of the column. Pure — unit-tested.
 */
import type { Comment, } from '@sitesurge/types';

export const MAX_INDENT = 3;

export interface ThreadRow {
    comment: Comment;
    /** Visual indent level, 0…MAX_INDENT. */
    indent: number;
    /** Set when the reply is deeper than the indent shows (whose comment it answers). */
    replyingTo: string | null;
}

export function layoutThread(tops: Comment[], maxIndent = MAX_INDENT,): ThreadRow[] {
    const rows: ThreadRow[] = [];
    const walk = (c: Comment, depth: number, parent: Comment | null,) => {
        const flattened = depth > maxIndent;
        rows.push({ comment: c, indent: Math.min(depth, maxIndent,), replyingTo: flattened && parent ? parent.author.name : null, },);
        for (const r of c.replies ?? []) walk(r, depth + 1, c,);
    };
    for (const t of tops) walk(t, 0, null,);
    return rows;
}

/** Count of comments in a tree (top-level + every reply). */
export function countThread(tops: Comment[],): number {
    let n = 0;
    const walk = (c: Comment,) => { n++; (c.replies ?? []).forEach(walk,); };
    tops.forEach(walk,);
    return n;
}
