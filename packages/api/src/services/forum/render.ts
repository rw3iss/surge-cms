/**
 * The forum block / `{{ forum() }}` as plain HTML for the two backend surfaces:
 * SSR (indexable links) and email (inline-styled links + "Join the
 * discussion →"). ONE renderer, so the block and the function cannot drift.
 *
 * Threads are resolved ahead of time for the ANONYMOUS reader (a crawler, an
 * inbox) — `serverRender.ts` — and arrive here as `ForumFeedThread`s.
 */
import type { ForumFeedThread, ResolvedForumBlockSettings, } from '@sitesurge/types';
import { escapeHtml, } from '../../utils/html';

const esc = (v: unknown,): string => escapeHtml(String(v ?? '',),);

export interface ForumListHtmlOptions {
    /** Prefix for links (email needs absolute URLs; SSR uses site-relative ones). */
    base?: string;
    /** Email: inline styles + the "Join the discussion" link. */
    email?: boolean;
    linkColor?: string;
    textColor?: string;
}

const cut = (text: string, max: number,): string => (text.length > max ? `${text.slice(0, max - 1,).trimEnd()}…` : text);

/** Where "Join the discussion" goes: the first thread's category, else the forum index. */
export function forumJoinUrl(items: ForumFeedThread[],): string {
    const slug = items[0]?.category?.slug;
    return slug ? `/forum/${slug}` : '/forum';
}

/** A forum block's threads as a linked list (nothing when empty and no empty text). */
export function forumListHtml(items: ForumFeedThread[] | null | undefined, s: ResolvedForumBlockSettings, o: ForumListHtmlOptions = {},): string {
    const list = Array.isArray(items,) ? items : [];
    const base = o.base ?? '';
    const link = o.email && o.linkColor ? ` style="color:${esc(o.linkColor,)};"` : '';
    const muted = o.email ? ' style="color:#6b7280;font-size:13px;"' : '';
    const para = o.email ? ` style="margin:4px 0 0;${o.textColor ? `color:${esc(o.textColor,)};` : ''}"` : '';
    const align = s.headingAlign !== 'left' ? ` style="text-align:${s.headingAlign};"` : '';
    const heading = s.heading ? `<h2${align}>${esc(s.heading,)}</h2>` : '';

    if (!list.length) {
        return s.emptyText ? `${heading}<p${para}>${esc(s.emptyText,)}</p>` : '';
    }

    const line = (t: ForumFeedThread,): string => {
        const meta: string[] = [];
        if (s.showAuthor) meta.push(esc(t.author?.name,),);
        if (s.showCounts) meta.push(`${t.replyCount} ${t.replyCount === 1 ? 'reply' : 'replies'}`,);
        const excerpt = s.content === 'none' ? '' : cut(t.excerpt ?? '', s.content === 'full' ? 500 : s.excerptLength,);
        return `<a href="${esc(base + t.url,)}"${link}>${esc(t.title,)}</a>`
            + (meta.length ? ` <span${muted}>— ${meta.join(' · ',)}</span>` : '')
            + (excerpt ? `<p${para}>${esc(excerpt,)}</p>` : '');
    };

    const li = o.email ? ' style="margin:0 0 12px;"' : '';
    const ulStyle = o.email ? ' style="margin:0;padding:0 0 0 18px;"' : '';
    const body = s.mode === 'thread'
        ? `<div class="forum-block-thread">${line(list[0],)}</div>`
        : `<ul class="forum-block-list"${ulStyle}>${list.map((t,) => `<li${li}>${line(t,)}</li>`).join('',)}</ul>`;
    const join = o.email ? `<p style="margin:8px 0 0;"><a href="${esc(base + forumJoinUrl(list,),)}"${link}>Join the discussion →</a></p>` : '';
    return `${heading}${body}${join}`;
}
