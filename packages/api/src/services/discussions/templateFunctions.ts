/**
 * Server side of the `{{ }}` discovery functions (latestComments, hotThreads,
 * discussions, commentCount, forumThread) — used by BOTH backend runtimes (SSR
 * + email) through `template/backendRuntime.ts`. Always the ANONYMOUS viewer:
 * a crawler / an inbox must never receive gated content. Never throws: a
 * missing feature or table resolves to an empty list / 0.
 */
import {
    commentCountTarget, DISCUSSION_LIST_KIND, type DiscussionItem, discussionQueryFor, entityRef, FORUM_THREAD_KIND,
    UNRESOLVED,
} from '@sitesurge/types';
import { query as dbQuery, } from '../../db';
import type { AsyncMemo, } from '../template/backendRuntime';
import { query, thread, } from './query';

const ANON = { id: null, role: null, };

/** Resolve a discovery function, or UNRESOLVED when `name` is not one. */
export async function resolveDiscussionFunction(
    name: string, args: unknown[], named: Record<string, unknown> | undefined, memo: AsyncMemo,
): Promise<unknown> {
    const q = discussionQueryFor(name, args, named,);
    if (q) {
        const items = await memo(`disc:${JSON.stringify(q,)}`, () => query(q, ANON,).then((r,) => r.items,).catch(() => [] as DiscussionItem[]),);
        return entityRef(DISCUSSION_LIST_KIND, items as unknown as Record<string, unknown>,);
    }
    if (name === 'commentCount') {
        const t = commentCountTarget(args, named,);
        if (!t) return 0;
        return memo(`commentCount:${t.type}:${t.id}`, async () => {
            const r = await dbQuery<{ n: number; }>(
                `SELECT comment_count AS n FROM comment_threads WHERE target_type = $1 AND target_id = $2`, [t.type, t.id,],
            ).catch(() => ({ rows: [], }));
            return Number(r.rows[0]?.n ?? 0,);
        },);
    }
    if (name === 'forumThread') {
        const ref = String(args[0] ?? '',).trim();
        if (!ref) return entityRef(FORUM_THREAD_KIND, null,);
        const item = await memo(`forumThread:${ref}`, () => thread(ref, ANON,).catch(() => null),);
        return entityRef(FORUM_THREAD_KIND, item as unknown as Record<string, unknown> | null, ref,);
    }
    return UNRESOLVED;
}

const esc = (s: unknown,): string =>
    String(s ?? '',).replace(/&/g, '&amp;',).replace(/</g, '&lt;',).replace(/>/g, '&gt;',).replace(/"/g, '&quot;',);

/** A plain linked list of discovery items (SSR / email). `base` absolutises links (email). */
export function discussionListHtml(items: DiscussionItem[] | null | undefined, base = '',): string {
    if (!Array.isArray(items,) || !items.length) return '';
    const li = items.map((i,) => {
        if (i.kind === 'thread') {
            return `<li><a href="${esc(base + i.url,)}">${esc(i.title,)}</a>`
                + ` <span>— ${esc(i.author.name,)} · ${i.replyCount} ${i.replyCount === 1 ? 'reply' : 'replies'}</span></li>`;
        }
        const on = i.target ? ` on <a href="${esc(base + i.url,)}">${esc(i.target.title,)}</a>` : '';
        return `<li><strong>${esc(i.author.name,)}</strong>${on}: ${esc(i.excerpt,)}</li>`;
    },).join('',);
    return `<ul class="discussion-list">${li}</ul>`;
}

/** One thread as a linked title + counts (SSR / email). */
export function forumThreadHtml(t: Record<string, unknown> | null, base = '',): string {
    if (!t) return '';
    const replies = Number(t.replyCount ?? 0,);
    return `<a class="forum-thread-link" href="${esc(base + String(t.url ?? '',),)}">${esc(t.title,)}</a>`
        + ` <span>(${replies} ${replies === 1 ? 'reply' : 'replies'})</span>`;
}
